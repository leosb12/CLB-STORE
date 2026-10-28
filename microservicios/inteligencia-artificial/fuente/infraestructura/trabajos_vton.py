"""Adaptadores del probador: proceso GPU único y repositorio SQLite/archivos de los trabajos."""
import contextlib
import io
import logging
import multiprocessing as mp
import os
import sqlite3
from pathlib import Path

from PIL import Image

from fuente.dominio.probador import ErrorProbador

registro = logging.getLogger("clb.vton")


def inferir_en_proceso(conexion, pesos):
    logging.basicConfig(level=logging.INFO)
    try:
        from fuente.infraestructura.catvton import MotorCatVTON
        motor = MotorCatVTON(pesos)
        conexion.send((None, None))  # Arranque completo antes de aceptar solicitudes.
        while True:
            persona, prenda, categoria, semilla = conexion.recv()
            try:
                conexion.send((motor.generar(persona, prenda, categoria, semilla), None))
            except ErrorProbador as error:
                conexion.send((None, (error.codigo, str(error), error.estado)))
            except Exception as error:  # noqa: BLE001 - Frontera del proceso: registrar y traducir errores de librerías CUDA.
                registro.exception("Fallo de inferencia VTON")
                import torch
                if isinstance(error, torch.cuda.OutOfMemoryError):
                    conexion.send((None, ("GPU_SIN_MEMORIA", "La GPU no tiene memoria disponible. Espera a que terminen las otras tareas de IA y vuelve a intentar.", 503)))
                else:
                    conexion.send((None, ("INFERENCIA_FALLIDA", "No se pudo generar la imagen. Revisa la foto o vuelve a intentar más tarde.", 503)))
                # CUDA puede quedar inutilizable después de un fallo: el siguiente trabajo tendrá otro proceso.
                return
    except ErrorProbador as error:
        conexion.send((None, (error.codigo, str(error), error.estado)))
    except (EOFError, BrokenPipeError):
        return
    finally:
        conexion.close()


class ProcesoVton:
    def __init__(self, pesos, plazo=600, plazo_carga=900):
        self.pesos, self.plazo = pesos, plazo
        self.plazo_carga = plazo_carga
        self.proceso = self.conexion = None

    def vivo(self):
        return self.proceso is not None and self.proceso.is_alive()

    def cerrar(self):
        if self.proceso:
            if self.proceso.is_alive():
                self.proceso.terminate()
            self.proceso.join(5)
            if self.proceso.is_alive():
                self.proceso.kill()
                self.proceso.join()
        if self.conexion:
            self.conexion.close()
        self.proceso = self.conexion = None

    def iniciar(self):
        if self.proceso is None or not self.proceso.is_alive():
            self.cerrar()
            contexto = mp.get_context("spawn")
            self.conexion, hijo = contexto.Pipe()
            self.proceso = contexto.Process(target=inferir_en_proceso, args=(hijo, self.pesos), daemon=True)
            self.proceso.start()
            hijo.close()
            if not self.conexion.poll(self.plazo_carga):
                self.cerrar()
                raise ErrorProbador("MOTOR_NO_PREPARADO", "El motor no pudo precargar los modelos.", 503)
            try:
                _, error = self.conexion.recv()
            except EOFError as causa:
                self.cerrar()
                raise ErrorProbador("MOTOR_NO_PREPARADO", "Falló la precarga del motor GPU.", 503) from causa
            if error:
                self.cerrar()
                raise ErrorProbador(*error)

    def generar(self, *entrada):
        self.iniciar()
        try:
            self.conexion.send(entrada)
            if not self.conexion.poll(self.plazo):
                self.cerrar()
                raise ErrorProbador("TIEMPO_AGOTADO", "La generación superó el tiempo disponible. Inténtalo con una foto más clara.", 503)
            imagen, error = self.conexion.recv()
            if error:
                raise ErrorProbador(*error)
            return imagen
        except (EOFError, BrokenPipeError, OSError) as error:
            self.cerrar()
            raise ErrorProbador("WORKER_NO_DISPONIBLE", "El proceso de imagen se reinició. Puedes volver a intentar.", 503) from error


class RepositorioTrabajosSqlite:
    """Estados en SQLite y PNG en el volumen privado. Escrituras atómicas; nunca guarda las fotos originales."""

    def __init__(self, directorio: str):
        self.raiz = Path(directorio)
        self.raiz.mkdir(parents=True, exist_ok=True)
        with self.conexion() as db:
            db.execute("create table if not exists trabajos (clave text primary key, titular text not null, estado text not null, creado real not null, codigo text, mensaje text)")

    @contextlib.contextmanager
    def conexion(self):
        db = sqlite3.connect(self.raiz / "trabajos.sqlite", timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def recuperar_interrumpidos(self):
        with self.conexion() as db:
            db.execute("update trabajos set estado='ERROR', codigo='TRABAJO_INTERRUMPIDO', mensaje='El servidor se reinició. La solicitud se reintentará.' where estado in ('PENDIENTE','PROCESANDO')")
        # Escrituras cortadas por un reinicio o disco lleno: nunca se publican ni se conservan.
        for temporal in self.raiz.glob("*.tmp"):
            temporal.unlink(missing_ok=True)

    @contextlib.contextmanager
    def transaccion(self):
        with self.conexion() as db:
            db.execute("begin immediate")
            yield _Transaccion(db, self.raiz)

    def obtener(self, clave, titular):
        with self.conexion() as db:
            return db.execute("select estado, codigo, mensaje, creado from trabajos where clave=? and titular=?", (clave, titular)).fetchone()

    def marcar(self, clave, creado, estado, codigo=None, mensaje=None):
        with self.conexion() as db:
            return db.execute("update trabajos set estado=?, codigo=?, mensaje=? where clave=? and creado=?",
                              (estado, codigo, mensaje, clave, creado)).rowcount > 0

    def guardar_resultado(self, clave, creado, datos):
        with self.transaccion() as t:
            if not t.db.execute("select 1 from trabajos where clave=? and creado=?", (clave, creado)).fetchone():
                return False  # Eliminado durante la inferencia: no resucitar el archivo.
            temporal = self.raiz / (clave + ".tmp")
            with temporal.open("wb") as archivo:
                archivo.write(datos)
                archivo.flush()
                os.fsync(archivo.fileno())
            temporal.replace(self.raiz / (clave + ".png"))
            t.db.execute("update trabajos set estado='LISTO', codigo=null, mensaje=null where clave=? and creado=?", (clave, creado))
            return True

    def leer_resultado(self, clave):
        try:
            datos = (self.raiz / (clave + ".png")).read_bytes()
            with Image.open(io.BytesIO(datos)) as imagen:
                if imagen.format != "PNG":
                    raise ValueError("Formato inesperado")
                imagen.verify()
            return datos
        except (OSError, ValueError) as error:
            with self.conexion() as db:
                db.execute("update trabajos set estado='ERROR', codigo='RESULTADO_NO_DISPONIBLE', mensaje='Genera de nuevo esta imagen.' where clave=?", (clave,))
            raise ErrorProbador("RESULTADO_NO_DISPONIBLE", "El archivo ya no está disponible. Genera una nueva imagen.", 404) from error

    def eliminar(self, titular, clave=None):
        with self.transaccion() as t:
            consulta = "select clave from trabajos where titular=?" + ("" if clave is None else " and clave=?")
            for (identificador,) in t.db.execute(consulta, (titular,) if clave is None else (titular, clave)).fetchall():
                t.borrar(identificador)

    def purgar_vencidos(self, limite):
        with self.transaccion() as t:
            t.purgar_vencidos(limite)


class _Transaccion:
    def __init__(self, db, raiz):
        self.db, self.raiz = db, raiz

    def borrar(self, clave):
        for extension in (".png", ".tmp"):
            (self.raiz / (clave + extension)).unlink(missing_ok=True)
        self.db.execute("delete from trabajos where clave=?", (clave,))

    def purgar_vencidos(self, limite):
        for (clave,) in self.db.execute("select clave from trabajos where creado < ? and estado not in ('PENDIENTE','PROCESANDO')", (limite,)).fetchall():
            self.borrar(clave)

    def estado(self, clave):
        fila = self.db.execute("select estado from trabajos where clave=?", (clave,)).fetchone()
        return fila[0] if fila else None

    def activos(self, titular=None):
        consulta = "select count(*) from trabajos where estado in ('PENDIENTE','PROCESANDO')"
        return self.db.execute(consulta + (" and titular=?" if titular else ""), (titular,) if titular else ()).fetchone()[0]

    def registrar(self, clave, titular, creado):
        (self.raiz / (clave + ".png")).unlink(missing_ok=True)
        self.db.execute("insert or replace into trabajos values (?,?,'PENDIENTE',?,null,null)", (clave, titular, creado))


def trabajos_en_directorio(directorio, motor, **opciones):
    """Composición del caso de uso con su repositorio de archivos."""
    from fuente.aplicacion.probador import TrabajosProbador
    return TrabajosProbador(RepositorioTrabajosSqlite(directorio), motor, **opciones)


def app_desde_entorno():
    """Raíz de composición del worker: `uvicorn --factory fuente.infraestructura.trabajos_vton:app_desde_entorno`."""
    from fuente.infraestructura.identidad import VerificadorTokens
    from fuente.puertos.probador import crear_aplicacion
    emisor = os.environ.get("CLB_IDENTIDAD_EMISOR", "http://127.0.0.1:18000/identidad/realms/clb")
    interno = os.environ.get("CLB_IDENTIDAD_INTERNO", "http://identidad:8080/identidad")
    trabajos = trabajos_en_directorio(os.environ.get("CLB_VTON_CACHE", "/resultados"), ProcesoVton(os.environ.get("CLB_VTON_PESOS", "/weights")))
    return crear_aplicacion(trabajos, VerificadorTokens(interno + "/realms/clb/protocol/openid-connect/certs", emisor))
