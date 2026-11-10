"""GraphQL del sistema de gestión empresarial (solo rol admin). Lee únicamente el modelo de lectura `clb_analitica`.

Los campos se piden a gusto (p. ej. `productos { nombre stock ventas }`), pero las operaciones, filtros y límites son
cerrados: no hay SQL ni filtros libres. Las herramientas MCP de los agentes llaman a este mismo esquema.
"""
import dataclasses
import re
import uuid
from datetime import date, datetime
from enum import Enum

import strawberry
from fastapi.encoders import jsonable_encoder
from graphql import GraphQLError
from strawberry.extensions import MaskErrors, MaxAliasesLimiter, MaxTokensLimiter, QueryDepthLimiter
from strawberry.scalars import JSON
from strawberry.types import Info

from fuente.aplicacion.consultas import ConsultarAnalitica
from fuente.aplicacion.interfaces import RechazoDeServicio, ServicioNoDisponible
from fuente.aplicacion.notificaciones import NotificacionInexistente
from fuente.aplicacion.reportes import EspecificacionInvalida, ReporteAmbiguo, ReporteNoDisponible, procedencia
from fuente.dominio.catalogo_reportes import EspecificacionV2, describir_v2
from fuente.dominio.reportes import Destino, Filtros, describir
from pydantic import ValidationError


@strawberry.enum(description="Ventana de tiempo; HOY es el día calendario de Bolivia.")
class Periodo(Enum):
    HOY = "HOY"
    SEMANA = "SEMANA"
    MES = "MES"
    TODO = "TODO"
    RANGO = "RANGO"


@strawberry.enum
class Agrupacion(Enum):
    TALLA = "TALLA"
    COLOR = "COLOR"
    CATEGORIA = "CATEGORIA"
    PRODUCTO = "PRODUCTO"
    DIA = "DIA"


@strawberry.enum(description="Métrica que ordena el top N de una agrupación.")
class Metrica(Enum):
    UNIDADES = "UNIDADES"
    MONTO = "MONTO"
    PEDIDOS = "PEDIDOS"


@strawberry.enum(description="Orden del top N: por la métrica (mayor o menor primero) o alfabético.")
class OrdenGrupos(Enum):
    METRICA_DESC = "METRICA_DESC"
    METRICA_ASC = "METRICA_ASC"
    CLAVE_ASC = "CLAVE_ASC"


@strawberry.input(description="Filtros cerrados de ventas; cada valor se compara como dato, nunca como consulta.")
class FiltrosVentas:
    categoria: str | None = None
    talla: str | None = None
    color: str | None = None
    producto: str | None = None


@strawberry.type
class Grupo:
    clave: str
    pedidos: int
    unidades: int
    monto: str = strawberry.field(description="Bolivianos, texto decimal.")


@strawberry.type
class ResumenVentas:
    periodo: Periodo
    agrupar_por: Agrupacion | None
    pedidos: int
    unidades: int
    monto: str
    grupos: list[Grupo]
    datos_al: datetime | None


@strawberry.type
class Producto:
    identificador: str
    nombre: str
    categoria: str
    stock: int = strawberry.field(description="Unidades disponibles (física − reservada) en todas sus variantes.")
    variantes: int
    ventas: int = strawberry.field(description="Unidades vendidas en pedidos confirmados.")
    monto: str


@strawberry.type
class VarianteStock:
    identificador: str
    producto: str
    sku: str
    nombre: str
    talla: str
    color: str
    disponible: int
    minimo: int


@strawberry.type
class Alerta:
    identificador: str
    variante: str
    sku: str
    nombre: str
    disponible: int
    minimo: int
    fecha: datetime


@strawberry.type
class Segmento:
    grupo: int
    nombre: str
    descripcion: str
    clientes: int
    recencia_dias: float
    frecuencia: float
    monto_bs: float
    diversidad: float


@strawberry.type
class Segmentacion:
    clientes: int
    silueta: float | None
    segmentos: list[Segmento]
    datos_al: datetime | None


def _crear(tipo, datos: dict):
    campos = {c.name for c in dataclasses.fields(tipo)}
    return tipo(**{k: (str(v) if k in ("identificador", "variante") else v) for k, v in datos.items() if k in campos})


def _limite(valor: int, maximo: int = 50) -> int:
    if not 1 <= valor <= maximo:
        raise ValueError(f"limite debe estar entre 1 y {maximo}.")
    return valor


def _consultas(info: Info) -> ConsultarAnalitica:
    return info.context["consultas"]


@strawberry.type
class Consulta:
    @strawberry.field(description="Ventas confirmadas del periodo, con agrupación opcional.")
    async def resumen_ventas(self, info: Info, periodo: Periodo, agrupar_por: Agrupacion | None = None, limite: int = 10,
                             ordenar_por: Metrica = Metrica.UNIDADES, desde: date | None = None, hasta: date | None = None,
                             filtros: FiltrosVentas | None = None, orden: OrdenGrupos = OrdenGrupos.METRICA_DESC) -> ResumenVentas:
        try:  # mismas reglas que la especificación de reportes: rango acotado y filtros de texto corto
            validados = Filtros(**dataclasses.asdict(filtros)) if filtros else None
        except ValidationError as error:
            raise ValueError(f"Filtros inválidos: {error.error_count()} errores.") from error
        r = await _consultas(info).resumen_ventas(periodo.value, agrupar_por.value if agrupar_por else None, _limite(limite),
                                                  ordenar_por.value, desde, hasta,
                                                  validados.model_dump() if validados else None, orden.value)
        return ResumenVentas(periodo=periodo, agrupar_por=agrupar_por, pedidos=r["pedidos"], unidades=r["unidades"],
                             monto=r["monto"], grupos=[_crear(Grupo, g) for g in r["grupos"]], datos_al=r["datos_al"])

    @strawberry.field(description="Datos de un reporte v2 (catálogo de campos validado): filas, totales y gráfico.")
    async def datos_reporte(self, info: Info, especificacion: JSON) -> JSON:
        try:
            spec = EspecificacionV2.model_validate(especificacion)
        except ValidationError as error:
            raise ValueError(f"Especificación inválida: {error.error_count()} errores.") from error
        return await _consultas(info).datos_reporte(spec)

    @strawberry.field(description="Productos con stock y ventas, del más vendido al menos vendido.")
    async def productos(self, info: Info, limite: int = 20) -> list[Producto]:
        return [_crear(Producto, p) for p in await _consultas(info).productos(_limite(limite))]

    @strawberry.field(description="Variantes activas con disponibilidad igual o menor a su mínimo.")
    async def stock_bajo(self, info: Info) -> list[VarianteStock]:
        return [_crear(VarianteStock, v) for v in await _consultas(info).stock_bajo()]

    @strawberry.field(description="Eventos stock_bajo recibidos de Inventario, del más reciente al más antiguo.")
    async def alertas(self, info: Info, limite: int = 20) -> list[Alerta]:
        return [_crear(Alerta, a) for a in await _consultas(info).alertas(_limite(limite))]

    @strawberry.field(description="Segmentos de clientes por K-Means (recencia, frecuencia, gasto y diversidad).")
    async def segmentos_clientes(self, info: Info) -> Segmentacion:
        r = await _consultas(info).segmentos()
        return Segmentacion(clientes=r["clientes"], silueta=r["silueta"], datos_al=r["datos_al"],
                            segmentos=[Segmento(grupo=s["grupo"], nombre=s["nombre"], descripcion=s["descripcion"],
                                                clientes=s["clientes"], **s["centroide"]) for s in r["segmentos"]])

    @strawberry.field(description="Inteligencia de negocios sobre el dataset SINTÉTICO de demostración (aislado de la "
                                  "operación): KPI, evolución mensual, productos, categorías y segmentación K-Means guardada. "
                                  "Cada bloque es un reporte v2 con conjunto DEMOSTRACION: mismas fórmulas que datosReporte.")
    async def indicadores_demostracion(self, info: Info, desde: date | None = None, hasta: date | None = None,
                                       categoria: str | None = None, producto: str | None = None) -> JSON:
        if bool(desde) != bool(hasta):
            raise ValueError("Indique fecha desde y hasta, o ninguna para todo el historial.")
        try:
            return jsonable_encoder(await _consultas(info).indicadores_demostracion(desde, hasta, categoria, producto))
        except ValidationError as error:
            raise ValueError("Filtros inválidos: " + "; ".join(e["msg"] for e in error.errors())[:300]) from error


# --- Gestión empresarial (R5): consultas y acciones de negocio de las interfaces de gestión web y Android. ---------------
# Delegan en los mismos casos de uso que las rutas REST equivalentes; no añaden reglas. Los errores llevan
# `extensions {codigo, estado_http}` para que las colas offline de los clientes los clasifiquen igual que con REST.

class ErrorGestion(Exception):
    def __init__(self, estado: int, codigo: str, mensaje: str, **extra):
        super().__init__(mensaje)
        self.extensions = {"codigo": codigo, "estado_http": estado, **extra}


@strawberry.type
class Reporte:
    identificador: str
    peticion: str | None
    salida_modelo: str | None
    especificacion: JSON
    generativa: bool
    observacion: str | None
    datos: JSON
    datos_al: str | None
    fecha: str
    interpretacion: str = strawberry.field(description="Lo que se entendió: fuente, columnas, periodo, filtros, gráfico y salida.")
    procedencia: str = strawberry.field(description="MODELO (LLM del servidor), REGLAS (respaldo limitado) o MANUAL.")


@strawberry.type
class ResultadoMision:
    mision: str
    agentes: JSON = strawberry.field(description="Respuesta de cada agente con sus fuentes (herramientas y resultados).")
    generativa: bool
    fecha: str


@strawberry.type
class Propuesta:
    identificador: str
    variante: str
    sku: str
    cantidad: int
    motivo: str
    fecha: str
    estado: str
    disponible: int | None
    minimo: int | None


@strawberry.type
class Notificacion:
    evento: str
    producto: str
    sku: str
    talla: str
    color: str
    disponible: int
    minimo: int
    mensaje: str
    origen: str
    estado: str
    fecha_evento: str
    fecha: str
    atendida_por: str | None
    fecha_atencion: str | None


@strawberry.type
class RegistroAuditoria:
    identificador: int
    fecha: str
    usuario: str
    agente: str
    herramienta: str
    argumentos: JSON
    permitido: bool
    resultado: str


@strawberry.enum
class EstadoPropuesta(Enum):
    PENDIENTE = "PENDIENTE"
    CONFIRMANDO = "CONFIRMANDO"
    REQUIERE_REVISION = "REQUIERE_REVISION"
    CONFIRMADA = "CONFIRMADA"
    RECHAZADA = "RECHAZADA"


@strawberry.enum
class EstadoAlerta(Enum):
    NUEVA = "NUEVA"
    ATENDIDA = "ATENDIDA"


@strawberry.enum
class DestinoReporte(Enum):
    PANEL = "PANEL"
    VISTA = "VISTA"
    HISTORIAL = "HISTORIAL"


@strawberry.enum
class FormatoReporte(Enum):
    PANTALLA = "PANTALLA"
    PDF = "PDF"
    EXCEL = "EXCEL"


def _plano(tipo, datos: dict):
    """Convierte la respuesta del caso de uso (la misma que serializa REST) en el tipo GraphQL."""
    plano = jsonable_encoder(datos)
    if tipo is Reporte:
        spec = plano["especificacion"]
        fecha = datetime.fromisoformat(str(plano["fecha"])) if plano.get("fecha") else None
        plano["interpretacion"] = describir_v2(spec, fecha) if spec.get("version") == 2 else describir(spec)
        plano["procedencia"] = procedencia(plano)
    return tipo(**{c.name: plano.get(c.name) for c in dataclasses.fields(tipo)})


def _servicios(info: Info):
    return info.context["servicios"]


def _usuario(info: Info):
    return info.context["usuario"]


def _rango(valor: int, maximo: int) -> int:
    if not 1 <= valor <= maximo:
        raise ErrorGestion(422, "DATOS_INVALIDOS", f"limite debe estar entre 1 y {maximo}.")
    return valor


async def _traducir(accion):
    """Mismos códigos y estados que la API REST: 404, 409, 422, 429, 503 y rechazos del servicio propietario."""
    try:
        return await accion()
    except ErrorGestion:
        raise
    except EspecificacionInvalida as error:
        raise ErrorGestion(422, "ESPECIFICACION_INVALIDA", str(error), errores=error.errores)
    except ReporteAmbiguo as error:
        raise ErrorGestion(422, "AMBIGUA", str(error), sugerencias=error.sugerencias)
    except ReporteNoDisponible as error:
        raise ErrorGestion(422, "NO_DISPONIBLE", str(error), motivos=error.motivos)
    except NotificacionInexistente:
        raise ErrorGestion(404, "NO_ENCONTRADO", "La notificación no existe.")
    except LookupError as error:
        raise ErrorGestion(404, "NO_ENCONTRADO", str(error))
    except PermissionError as error:
        raise ErrorGestion(409, "PROPUESTA_RESUELTA", str(error))
    except ServicioNoDisponible as error:
        raise ErrorGestion(503, "SERVICIO_NO_DISPONIBLE", f"Un servicio necesario no está disponible: {error}")
    except RechazoDeServicio as error:
        # El cuerpo del propietario (p. ej. el producto vigente en un 409) viaja completo para la revisión de la cola.
        estado = error.estado if 400 <= error.estado < 500 else 502
        raise ErrorGestion(estado, error.cuerpo.get("código", "RECHAZO_DE_SERVICIO"), str(error), cuerpo=error.cuerpo)


async def _con_llm(info: Info, accion):
    """Una misión o un reporte a la vez (mismo semáforo que REST): una ráfaga no monopoliza el modelo local."""
    trabajo = info.context["trabajo_llm"]
    if trabajo.locked():
        raise ErrorGestion(429, "OCUPADO", "Los agentes están atendiendo otra solicitud. Inténtalo en unos segundos.")
    async with trabajo:
        return await _traducir(accion)


IDENTIFICADOR = re.compile(r"^[A-Za-z0-9-]{1,64}$")
CLAVE = re.compile(r"^[A-Za-z0-9-]{8,128}$")


def _id(valor: str, nombre: str) -> str:
    """Los segmentos de ruta del propietario solo admiten identificadores (sin «/», «..» ni espacios)."""
    if not IDENTIFICADOR.fullmatch(valor):
        raise ErrorGestion(422, "DATOS_INVALIDOS", f"{nombre} no es un identificador válido.")
    return valor


def _cuerpo(datos: JSON) -> dict:
    if not isinstance(datos, dict):
        raise ErrorGestion(422, "DATOS_INVALIDOS", "Los datos deben ser un objeto.")
    return datos


async def _inventario(info: Info, operacion: str, *, ruta: dict | None = None, clave: str | None = None,
                      datos: JSON | None = None, consulta: dict | None = None) -> JSON:
    """Delega en el contrato propietario de Inventario con el JWT del administrador; IA no aplica reglas de Inventario."""
    if clave is not None and not CLAVE.fullmatch(clave):
        raise ErrorGestion(422, "DATOS_INVALIDOS", "La clave de idempotencia no es válida.")
    cuerpo = _cuerpo(datos) if datos is not None else None
    usuario = _usuario(info)
    return await _traducir(lambda: _servicios(info).inventario_gestion.ejecutar(
        operacion, usuario.token, ruta=ruta, clave=clave, datos=cuerpo, consulta=consulta))


@strawberry.type
class ConsultaGestion(Consulta):
    @strawberry.field(description="Historial de reportes, del más reciente al más antiguo.")
    async def reportes(self, info: Info, limite: int = 30) -> list[Reporte]:
        return [_plano(Reporte, r) for r in await _servicios(info).consultas.reportes(_rango(limite, 100))]

    @strawberry.field(description="Un reporte guardado con su especificación, datos y fecha de los datos.")
    async def reporte(self, info: Info, identificador: uuid.UUID) -> Reporte:
        r = await _servicios(info).consultas.reporte(str(identificador))
        if r is None:
            raise ErrorGestion(404, "NO_ENCONTRADO", "El reporte no existe.")
        return _plano(Reporte, r)

    @strawberry.field(description="Propuestas de reposición de los agentes; confirmar exige una acción del administrador.")
    async def propuestas(self, info: Info, estado: EstadoPropuesta | None = None) -> list[Propuesta]:
        return [_plano(Propuesta, p) for p in await _servicios(info).consultas.propuestas(estado.value if estado else None)]

    @strawberry.field(description="Alertas de stock creadas por la automatización (flujo n8n A).")
    async def notificaciones(self, info: Info, estado: EstadoAlerta | None = None) -> list[Notificacion]:
        return [_plano(Notificacion, n) for n in await _servicios(info).notificaciones.listar(estado.value if estado else None)]

    # --- Inventario (propietario de productos, variantes, stock e ingesta). Cuerpos = contrato REST de Inventario. ---
    @strawberry.field(description="Página de productos para administración (incluye inactivos): {productos, paginación}.")
    async def productos_admin(self, info: Info, pagina: int = 1, limite: int = 100) -> JSON:
        return await _inventario(info, "productos_admin", consulta={"página": _rango(pagina, 10000), "límite": _rango(limite, 100)})

    @strawberry.field(description="Producto para administración: {producto}.")
    async def producto_admin(self, info: Info, producto: str) -> JSON:
        return await _inventario(info, "producto_admin", ruta={"producto": _id(producto, "producto")})

    @strawberry.field(description="Variantes de un producto con existencias y versión: {variantes}.")
    async def variantes_admin(self, info: Info, producto: str) -> JSON:
        return await _inventario(info, "variantes_admin", ruta={"producto": _id(producto, "producto")})

    @strawberry.field(description="Variante con existencias y versión vigente: {variante}.")
    async def variante_admin(self, info: Info, variante: str) -> JSON:
        return await _inventario(info, "variante_admin", ruta={"variante": _id(variante, "variante")})

    @strawberry.field(description="Historial de movimientos de stock de una variante: {movimientos}.")
    async def movimientos(self, info: Info, variante: str) -> JSON:
        return await _inventario(info, "movimientos", ruta={"variante": _id(variante, "variante")})

    @strawberry.field(description="Si la preparación de fotografías de prenda está habilitada: {habilitado}.")
    async def capacidades_ingesta(self, info: Info) -> JSON:
        return await _inventario(info, "capacidades_ingesta")

    @strawberry.field(description="Estado de un trabajo de ingesta (calidad, avisos, bloqueos): {trabajo}.")
    async def trabajo_ingesta(self, info: Info, producto: str, trabajo: str) -> JSON:
        return await _inventario(info, "trabajo_ingesta",
                                 ruta={"producto": _id(producto, "producto"), "trabajo": _id(trabajo, "trabajo")})

    @strawberry.field(description="Uso de herramientas MCP por los agentes, permitido o rechazado.")
    async def auditoria(self, info: Info, limite: int = 50) -> list[RegistroAuditoria]:
        return [_plano(RegistroAuditoria, a) for a in await _servicios(info).consultas.auditoria(_rango(limite, 200))]


@strawberry.type
class Mutacion:
    @strawberry.mutation(description="Genera un reporte desde texto (interpretado) o desde una especificación editada.")
    async def generar_reporte(self, info: Info, peticion: str | None = None, especificacion: JSON | None = None,
                              destino: DestinoReporte | None = None,
                              formatos: list[FormatoReporte] | None = None) -> Reporte:
        if (peticion is None) == (especificacion is None):
            raise ErrorGestion(422, "DATOS_INVALIDOS", "Envía una petición en texto o una especificación, no ambas.")
        if peticion is not None and not 3 <= len(peticion) <= 500:
            raise ErrorGestion(422, "DATOS_INVALIDOS", "La petición debe tener entre 3 y 500 caracteres.")
        if especificacion is not None and not isinstance(especificacion, dict):
            raise ErrorGestion(422, "ESPECIFICACION_INVALIDA", "La especificación debe ser un objeto.")
        usuario = _usuario(info)
        reporte = await _con_llm(info, lambda: _servicios(info).reportes.ejecutar(
            usuario.sub, usuario.token, peticion, especificacion, destino.value if destino else None,
            [f.value for f in formatos] if formatos is not None else None))
        return _plano(Reporte, reporte)

    @strawberry.mutation(description="Misión para los agentes, p. ej. «monitorea mi negocio».")
    async def ejecutar_mision(self, info: Info, mision: str) -> ResultadoMision:
        if not 3 <= len(mision) <= 500:
            raise ErrorGestion(422, "DATOS_INVALIDOS", "La misión debe tener entre 3 y 500 caracteres.")
        usuario = _usuario(info)
        return _plano(ResultadoMision, await _con_llm(info, lambda: _servicios(info).mision.ejecutar(mision, usuario.sub, usuario.token)))

    @strawberry.mutation(description="Confirma (escribe en Inventario con la identidad del administrador) o rechaza una propuesta.")
    async def resolver_propuesta(self, info: Info, identificador: uuid.UUID, confirmar: bool) -> Propuesta:
        gestor, usuario = _servicios(info).propuestas, _usuario(info)
        if confirmar:
            resultado = await _traducir(lambda: gestor.confirmar(str(identificador), usuario.sub, usuario.token))
        else:
            resultado = await _traducir(lambda: gestor.rechazar(str(identificador), usuario.sub))
        return _plano(Propuesta, resultado)

    @strawberry.mutation(description="Marca una alerta de stock como atendida. Repetirla devuelve la misma alerta.")
    async def atender_notificacion(self, info: Info, evento: uuid.UUID) -> Notificacion:
        usuario = _usuario(info)
        return _plano(Notificacion, await _traducir(lambda: _servicios(info).notificaciones.atender(str(evento), usuario.sub)))


@strawberry.type
class MutacionGestion(Mutacion):
    """Escrituras de Inventario: misma Idempotency-Key y `versión_esperada` (dentro de `datos`) que con REST.
    Inventario resuelve duplicados y conflictos (409 con la entidad vigente en `extensions.cuerpo`)."""

    @strawberry.mutation(description="Registra un producto: {producto}.")
    async def crear_producto(self, info: Info, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "crear_producto", clave=clave, datos=datos)

    @strawberry.mutation(description="Modifica un producto con versión esperada: {producto}.")
    async def modificar_producto(self, info: Info, producto: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "modificar_producto", ruta={"producto": _id(producto, "producto")}, clave=clave, datos=datos)

    @strawberry.mutation(description="Crea una variante (talla/color/SKU): {variante}.")
    async def crear_variante(self, info: Info, producto: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "crear_variante", ruta={"producto": _id(producto, "producto")}, clave=clave, datos=datos)

    @strawberry.mutation(description="Modifica una variante con versión esperada: {variante}.")
    async def modificar_variante(self, info: Info, variante: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "modificar_variante", ruta={"variante": _id(variante, "variante")}, clave=clave, datos=datos)

    @strawberry.mutation(description="Entrada o salida de stock con motivo y versión esperada: {variante}.")
    async def registrar_movimiento(self, info: Info, variante: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "registrar_movimiento", ruta={"variante": _id(variante, "variante")}, clave=clave, datos=datos)

    @strawberry.mutation(description="Fija el mínimo de stock con versión esperada: {variante}.")
    async def fijar_minimo(self, info: Info, variante: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "fijar_minimo", ruta={"variante": _id(variante, "variante")}, clave=clave, datos=datos)

    @strawberry.mutation(description="Publica una prenda preparada (versión esperada; aceptar_avisos si los hay): {trabajo}.")
    async def publicar_recurso(self, info: Info, producto: str, trabajo: str, clave: str, datos: JSON) -> JSON:
        return await _inventario(info, "publicar_recurso", clave=clave, datos=datos,
                                 ruta={"producto": _id(producto, "producto"), "trabajo": _id(trabajo, "trabajo")})


def _ocultar(error: GraphQLError) -> bool:
    """Los errores de validación de argumentos y de negocio se muestran; los internos (p. ej., de la base) se enmascaran."""
    original = getattr(error, "original_error", None)
    return original is not None and not isinstance(original, (ValueError, ErrorGestion))


def _extensiones():
    # Límites de costo: profundidad, tamaño y alias (cada alias de segmentosClientes ejecutaría un K-Means completo).
    return [lambda: QueryDepthLimiter(max_depth=6), lambda: MaxTokensLimiter(max_token_count=2000),
            lambda: MaxAliasesLimiter(max_alias_count=8),
            lambda: MaskErrors(should_mask_error=_ocultar, error_message="Error interno de la consulta.")]


# Solo lectura: lo usan las herramientas MCP de los agentes. Sin mutaciones.
esquema = strawberry.Schema(query=Consulta, extensions=_extensiones())
class EsquemaGestion(strawberry.Schema):
    """Un rechazo de negocio (404, 409, 422 AMBIGUA…) es una respuesta esperada: no se registra como error del servidor."""

    def process_errors(self, errors, execution_context=None):
        inesperados = [e for e in errors if not isinstance(getattr(e, "original_error", None), ErrorGestion)]
        if inesperados:
            super().process_errors(inesperados, execution_context)


# Interfaces de gestión (rol admin): lecturas analíticas + consultas y acciones de negocio.
esquema_gestion = EsquemaGestion(query=ConsultaGestion, mutation=MutacionGestion, extensions=_extensiones())
