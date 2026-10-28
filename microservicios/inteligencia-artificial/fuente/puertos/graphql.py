"""GraphQL del sistema de gestión empresarial (solo rol admin). Lee únicamente el modelo de lectura `clb_analitica`.

Los campos se piden a gusto (p. ej. `productos { nombre stock ventas }`), pero las operaciones, filtros y límites son
cerrados: no hay SQL ni filtros libres. Las herramientas MCP de los agentes llaman a este mismo esquema.
"""
import dataclasses
from datetime import datetime
from enum import Enum

import strawberry
from graphql import GraphQLError
from strawberry.extensions import MaskErrors, MaxAliasesLimiter, MaxTokensLimiter, QueryDepthLimiter
from strawberry.types import Info

from fuente.aplicacion.consultas import ConsultarAnalitica


@strawberry.enum(description="Ventana de tiempo; HOY es el día calendario de Bolivia.")
class Periodo(Enum):
    HOY = "HOY"
    SEMANA = "SEMANA"
    MES = "MES"
    TODO = "TODO"


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
                             ordenar_por: Metrica = Metrica.UNIDADES) -> ResumenVentas:
        r = await _consultas(info).resumen_ventas(periodo.value, agrupar_por.value if agrupar_por else None, _limite(limite),
                                                  ordenar_por.value)
        return ResumenVentas(periodo=periodo, agrupar_por=agrupar_por, pedidos=r["pedidos"], unidades=r["unidades"],
                             monto=r["monto"], grupos=[_crear(Grupo, g) for g in r["grupos"]], datos_al=r["datos_al"])

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


def _ocultar(error: GraphQLError) -> bool:
    """Los errores de validación de argumentos se muestran; los internos (p. ej., de la base) se enmascaran."""
    original = getattr(error, "original_error", None)
    return original is not None and not isinstance(original, ValueError)


# Límites de costo: profundidad, tamaño y alias (cada alias de segmentosClientes ejecutaría un K-Means completo).
esquema = strawberry.Schema(query=Consulta, extensions=[
    lambda: QueryDepthLimiter(max_depth=6), lambda: MaxTokensLimiter(max_token_count=2000),
    lambda: MaxAliasesLimiter(max_alias_count=8), lambda: MaskErrors(should_mask_error=_ocultar, error_message="Error interno de la consulta.")])
