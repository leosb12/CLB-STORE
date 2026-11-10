"""Reportes v2: catálogo explícito de campos, relaciones y operaciones permitidas, y la especificación que lo usa.

El modelo de lenguaje (o las reglas de respaldo, o la persona al editar) solo eligen nombres de este catálogo; el backend
valida la combinación y la infraestructura traduce cada nombre a una expresión SQL fija de su lista blanca. Nunca hay SQL
generado por IA ni acceso a bases ajenas: los datos salen del modelo de lectura `clb_analitica` (CQRS).

Relaciones que sí se resuelven en el modelo de lectura:
- línea de venta → pedido (fecha, estado, cliente) → nombre del cliente (proyección por contrato interno de Clientes);
- línea de venta → existencias actuales de la misma variante (stock de hoy, no el del día de la venta).
El precio unitario y el total de cada línea son los históricos guardados al confirmar el pedido, nunca el precio actual.
"""
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fuente.dominio.reportes import ZONA_BOLIVIA  # America/La_Paz: UTC−4 fijo, sin horario de verano

TipoDato = Literal["TEXTO", "ENTERO", "DINERO", "FECHA", "BOOLEANO"]
Clase = Literal["DIMENSION", "VALOR", "METRICA"]
Fuente = Literal["VENTAS", "INVENTARIO"]
TipoReporte = Literal["DETALLE", "AGREGADO"]
Periodo = Literal["HOY", "AYER", "ESTA_SEMANA", "SEMANA_PASADA", "ULTIMOS_7_DIAS", "ESTE_MES", "MES_PASADO",
                  "ULTIMOS_30_DIAS", "TODO", "RANGO"]
Operador = Literal["IGUAL", "CONTIENE", "MAYOR_O_IGUAL", "MENOR_O_IGUAL"]
Direccion = Literal["ASC", "DESC"]
TipoGrafico = Literal["NINGUNO", "BARRAS", "LINEAS"]
Formato = Literal["PANTALLA", "PDF", "EXCEL"]
# OPERACION: modelo de lectura de la tienda. DEMOSTRACION: dataset sintético aislado (dominio/demostracion.py).
Conjunto = Literal["OPERACION", "DEMOSTRACION"]
Procedencia = Literal["MODELO", "REGLAS", "MANUAL"]


@dataclass(frozen=True)
class Campo:
    etiqueta: str
    tipo: TipoDato
    clase: Clase
    nota: str = ""


_DIM_PRODUCTO = {
    "PRODUCTO": Campo("Producto", "TEXTO", "DIMENSION"),
    "SKU": Campo("SKU", "TEXTO", "DIMENSION"),
    "CATEGORIA": Campo("Categoría", "TEXTO", "DIMENSION"),
    "TALLA": Campo("Talla", "TEXTO", "DIMENSION"),
    "COLOR": Campo("Color", "TEXTO", "DIMENSION"),
}

CATALOGO: dict[str, dict[str, Campo]] = {
    "VENTAS": {
        "FECHA": Campo("Fecha", "FECHA", "DIMENSION", "Día del pedido en Bolivia"),
        "MES": Campo("Mes", "TEXTO", "DIMENSION", "Mes del pedido en Bolivia, AAAA-MM"),
        "PEDIDO": Campo("Pedido", "TEXTO", "DIMENSION", "Primeros 8 caracteres del identificador"),
        "ESTADO": Campo("Estado", "TEXTO", "DIMENSION"),
        "CLIENTE": Campo("Cliente", "TEXTO", "DIMENSION", "Nombre del perfil o, si no lo editó, el de su cuenta"),
        **_DIM_PRODUCTO,
        "CANTIDAD": Campo("Cantidad", "ENTERO", "VALOR"),
        "PRECIO_UNITARIO": Campo("Precio unitario", "DINERO", "VALOR", "Precio histórico al confirmar el pedido"),
        "SUBTOTAL": Campo("Total comprado", "DINERO", "VALOR", "Cantidad × precio unitario de la línea"),
        "STOCK_ACTUAL": Campo("Stock disponible actual", "ENTERO", "VALOR", "Existencia de hoy, no la del día de la venta"),
        "UNIDADES": Campo("Unidades", "ENTERO", "METRICA"),
        "MONTO": Campo("Ventas (Bs)", "DINERO", "METRICA"),
        "PEDIDOS": Campo("Pedidos", "ENTERO", "METRICA"),
        "CLIENTES": Campo("Clientes", "ENTERO", "METRICA"),
        "PRECIO_PROMEDIO": Campo("Precio promedio", "DINERO", "METRICA", "Ventas ÷ unidades"),
        "TICKET_PROMEDIO": Campo("Ticket promedio", "DINERO", "METRICA", "Ventas ÷ pedidos"),
    },
    "INVENTARIO": {
        **_DIM_PRODUCTO,
        "STOCK_FISICO": Campo("Stock físico", "ENTERO", "VALOR"),
        "STOCK_RESERVADO": Campo("Reservado", "ENTERO", "VALOR"),
        "STOCK_DISPONIBLE": Campo("Disponible", "ENTERO", "VALOR"),
        "STOCK_MINIMO": Campo("Mínimo", "ENTERO", "VALOR"),
        "STOCK_BAJO": Campo("Stock bajo", "BOOLEANO", "VALOR"),
        "DISPONIBLE_TOTAL": Campo("Disponible total", "ENTERO", "METRICA"),
        "FISICO_TOTAL": Campo("Stock físico total", "ENTERO", "METRICA"),
        "VARIANTES": Campo("Variantes", "ENTERO", "METRICA"),
        "VARIANTES_STOCK_BAJO": Campo("Variantes con stock bajo", "ENTERO", "METRICA"),
    },
}
TODOS_LOS_CAMPOS = sorted({c for campos in CATALOGO.values() for c in campos})
OPERADORES: dict[str, tuple[str, ...]] = {"TEXTO": ("IGUAL", "CONTIENE"), "ENTERO": ("IGUAL", "MAYOR_O_IGUAL", "MENOR_O_IGUAL"),
                                          "DINERO": ("IGUAL", "MAYOR_O_IGUAL", "MENOR_O_IGUAL"), "BOOLEANO": ("IGUAL",),
                                          "FECHA": ()}
ESTADOS_PEDIDO = ("CONFIRMADO", "CANCELADO")
# Mismo concepto en el otro tipo de reporte: «total comprado» por línea en un detalle es «ventas» sumadas en un agregado.
A_AGREGADO = {"CANTIDAD": "UNIDADES", "SUBTOTAL": "MONTO", "PRECIO_UNITARIO": "PRECIO_PROMEDIO",
              "STOCK_DISPONIBLE": "DISPONIBLE_TOTAL", "STOCK_FISICO": "FISICO_TOTAL"}
A_DETALLE = {"UNIDADES": "CANTIDAD", "MONTO": "SUBTOTAL", "DISPONIBLE_TOTAL": "STOCK_DISPONIBLE", "FISICO_TOTAL": "STOCK_FISICO"}
VALOR_GRAFICO = {"VENTAS": "MONTO", "INVENTARIO": "DISPONIBLE_TOTAL"}

TextoCorto = Field(min_length=1, max_length=60, pattern=r"^[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ][0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ .,\/'-]*$")
MAXIMO_RANGO_DIAS = 366


class Filtro(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    campo: str
    operador: Operador
    valor: str = TextoCorto


class OrdenCampo(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    campo: str
    direccion: Direccion = "DESC"


class Grafico(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    tipo: TipoGrafico = "NINGUNO"
    eje: str | None = None
    valor: str | None = None


class EspecificacionV2(BaseModel):
    """Especificación de reporte validada contra el catálogo. Lo que no está aquí no se puede pedir."""
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[2] = 2
    conjunto: Conjunto = "OPERACION"
    titulo: str = Field(min_length=1, max_length=80, pattern=r"^[^\x00-\x1f<>{}=+\-@][^\x00-\x1f<>{}]*$")
    fuente: Fuente = "VENTAS"
    tipo: TipoReporte
    columnas: list[str] = Field(min_length=1, max_length=10)
    filtros: list[Filtro] = Field(default_factory=list, max_length=6)
    periodo: Periodo = "ESTE_MES"
    desde: date | None = None
    hasta: date | None = None
    orden: list[OrdenCampo] = Field(default_factory=list, max_length=2)
    limite: int = Field(default=200, ge=1, le=500)
    grafico: Grafico = Grafico()
    # Vacío = sin formato indicado: se muestra en pantalla y se ofrecen las exportaciones.
    formatos: list[Formato] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def coherente(self):
        campos = CATALOGO[self.fuente]
        if len(set(self.columnas)) != len(self.columnas):
            raise ValueError("Las columnas no pueden repetirse.")
        if len(set(self.formatos)) != len(self.formatos):
            raise ValueError("Los formatos no pueden repetirse.")
        for nombre in self.columnas:
            if nombre not in campos:
                raise ValueError(f"{nombre} no es un campo de {self.fuente.lower()}.")
            clase = campos[nombre].clase
            if self.tipo == "DETALLE" and clase == "METRICA":
                raise ValueError(f"{campos[nombre].etiqueta} es un total: va en un reporte agregado.")
            if self.tipo == "AGREGADO" and clase == "VALOR":
                raise ValueError(f"{campos[nombre].etiqueta} es un dato de cada fila: va en un reporte de detalle.")
        if self.tipo == "AGREGADO":
            if not any(campos[c].clase == "METRICA" for c in self.columnas):
                raise ValueError("Un reporte agregado necesita al menos un total (unidades, ventas, pedidos…).")
            if sum(campos[c].clase == "DIMENSION" for c in self.columnas) > 3:
                raise ValueError("Un reporte agregado agrupa por 3 campos como máximo.")
        for f in self.filtros:
            if f.campo not in campos:
                raise ValueError(f"No se puede filtrar por {f.campo} en {self.fuente.lower()}.")
            campo = campos[f.campo]
            if f.operador not in OPERADORES[campo.tipo]:
                raise ValueError(f"{campo.etiqueta} no admite el filtro {f.operador.lower()}.")
            if campo.clase == "METRICA" and self.tipo != "AGREGADO":
                raise ValueError(f"Filtrar por {campo.etiqueta.lower()} requiere un reporte agregado.")
            valor_filtro(campo.tipo, f.campo, f.valor)  # valida el valor (número, sí/no, estado)
        for o in self.orden:
            if o.campo not in self.columnas:
                raise ValueError("Solo se puede ordenar por columnas del reporte.")
        if self.fuente == "INVENTARIO" and self.periodo != "TODO":
            raise ValueError("El inventario es la existencia actual: no tiene historial por periodo.")
        if self.periodo == "RANGO":
            if not (self.desde and self.hasta):
                raise ValueError("Un rango necesita fecha desde y hasta.")
            if self.desde > self.hasta:
                raise ValueError("La fecha desde no puede ser posterior a hasta.")
            if (self.hasta - self.desde).days >= MAXIMO_RANGO_DIAS:
                raise ValueError(f"El rango no puede superar {MAXIMO_RANGO_DIAS} días.")
            if self.hasta > datetime.now(ZONA_BOLIVIA).date():
                raise ValueError("El rango no puede terminar en una fecha futura.")
        elif self.desde or self.hasta:
            raise ValueError("Las fechas solo se indican con periodo RANGO.")
        g = self.grafico
        if g.tipo == "NINGUNO":
            if g.eje or g.valor:
                raise ValueError("Sin gráfico no se indican eje ni valor.")
        else:
            if g.eje not in campos or campos[g.eje].clase != "DIMENSION":
                raise ValueError("El eje del gráfico debe ser un campo para agrupar (cliente, producto, talla, fecha…).")
            if g.valor not in campos or campos[g.valor].clase != "METRICA":
                raise ValueError("El valor del gráfico debe ser un total (unidades, ventas, pedidos…).")
            if g.tipo == "LINEAS" and g.eje not in ("FECHA", "MES"):
                raise ValueError("Un gráfico de líneas muestra una evolución: su eje es la fecha.")
        return self

    @property
    def muestra_pantalla(self) -> bool:
        return not self.formatos or "PANTALLA" in self.formatos

    def formatos_permitidos(self) -> set[str]:
        """Archivos que se pueden descargar: los pedidos; sin archivos pedidos, se ofrecen ambos bajo demanda."""
        pedidos = {f for f in self.formatos if f != "PANTALLA"}
        return pedidos or {"PDF", "EXCEL"}


def valor_filtro(tipo: str, campo: str, valor: str):
    """Valor tipado de un filtro (siempre como parámetro enlazado). Dinero en Bs → centavos enteros."""
    if campo == "ESTADO":
        estado = valor.strip().upper()
        if estado not in ESTADOS_PEDIDO:
            raise ValueError("El estado de un pedido es CONFIRMADO o CANCELADO.")
        return estado
    if tipo == "ENTERO":
        if not re.fullmatch(r"\d{1,9}", valor.strip()):
            raise ValueError("El filtro necesita un número entero.")
        return int(valor)
    if tipo == "DINERO":
        texto = valor.strip().replace("Bs", "").strip().replace(",", ".")
        if not re.fullmatch(r"\d{1,9}(\.\d{1,2})?", texto):
            raise ValueError("El filtro de dinero necesita un monto en Bs, p. ej. 150.50.")
        entero, _, decimales = texto.partition(".")
        return int(entero) * 100 + int((decimales + "00")[:2])
    if tipo == "BOOLEANO":
        texto = valor.strip().upper()
        if texto not in ("SI", "SÍ", "NO"):
            raise ValueError("El filtro de stock bajo es SI o NO.")
        return texto != "NO"
    return valor.strip()


# --- Periodos calendario de Bolivia -------------------------------------------------------------------------------

def ventana(periodo: str, ahora: datetime, desde: date | None = None, hasta: date | None = None) -> tuple[datetime | None, datetime | None]:
    """[inicio, fin) del periodo. «Esta semana» empieza el lunes 00:00 de La Paz; «últimos 7 días» es móvil."""
    local = ahora.astimezone(ZONA_BOLIVIA)
    hoy = datetime.combine(local.date(), time(), ZONA_BOLIVIA)
    lunes = hoy - timedelta(days=hoy.weekday())
    primero = hoy.replace(day=1)
    if periodo == "HOY":
        return hoy, None
    if periodo == "AYER":
        return hoy - timedelta(days=1), hoy
    if periodo == "ESTA_SEMANA":
        return lunes, None
    if periodo == "SEMANA_PASADA":
        return lunes - timedelta(days=7), lunes
    if periodo == "ULTIMOS_7_DIAS":
        return ahora - timedelta(days=7), None
    if periodo == "ESTE_MES":
        return primero, None
    if periodo == "MES_PASADO":
        return (primero - timedelta(days=1)).replace(day=1), primero
    if periodo == "ULTIMOS_30_DIAS":
        return ahora - timedelta(days=30), None
    if periodo == "RANGO":
        return datetime.combine(desde, time(), ZONA_BOLIVIA), datetime.combine(hasta + timedelta(days=1), time(), ZONA_BOLIVIA)
    return None, None


NOMBRE_PERIODO = {"HOY": "hoy", "AYER": "ayer", "ESTA_SEMANA": "esta semana (desde el lunes)", "SEMANA_PASADA": "la semana pasada",
                  "ULTIMOS_7_DIAS": "últimos 7 días", "ESTE_MES": "este mes", "MES_PASADO": "el mes pasado",
                  "ULTIMOS_30_DIAS": "últimos 30 días", "TODO": "todo el historial"}


def _f(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def texto_periodo(spec: dict, ahora: datetime | None = None) -> str:
    """Periodo con sus fechas reales: distingue «esta semana» (calendario) de «últimos 7 días» (móvil)."""
    periodo = spec.get("periodo", "TODO")
    if spec.get("fuente") == "INVENTARIO":
        return "existencias actuales"
    if periodo == "RANGO":
        return f"del {_f(date.fromisoformat(str(spec['desde'])))} al {_f(date.fromisoformat(str(spec['hasta'])))}"
    if periodo == "TODO" or ahora is None:
        return NOMBRE_PERIODO.get(periodo, periodo.lower())
    inicio, fin = ventana(periodo, ahora)
    final = (fin - timedelta(days=1)).date() if fin else ahora.astimezone(ZONA_BOLIVIA).date()
    return f"{NOMBRE_PERIODO[periodo]}: {_f(inicio.astimezone(ZONA_BOLIVIA).date())} al {_f(final)}"


NOMBRE_FORMATO = {"PANTALLA": "pantalla", "PDF": "PDF", "EXCEL": "Excel"}
NOMBRE_OPERADOR = {"IGUAL": "=", "CONTIENE": "contiene", "MAYOR_O_IGUAL": "≥", "MENOR_O_IGUAL": "≤"}


def describir_v2(spec: dict, ahora: datetime | None = None) -> str:
    """Interpretación legible: qué fuente, columnas, periodo, filtros, orden, gráfico y salida se entendieron."""
    campos = CATALOGO[spec["fuente"]]
    partes = ["Datos sintéticos de demostración"] if spec.get("conjunto") == "DEMOSTRACION" else []
    partes += [("Detalle de " if spec["tipo"] == "DETALLE" else "Totales de ") + spec["fuente"].lower(),
              ", ".join(campos[c].etiqueta for c in spec["columnas"]), texto_periodo(spec, ahora)]
    filtros = spec.get("filtros") or []
    if spec["fuente"] == "VENTAS" and not any(f["campo"] == "ESTADO" for f in filtros):
        partes.append("solo pedidos confirmados")
    if filtros:
        partes.append("filtro: " + "; ".join(f"{campos[f['campo']].etiqueta} {NOMBRE_OPERADOR[f['operador']]} {f['valor']}"
                                             for f in filtros))
    if spec.get("orden"):
        partes.append("orden: " + ", ".join(f"{campos[o['campo']].etiqueta} {'↓' if o['direccion'] == 'DESC' else '↑'}"
                                            for o in spec["orden"]))
    g = spec.get("grafico") or {}
    if g.get("tipo", "NINGUNO") != "NINGUNO":
        partes.append(f"gráfico de {'barras' if g['tipo'] == 'BARRAS' else 'líneas'}: "
                      f"{campos[g['valor']].etiqueta} por {campos[g['eje']].etiqueta.lower()}")
    else:
        partes.append("sin gráfico")
    formatos = spec.get("formatos") or []
    if not formatos:
        partes.append("salida: pantalla (exportaciones a pedido)")
    else:
        solo = len(formatos) == 1
        partes.append("salida: " + ("solo " if solo else "") + " y ".join(NOMBRE_FORMATO[f] for f in formatos))
    return " · ".join(partes)


# --- Normalización (común a modelo, reglas y edición manual) --------------------------------------------------------

def normalizar(datos: dict) -> tuple[dict, list[str]]:
    """Ajustes sin cambiar lo pedido, cada uno anotado: el mismo concepto en el otro tipo de reporte y el eje/valor
    del gráfico cuando se pide «un gráfico» sin decir de qué. Lo que no encaja se deja para que la validación lo rechace."""
    datos = dict(datos)
    notas: list[str] = []
    fuente = datos.get("fuente") if datos.get("fuente") in CATALOGO else "VENTAS"
    campos = CATALOGO[fuente]
    tipo = datos.get("tipo")
    columnas = []
    for c in datos.get("columnas") or []:
        nuevo = A_AGREGADO.get(c) if tipo == "AGREGADO" and campos.get(c, Campo("", "TEXTO", "DIMENSION")).clase == "VALOR" else \
            A_DETALLE.get(c) if tipo == "DETALLE" and campos.get(c, Campo("", "TEXTO", "DIMENSION")).clase == "METRICA" else None
        if nuevo and nuevo in campos:
            notas.append(f"«{campos[c].etiqueta}» en un reporte {'agregado' if tipo == 'AGREGADO' else 'de detalle'} se muestra "
                         f"como «{campos[nuevo].etiqueta}».")
            c = nuevo
        if c not in columnas:
            columnas.append(c)
    datos["columnas"] = columnas
    if fuente == "INVENTARIO":
        datos["periodo"] = datos.get("periodo") or "TODO"
    grafico = dict(datos.get("grafico") or {})
    if grafico.get("tipo", "NINGUNO") == "NINGUNO":
        grafico = {"tipo": "NINGUNO", "eje": None, "valor": None}
    else:
        dims = [c for c in columnas if campos.get(c) and campos[c].clase == "DIMENSION" and c not in ("PEDIDO",)]
        metricas = [c for c in columnas if campos.get(c) and campos[c].clase == "METRICA"]
        # En un agregado el gráfico dibuja la misma tabla: su eje y su valor salen de las columnas.
        if not grafico.get("eje") or (tipo == "AGREGADO" and dims and grafico["eje"] not in dims):
            grafico["eje"] = "FECHA" if grafico["tipo"] == "LINEAS" else (dims[0] if dims else None)
        if not grafico.get("valor") or (metricas and grafico["valor"] not in metricas):
            grafico["valor"] = metricas[0] if metricas else VALOR_GRAFICO[fuente]
        if grafico.get("eje") and grafico["eje"] in campos:
            notas.append(f"Gráfico: {campos[grafico['valor']].etiqueta} por {campos[grafico['eje']].etiqueta.lower()}.")
    datos["grafico"] = grafico
    return datos, notas


# --- Lo que el sistema no tiene: se explica en vez de sustituir -------------------------------------------------------

NO_DISPONIBLE = (
    (r"\b(costo|coste|margen|ganancia|utilidad|rentabilidad)", "No se registra el costo de las prendas: no hay margen ni ganancia."),
    (r"\bproveedor", "No se registran proveedores."),
    (r"\b(correo|email|e-mail|telefono|celular|direccion|domicilio|ci|carnet)s? (de |del |de los )?(los )?client",
     "Los datos de contacto o identidad de los clientes no se incluyen en reportes; solo su nombre."),
    (r"\b(edad|genero|sexo)\b", "No se registran edad ni género de los clientes."),
    (r"\b(descuento|cupon|promocion)", "No se registran descuentos ni promociones."),
    (r"\bdevoluci", "No hay devoluciones registradas; solo pedidos confirmados o cancelados."),
    (r"\b(visita|trafico|carrito abandonado|carritos abandonados)", "No se registran visitas ni carritos abandonados."),
)
GRAFICO_NO_SOPORTADO = r"\b(torta|pastel|circular|dona|pie)\b"


def normalizar_texto(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sin_tildes)


def limitaciones(peticion: str) -> list[str]:
    texto = normalizar_texto(peticion)
    return [mensaje for patron, mensaje in NO_DISPONIBLE if re.search(patron, texto)]


def pide_grafico_no_soportado(peticion: str) -> bool:
    return re.search(GRAFICO_NO_SOPORTADO, normalizar_texto(peticion)) is not None


# --- Compatibilidad: una especificación v1 del historial se expresa en el catálogo v2 ------------------------------

_PERIODO_V1 = {"HOY": "HOY", "SEMANA": "ULTIMOS_7_DIAS", "MES": "ULTIMOS_30_DIAS", "TODO": "TODO", "RANGO": "RANGO"}
_GRUPO_V1 = {"TALLA": "TALLA", "COLOR": "COLOR", "CATEGORIA": "CATEGORIA", "PRODUCTO": "PRODUCTO", "DIA": "FECHA"}


def desde_v1(spec: dict) -> dict:
    """SEMANA y MES de v1 eran ventanas móviles de 7 y 30 días: se conservan así (no se convierten a calendario)."""
    metricas = [spec["metrica"], *(spec.get("metricas_extra") or [])]
    dims = [_GRUPO_V1[spec["agrupar_por"]]] if spec.get("agrupar_por") else []
    filtros = [{"campo": k.upper(), "operador": "CONTIENE" if k == "producto" else "IGUAL", "valor": v}
               for k, v in (spec.get("filtros") or {}).items() if v]
    orden = {"METRICA_DESC": [{"campo": metricas[0], "direccion": "DESC"}], "METRICA_ASC": [{"campo": metricas[0], "direccion": "ASC"}],
             "CLAVE_ASC": [{"campo": dims[0], "direccion": "ASC"}] if dims else []}[spec.get("orden", "METRICA_DESC")]
    if dims == ["FECHA"]:
        orden = [{"campo": "FECHA", "direccion": "ASC"}]
    visual = spec.get("visualizacion", "TABLA")
    grafico = {"tipo": visual, "eje": dims[0], "valor": metricas[0]} if visual in ("BARRAS", "LINEAS") and dims else {"tipo": "NINGUNO"}
    return {"version": 2, "titulo": spec["titulo"], "fuente": "VENTAS", "tipo": "AGREGADO", "columnas": [*dims, *metricas],
            "filtros": filtros, "periodo": _PERIODO_V1[spec.get("periodo", "SEMANA")], "desde": spec.get("desde"),
            "hasta": spec.get("hasta"), "orden": orden, "limite": spec.get("limite", 10), "grafico": grafico, "formatos": []}
