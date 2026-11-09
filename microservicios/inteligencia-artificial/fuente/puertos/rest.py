"""API REST del microservicio de IA. Errores con el formato común de CLB Store: `{mensaje, código}`."""
import asyncio
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import UploadFile  # lo que devuelve request.form()

from fuente.aplicacion.interfaces import RechazoDeServicio, ServicioNoDisponible
from fuente.aplicacion.reportes import EspecificacionInvalida, ReporteAmbiguo, ReporteNoDisponible
from fuente.dominio.reportes import Destino
from fuente.aplicacion.notificaciones import NotificacionInexistente
from fuente.dominio.notificaciones import EstadoNotificacion, NotificacionStockBajo
from fuente.dominio.tallas import Medidas, MedidasInvalidas
from fuente.infraestructura.excel import reporte_xlsx
from fuente.infraestructura.pdf import reporte_pdf as reporte_pdf_bytes
from fuente.infraestructura.identidad import IdentidadNoDisponible, TokenInvalido, Usuario
from fuente.infraestructura.voz import TranscriptorOcupado

MAXIMO_AUDIO = 5 * 1024 * 1024
# Una misión o un reporte a la vez por proceso: la GPU de la laptop atiende un modelo a la vez y una ráfaga la monopoliza.
TRABAJO_LLM = asyncio.Semaphore(1)


def _sin_cola():
    if TRABAJO_LLM.locked():
        raise ErrorHttp(429, "OCUPADO", "Los agentes están atendiendo otra solicitud. Inténtalo en unos segundos.")


class ErrorHttp(Exception):
    def __init__(self, estado: int, codigo: str, mensaje: str, **extra):
        self.estado, self.cuerpo = estado, {"mensaje": mensaje, "código": codigo, **extra}


def requerir(*roles: str):
    async def dependencia(request: Request) -> Usuario:
        cabecera = request.headers.get("authorization", "")
        if not cabecera.startswith("Bearer "):
            raise ErrorHttp(401, "NO_AUTENTICADO", "Se requiere iniciar sesión.")
        try:
            usuario = await request.app.state.verificador.verificar(cabecera[7:])
        except TokenInvalido:
            raise ErrorHttp(401, "NO_AUTENTICADO", "La sesión no es válida o venció.")
        except IdentidadNoDisponible:
            raise ErrorHttp(503, "IDENTIDAD_NO_DISPONIBLE", "No se pudo validar la sesión; intenta de nuevo.")
        if not usuario.roles.intersection(roles):
            raise ErrorHttp(403, "ACCESO_DENEGADO", "No tienes permiso para esta operación.")
        return usuario
    return dependencia


Admin = Annotated[Usuario, Depends(requerir("admin"))]
Cliente = Annotated[Usuario, Depends(requerir("cliente", "admin"))]
Servicio = Annotated[Usuario, Depends(requerir("servicio"))]


class PeticionReporte(BaseModel):
    model_config = ConfigDict(extra="forbid")
    peticion: str | None = Field(default=None, min_length=3, max_length=500)
    especificacion: dict | None = None
    destino: Destino | None = None
    # Última elección explícita en la interfaz (prevalece sobre lo interpretado): PANTALLA, PDF y/o EXCEL.
    formatos: list[Literal["PANTALLA", "PDF", "EXCEL"]] | None = Field(default=None, max_length=3)


class PeticionMision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mision: str = Field(min_length=3, max_length=500)


class PeticionTalla(BaseModel):
    model_config = ConfigDict(extra="forbid")
    altura_cm: float
    peso_kg: float
    pecho_cm: float
    cintura_cm: float


def _servicios(request: Request):
    return request.app.state.servicios


api = APIRouter(prefix="/api/v1")


@api.post("/reportes", status_code=201)
async def crear_reporte(cuerpo: PeticionReporte, usuario: Admin, request: Request):
    if (cuerpo.peticion is None) == (cuerpo.especificacion is None):
        raise ErrorHttp(422, "DATOS_INVALIDOS", "Envía una petición en texto o una especificación, no ambas.")
    _sin_cola()
    try:
        async with TRABAJO_LLM:
            return await _servicios(request).reportes.ejecutar(usuario.sub, usuario.token, cuerpo.peticion,
                                                               cuerpo.especificacion, cuerpo.destino, cuerpo.formatos)
    except EspecificacionInvalida as error:
        raise ErrorHttp(422, "ESPECIFICACION_INVALIDA", str(error), errores=error.errores)
    except ReporteAmbiguo as error:
        raise ErrorHttp(422, "AMBIGUA", str(error), sugerencias=error.sugerencias)
    except ReporteNoDisponible as error:
        raise ErrorHttp(422, "NO_DISPONIBLE", str(error), motivos=error.motivos)


@api.get("/reportes")
async def historial(usuario: Admin, request: Request, limite: Annotated[int, Query(ge=1, le=100)] = 30):
    return {"reportes": await _servicios(request).consultas.reportes(limite)}


async def _reporte(request: Request, identificador: uuid.UUID) -> dict:
    reporte = await _servicios(request).consultas.reporte(str(identificador))
    if reporte is None:
        raise ErrorHttp(404, "NO_ENCONTRADO", "El reporte no existe.")
    return reporte


@api.get("/reportes/{identificador}")
async def reporte(identificador: uuid.UUID, usuario: Admin, request: Request):
    return await _reporte(request, identificador)


def _exigir_formato(reporte: dict, formato: str):
    """«Solo PDF» ofrece únicamente PDF (y «solo Excel», Excel); sin archivos pedidos se ofrecen ambos bajo demanda."""
    spec = reporte["especificacion"]
    if spec.get("version") == 2:
        pedidos = {f for f in spec.get("formatos") or [] if f != "PANTALLA"}
        if pedidos and formato not in pedidos:
            raise ErrorHttp(409, "FORMATO_NO_SOLICITADO", f"Este reporte se pidió solo en {' y '.join(sorted(pedidos))}.")


@api.get("/reportes/{identificador}/excel")
async def reporte_excel(identificador: uuid.UUID, usuario: Admin, request: Request):
    reporte = await _reporte(request, identificador)
    _exigir_formato(reporte, "EXCEL")
    return Response(reporte_xlsx(reporte), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="clb-reporte-{str(identificador)[:8]}.xlsx"'})


@api.get("/reportes/{identificador}/pdf")
async def reporte_pdf(identificador: uuid.UUID, usuario: Admin, request: Request):
    reporte = await _reporte(request, identificador)
    _exigir_formato(reporte, "PDF")
    return Response(reporte_pdf_bytes(reporte), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="clb-reporte-{str(identificador)[:8]}.pdf"'})


@api.post("/agentes/misiones")
async def mision(cuerpo: PeticionMision, usuario: Admin, request: Request):
    _sin_cola()
    async with TRABAJO_LLM:
        return await _servicios(request).mision.ejecutar(cuerpo.mision, usuario.sub, usuario.token)


@api.post("/interno/notificaciones")
async def registrar_notificacion(cuerpo: NotificacionStockBajo, usuario: Servicio, request: Request):
    """Solo la automatización (token de servicio, red interna; la pasarela no publica /interno). 201 nueva, 200 repetida."""
    notificacion, nueva = await _servicios(request).notificaciones.registrar(cuerpo, "n8n")
    return JSONResponse(jsonable_encoder({"notificacion": notificacion}), 201 if nueva else 200)


@api.get("/notificaciones")
async def notificaciones(usuario: Admin, request: Request, estado: EstadoNotificacion | None = None):
    return {"notificaciones": await _servicios(request).notificaciones.listar(estado)}


@api.post("/notificaciones/{evento}/atender")
async def atender_notificacion(evento: uuid.UUID, usuario: Admin, request: Request):
    try:
        return {"notificacion": await _servicios(request).notificaciones.atender(str(evento), usuario.sub)}
    except NotificacionInexistente:
        raise ErrorHttp(404, "NO_ENCONTRADO", "La notificación no existe.")


@api.get("/agentes/propuestas")
async def propuestas(usuario: Admin, request: Request,
                     estado: Literal["PENDIENTE", "CONFIRMANDO", "REQUIERE_REVISION", "CONFIRMADA", "RECHAZADA"] | None = None):
    return {"propuestas": await _servicios(request).consultas.propuestas(estado)}


@api.post("/agentes/propuestas/{identificador}/{accion}")
async def resolver_propuesta(identificador: uuid.UUID, accion: Literal["confirmar", "rechazar"], usuario: Admin, request: Request):
    gestor = _servicios(request).propuestas
    try:
        if accion == "confirmar":
            return await gestor.confirmar(str(identificador), usuario.sub, usuario.token)
        return await gestor.rechazar(str(identificador), usuario.sub)
    except LookupError as error:
        raise ErrorHttp(404, "NO_ENCONTRADO", str(error))
    except PermissionError as error:
        raise ErrorHttp(409, "PROPUESTA_RESUELTA", str(error))


@api.get("/agentes/auditoria")
async def auditoria(usuario: Admin, request: Request, limite: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"auditoria": await _servicios(request).consultas.auditoria(limite)}


@api.post("/voz")
async def voz(usuario: Admin, request: Request):
    # El formulario se lee recién después de validar el token: un anónimo no puede subir audio.
    formulario = await request.form(max_files=1, max_fields=1, max_part_size=MAXIMO_AUDIO)
    audio = formulario.get("audio")
    if not isinstance(audio, UploadFile):
        raise ErrorHttp(422, "AUDIO_INVALIDO", "Envía el audio en el campo «audio».")
    datos = await audio.read(MAXIMO_AUDIO + 1)
    if not datos or len(datos) > MAXIMO_AUDIO:
        raise ErrorHttp(422, "AUDIO_INVALIDO", "El audio está vacío o supera 5 MB.")
    try:
        texto = await _servicios(request).transcriptor.transcribir(datos)
    except TranscriptorOcupado:
        raise ErrorHttp(429, "OCUPADO", "Se está transcribiendo otro audio. Inténtalo en unos segundos.")
    if not texto:
        raise ErrorHttp(422, "AUDIO_SIN_TEXTO", "No se reconoció ninguna frase; intenta de nuevo más cerca del micrófono.")
    return {"texto": texto}


@api.get("/tallas/modelo")
async def modelo_tallas(request: Request):
    """Público y sin datos personales: la web y Android lo descargan para recomendar la talla sin conexión."""
    return _servicios(request).modelo_tallas.exportar()


@api.post("/tallas/recomendacion")
async def recomendar(cuerpo: PeticionTalla, request: Request):
    try:
        return _servicios(request).tallas.ejecutar(Medidas(**cuerpo.model_dump()))
    except MedidasInvalidas as error:
        raise ErrorHttp(422, "MEDIDAS_INVALIDAS", str(error))


@api.get("/tallas/mi-recomendacion")
async def mi_recomendacion(usuario: Cliente, request: Request):
    try:
        return await _servicios(request).tallas.para_titular(usuario.token)
    except MedidasInvalidas as error:
        raise ErrorHttp(422, "MEDIDAS_INCOMPLETAS", f"{error} Complétalas en tu perfil.")


def registrar_errores(app: FastAPI):
    @app.exception_handler(ErrorHttp)
    async def _error(_, error: ErrorHttp):
        return JSONResponse(error.cuerpo, error.estado)

    @app.exception_handler(RequestValidationError)
    async def _validacion(_, error: RequestValidationError):
        errores = [{"campo": ".".join(str(p) for p in e["loc"][1:]), "mensaje": e["msg"]} for e in error.errors()]
        return JSONResponse({"mensaje": "Los datos enviados no son válidos.", "código": "DATOS_INVALIDOS", "errores": errores}, 422)

    @app.exception_handler(ServicioNoDisponible)
    async def _no_disponible(_, error: ServicioNoDisponible):
        return JSONResponse({"mensaje": f"Un servicio necesario no está disponible: {error}", "código": "SERVICIO_NO_DISPONIBLE"}, 503)

    @app.exception_handler(RechazoDeServicio)
    async def _rechazo(_, error: RechazoDeServicio):
        estado = error.estado if error.estado in (401, 403, 404, 409, 422) else 502
        return JSONResponse({"mensaje": str(error), "código": error.cuerpo.get("código", "RECHAZO_DE_SERVICIO")}, estado)
