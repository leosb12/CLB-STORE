"""Caso de uso del probador fotográfico: identidad determinista, cola acotada y caché privada por titular."""
import asyncio
import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from fuente.dominio.probador import (
    ACTIVOS,
    CODIGOS_REINTENTABLES,
    ErrorProbador,
    MotorProbador,
    RepositorioTrabajos,
    categoria_vton,
)

VERSION_MOTOR = "catvton-7818397-residente-v12-24-2.5-768x1024"
registro = logging.getLogger("clb.vton")


def clave_resultado(titular: str, persona: bytes, prenda: bytes, identificador: str, categoria: str) -> str:
    especificacion = [VERSION_MOTOR, titular, hashlib.sha256(persona).hexdigest(),
                      identificador, hashlib.sha256(prenda).hexdigest(), categoria]
    return hashlib.sha256(json.dumps(especificacion, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class TrabajosProbador:
    """Una inferencia a la vez en la GPU; las fotos originales solo viven en memoria durante el trabajo."""

    def __init__(self, repositorio: RepositorioTrabajos, motor: MotorProbador, maximos=4, maximos_titular=2, retencion=86400):
        self.repositorio, self.motor = repositorio, motor
        self.maximos, self.maximos_titular, self.retencion = maximos, maximos_titular, retencion
        self.ejecutor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clb-vton")
        self.tareas = set()
        repositorio.recuperar_interrumpidos()

    def consultar(self, clave, titular):
        fila = self.repositorio.obtener(clave, titular)
        if fila is None or fila[3] < time.time() - self.retencion:
            raise ErrorProbador("NO_ENCONTRADO", "El resultado no existe o venció.", 404)
        estado, codigo, mensaje, _ = fila
        return {"identificador": clave, "estado": estado, "código": codigo, "mensaje": mensaje,
                "reintentable": estado == "ERROR" and codigo in CODIGOS_REINTENTABLES}

    async def crear(self, titular, persona, prenda, identificador, categoria, force_regenerate=False):
        categoria_normalizada = categoria_vton(categoria)
        clave = clave_resultado(titular, persona, prenda, identificador, categoria)
        with self.repositorio.transaccion() as t:
            t.purgar_vencidos(time.time() - self.retencion)
            estado = t.estado(clave)
            # Repetir la misma solicitud devuelve el mismo trabajo: idempotencia por contenido.
            if estado in ACTIVOS or (estado and estado != "ERROR" and not force_regenerate):
                return self.consultar(clave, titular)
            if t.activos() >= self.maximos or len(self.tareas) >= self.maximos:
                raise ErrorProbador("OCUPADO", "El probador está ocupado. Vuelve a intentar en unos minutos.", 429)
            if t.activos(titular) >= self.maximos_titular:
                raise ErrorProbador("OCUPADO", "Ya tienes imágenes en preparación. Espera a que terminen.", 429)
            creado = time.time()
            t.registrar(clave, titular, creado)
        tarea = asyncio.create_task(self.procesar(clave, persona, prenda, categoria_normalizada, creado))
        self.tareas.add(tarea)
        tarea.add_done_callback(self.tareas.discard)
        return self.consultar(clave, titular)

    async def procesar(self, clave, persona, prenda, categoria, creado):
        def inferir():
            if not self.repositorio.marcar(clave, creado, "PROCESANDO"):
                raise ErrorProbador("TRABAJO_ELIMINADO", "La solicitud fue eliminada.", 404)
            return self.motor.generar(persona, prenda, categoria, int(clave[:8], 16))
        try:
            salida = await asyncio.get_running_loop().run_in_executor(self.ejecutor, inferir)
            self.repositorio.guardar_resultado(clave, creado, salida)
        except Exception as error:  # noqa: BLE001 - Todo fallo debe dejar un estado terminal, nunca PROCESANDO eterno.
            if not isinstance(error, ErrorProbador):
                registro.exception("Fallo de trabajo VTON")
                error = ErrorProbador("GENERACION_FALLIDA", "No se pudo completar la imagen. Inténtalo de nuevo.", 503)
            self.repositorio.marcar(clave, creado, "ERROR", error.codigo, str(error))

    def eliminar(self, titular, clave=None):
        self.repositorio.eliminar(titular, clave)

    def imagen(self, clave, titular):
        if self.consultar(clave, titular)["estado"] != "LISTO":
            raise ErrorProbador("RESULTADO_PENDIENTE", "La imagen todavía no está disponible.", 409)
        return self.repositorio.leer_resultado(clave)

    def limpiar_vencidos(self):
        self.repositorio.purgar_vencidos(time.time() - self.retencion)

    async def cerrar(self):
        for tarea in self.tareas:
            tarea.cancel()
        cerrar = getattr(self.motor, "cerrar", None)
        if cerrar:
            try:
                cerrar()
            except Exception:  # noqa: BLE001 - El cierre no debe impedir apagar el servicio.
                registro.exception("Fallo al cerrar el motor VTON")
        self.ejecutor.shutdown(wait=False, cancel_futures=True)
