"""Worker del servicio IA. REST interno; sin acceso a MongoDB ni descargas de modelos."""

import asyncio
import hashlib
import json
import logging
import multiprocessing as mp
import os
import re

import httpx

from fuente.infraestructura.servicios_rest import TokenDeServicio

registro = logging.getLogger("clb.prendas")


def procesar_local(conexion, modelo, sha):
    from fuente.aplicacion.preparar_prenda import PrepararPrenda
    from fuente.dominio.prendas import PrendaNoPreparada
    from fuente.infraestructura.prendas_onnx import PreparadorU2Net

    try:
        # Las altas usan solo la preparación generativa; el detector de estampados (OCR) sirve al esquema 1 y no se carga.
        preparador = PrepararPrenda(PreparadorU2Net(modelo, sha))
        conexion.send({"estado": "PREPARADO"})
        while True:
            original, categoria = conexion.recv()
            try:
                resultado = preparador.ejecutar(original, categoria)
                conexion.send(
                    ({"estado": "LISTO", "recurso": resultado.metadatos}, resultado.textura, resultado.maestro, resultado.espalda)
                )
            except PrendaNoPreparada as error:
                datos = {"estado": "REQUIERE_REVISION", "mensaje": str(error)}
                informe = getattr(error, "informe", None)  # PrendaNoApta: cada motivo del estándar para el panel
                if informe is not None:
                    datos["calidad"] = informe.como_dict()
                conexion.send((datos, None, None, None))
            except Exception:  # noqa: BLE001 - frontera del proceso: registra el fallo y devuelve un estado recuperable.
                registro.exception("Procesamiento de prenda fallido")
                conexion.send(({"estado": "ERROR", "mensaje": "No se pudo preparar la prenda."}, None, None, None))
    except (EOFError, BrokenPipeError):
        pass
    finally:
        conexion.close()


class ProcesadorAislado:
    """Sesión persistente en proceso terminable: un timeout no deja inferencia huérfana."""

    def __init__(self, modelo, sha):
        self.modelo, self.sha = modelo, sha
        self.proceso = None
        self.conexion = None

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
        self.cerrar()
        contexto = mp.get_context("spawn")
        self.conexion, hijo = contexto.Pipe()
        self.proceso = contexto.Process(target=procesar_local, args=(hijo, self.modelo, self.sha), daemon=True)
        self.proceso.start()
        hijo.close()
        if not self.conexion.poll(60):
            self.cerrar()
            raise RuntimeError("MODELO_PRENDAS_NO_DISPONIBLE")
        try:
            if self.conexion.recv() != {"estado": "PREPARADO"}:
                raise RuntimeError("MODELO_PRENDAS_NO_DISPONIBLE")
        except EOFError as error:
            self.cerrar()
            raise RuntimeError("MODELO_PRENDAS_NO_DISPONIBLE") from error

    def ejecutar(self, original, categoria):
        if self.proceso is None or not self.proceso.is_alive():
            self.iniciar()
        try:
            self.conexion.send((original, categoria))
            if not self.conexion.poll(60):
                self.cerrar()
                return ({"estado": "ERROR", "mensaje": "El procesamiento superó 60 segundos."}, None, None, None)
            return self.conexion.recv()
        except (EOFError, BrokenPipeError, OSError):
            self.cerrar()
            return (
                {
                    "estado": "ERROR",
                    "mensaje": "El proceso de imagen terminó inesperadamente; vuelve a preparar la prenda.",
                },
                None,
                None,
                None,
            )


async def ciclo(http, token, base, procesador):
    cabeceras = {"Authorization": "Bearer " + await token.obtener()}
    respuesta = await http.post(base + "/api/v1/interno/recursos-probador/reclamar", headers=cabeceras)
    if respuesta.status_code == 401:
        token.descartar()
    respuesta.raise_for_status()
    trabajo = respuesta.json().get("trabajo")
    if not trabajo:
        return
    if not re.fullmatch(r"[a-f0-9]{32}", trabajo["producto"]) or not re.fullmatch(r"[a-f0-9-]{36}", trabajo["trabajo"]):
        raise ValueError("Contrato de trabajo inválido")
    ruta = base + "/api/v1/interno/recursos-probador/" + trabajo["producto"] + "/" + trabajo["trabajo"]
    cabeceras["X-CLB-Reclamo"] = trabajo["reclamo"]
    original = bytearray()
    async with http.stream("GET", ruta + "/original", headers=cabeceras) as archivo:
        archivo.raise_for_status()
        async for parte in archivo.aiter_bytes():
            original.extend(parte)
            if len(original) > 10 * 1024 * 1024:
                raise ValueError("Original demasiado grande")
    if hashlib.sha256(original).hexdigest() != trabajo["original"]["sha256"]:
        raise ValueError("El original no coincide con el trabajo reclamado")
    datos, textura, maestro, espalda = await asyncio.to_thread(procesador.ejecutar, bytes(original), trabajo["categoria"])
    archivos = {}
    if textura is not None:
        archivos = {"textura": ("textura.png", textura, "image/png"), "maestro": ("maestro.png", maestro, "image/png")}
        if espalda is not None:
            archivos["espalda"] = ("espalda.png", espalda, "image/png")
    # Una respuesta perdida se reintenta con el mismo reclamo y los mismos bytes.
    for intento in range(3):
        try:
            resultado = await http.post(
                ruta + "/resultado",
                headers=cabeceras,
                data={"datos": json.dumps(datos, ensure_ascii=False)},
                files=archivos or None,
            )
            if resultado.status_code == 401:
                token.descartar()
                cabeceras["Authorization"] = "Bearer " + await token.obtener()
            elif resultado.status_code == 409:
                return  # otro trabajo/reclamo sustituyó este resultado
            else:
                resultado.raise_for_status()
                return
        except httpx.HTTPError:
            if intento == 2:
                raise
        await asyncio.sleep(1)


async def principal():
    modelo = os.environ.get("CLB_PRENDAS_MODELO", "/modelos-prendas/u2net.onnx")
    sha = os.environ.get("CLB_PRENDAS_SHA256", "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491")
    procesador = ProcesadorAislado(modelo, sha)
    procesador.iniciar()  # fallo temprano sin descargar nada
    base = os.environ.get("CLB_INVENTARIO_URL", "http://inventario:8000").rstrip("/")
    identidad = os.environ.get("CLB_IDENTIDAD_INTERNO", "http://identidad:8080/identidad").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as http:
            token = TokenDeServicio(
                http, identidad + "/realms/clb/protocol/openid-connect/token", os.environ["CLB_IDENTIDAD_SECRETO_IA"]
            )
            while True:
                try:
                    await ciclo(http, token, base, procesador)
                except Exception:  # noqa: BLE001 - supervisor durable: registra el fallo y permite recuperar el arrendamiento.
                    registro.exception("Ciclo de prendas fallido; el arrendamiento permite recuperarlo")
                await asyncio.sleep(3)
    finally:
        procesador.cerrar()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(principal())
