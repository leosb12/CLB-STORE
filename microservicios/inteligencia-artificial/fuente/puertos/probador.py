"""REST del worker fotográfico de IA. Autenticación idéntica al servicio empresarial."""
import asyncio
import contextlib
import hashlib
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from fuente.aplicacion.probador import VERSION_MOTOR
from fuente.dominio.probador import ErrorProbador
from fuente.infraestructura.catvton import leer_imagen
from fuente.infraestructura.identidad import IdentidadNoDisponible, TokenInvalido


def crear_aplicacion(trabajos, verificador):
    """La composición vive en `infraestructura/trabajos_vton.py:app_desde_entorno`."""

    @contextlib.asynccontextmanager
    async def vida(app):
        if hasattr(trabajos.motor, "iniciar"):
            await asyncio.to_thread(trabajos.motor.iniciar)
        async def limpiar():
            while True:
                await asyncio.to_thread(trabajos.limpiar_vencidos)
                await asyncio.sleep(60)
        limpieza = asyncio.create_task(limpiar())
        try:
            yield
        finally:
            limpieza.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await limpieza
            await trabajos.cerrar()

    app = FastAPI(title="CLB — Worker VTON", lifespan=vida, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def privacidad(request, siguiente):
        respuesta = await siguiente(request)
        respuesta.headers["Cache-Control"] = "no-store"
        respuesta.headers["X-Content-Type-Options"] = "nosniff"
        return respuesta

    @app.exception_handler(ErrorProbador)
    async def error_probador(request, error):
        return JSONResponse({"mensaje": str(error), "código": error.codigo}, error.estado)

    @app.exception_handler(RequestValidationError)
    async def error_validacion(request, error):
        return JSONResponse({"mensaje": "Los datos enviados no son válidos.", "código": "DATOS_INVALIDOS"}, 422)

    @app.exception_handler(HTTPException)
    async def error_http(request, error):
        return JSONResponse({"mensaje": "La solicitud no es válida o la ruta no existe.", "código": "SOLICITUD_INVALIDA"}, error.status_code)

    @app.exception_handler(Exception)
    async def error_inesperado(request, error):
        logging.getLogger("clb.vton").exception("Fallo del puerto VTON", exc_info=error)
        return JSONResponse({"mensaje": "El probador no pudo atender esta solicitud. Inténtalo de nuevo.", "código": "VTON_NO_DISPONIBLE"}, 503)

    async def titular(request: Request):
        cabecera = request.headers.get("authorization", "")
        if not cabecera.startswith("Bearer "):
            raise ErrorProbador("NO_AUTENTICADO", "Inicia sesión para generar una fotografía.", 401)
        try:
            usuario = await verificador.verificar(cabecera[7:])
        except TokenInvalido:
            raise ErrorProbador("NO_AUTENTICADO", "La sesión venció. Inicia sesión de nuevo.", 401)
        except IdentidadNoDisponible:
            raise ErrorProbador("IDENTIDAD_NO_DISPONIBLE", "No se pudo validar la sesión.", 503)
        if not usuario.roles.intersection({"cliente", "admin"}):
            raise ErrorProbador("ACCESO_DENEGADO", "No tienes permiso para utilizar el probador.", 403)
        return usuario.sub

    @app.get("/salud")
    async def salud():
        vivo = getattr(trabajos.motor, "vivo", None)
        if vivo is not None and not vivo():
            return JSONResponse({"estado": "DEGRADADO", "servicio": "ia-vton", "version_motor": VERSION_MOTOR}, 503)
        return {"estado": "ACTIVO", "servicio": "ia-vton", "version_motor": VERSION_MOTOR}

    @app.post("/api/v1/probador/trabajos", status_code=202)
    async def crear(request: Request, usuario: Annotated[str, Depends(titular)]):
        try:
            if int(request.headers.get("content-length", "0")) > 18 * 1024 * 1024:
                raise ErrorProbador("IMAGEN_INVALIDA", "Las imágenes superan el tamaño permitido.", 413)
        except ValueError:
            raise ErrorProbador("DATOS_INVALIDOS", "El tamaño de la solicitud no es válido.")
        async with request.form(max_files=2, max_fields=3, max_part_size=8 * 1024 * 1024) as formulario:
            imagenes = []
            for campo in ("persona", "prenda"):
                archivo = formulario.get(campo)
                if not isinstance(archivo, UploadFile):
                    raise ErrorProbador("IMAGEN_INVALIDA", "Envía la foto de la persona y la prenda.")
                datos = await archivo.read(8 * 1024 * 1024 + 1)
                # Validación antes de encolar, fuera del bucle de eventos: decodificar 16 MP con ICC bloquea.
                await asyncio.to_thread(leer_imagen, datos)
                imagenes.append(datos)
            identificador, categoria = formulario.get("identificador"), formulario.get("categoria")
            if not isinstance(identificador, str) or not 1 <= len(identificador) <= 128 or not isinstance(categoria, str):
                raise ErrorProbador("DATOS_INVALIDOS", "Faltan el identificador y la categoría de la prenda.")
            forzar = formulario.get("force_regenerate", "false")
            if forzar not in ("true", "false"):
                raise ErrorProbador("DATOS_INVALIDOS", "La opción de regeneración no es válida.")
            return await trabajos.crear(usuario, *imagenes, identificador, categoria, forzar == "true")

    @app.delete("/api/v1/probador/trabajos", status_code=204)
    async def eliminar_todos(usuario: Annotated[str, Depends(titular)]):
        trabajos.eliminar(usuario)

    @app.delete("/api/v1/probador/trabajos/{clave}", status_code=204)
    async def eliminar(clave: str, usuario: Annotated[str, Depends(titular)]):
        trabajos.eliminar(usuario, clave)

    @app.get("/api/v1/probador/trabajos/{clave}")
    async def consultar(clave: str, usuario: Annotated[str, Depends(titular)]):
        return trabajos.consultar(clave, usuario)

    @app.get("/api/v1/probador/trabajos/{clave}/imagen")
    async def imagen(clave: str, usuario: Annotated[str, Depends(titular)]):
        datos = await asyncio.to_thread(trabajos.imagen, clave, usuario)
        # El cliente verifica la integridad antes de guardar la copia sin conexión.
        return Response(datos, media_type="image/png", headers={"X-Contenido-SHA256": hashlib.sha256(datos).hexdigest()})

    return app
