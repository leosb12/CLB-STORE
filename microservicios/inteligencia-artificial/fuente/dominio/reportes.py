"""Especificación de reporte: el único formato que el modelo de lenguaje puede producir.

Cada campo es una lista cerrada (o un número acotado): el LLM solo traduce la petición a esta forma y nunca decide cifras,
consultas ni SQL. Las cifras salen después, de forma determinista, del modelo de lectura.
"""
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Metrica = Literal["UNIDADES", "MONTO", "PEDIDOS"]
Agrupacion = Literal["TALLA", "COLOR", "CATEGORIA", "PRODUCTO", "DIA"]
Periodo = Literal["HOY", "SEMANA", "MES", "TODO", "RANGO"]
Orden = Literal["METRICA_DESC", "METRICA_ASC", "CLAVE_ASC"]
Visualizacion = Literal["TABLA", "BARRAS", "LINEAS", "KPI"]
Destino = Literal["PANEL", "VISTA", "HISTORIAL"]

# Bolivia no tiene horario de verano: UTC-4 fijo.
ZONA_BOLIVIA = timezone(timedelta(hours=-4), "BOT")


# Valor de filtro: texto corto sin marcado ni caracteres de fórmula; se compara como parámetro enlazado, nunca como SQL.
TextoFiltro = Field(default=None, min_length=1, max_length=60, pattern=r"^[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ][0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ .\/-]*$")
MAXIMO_RANGO_DIAS = 366


class Filtros(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    categoria: str | None = TextoFiltro
    talla: str | None = TextoFiltro
    color: str | None = TextoFiltro
    producto: str | None = TextoFiltro


class EspecificacionReporte(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    # Sin caracteres de control ni marcado, y sin un primer carácter de fórmula de hoja de cálculo (=, +, -, @).
    titulo: str = Field(min_length=1, max_length=80, pattern=r"^[^\x00-\x1f<>{}=+\-@][^\x00-\x1f<>{}]*$")
    metrica: Metrica
    agrupar_por: Agrupacion | None = None
    periodo: Periodo = "SEMANA"
    visualizacion: Visualizacion = "TABLA"
    destino: Destino = "PANEL"
    limite: int = Field(default=10, ge=1, le=50)
    # Ampliación F4 (opcional: el historial anterior sigue siendo válido).
    metricas_extra: list[Metrica] = Field(default_factory=list, max_length=2)
    filtros: Filtros | None = None
    desde: date | None = None
    hasta: date | None = None
    orden: Orden = "METRICA_DESC"

    @model_validator(mode="after")
    def coherente(self):
        if self.metrica in self.metricas_extra or len(set(self.metricas_extra)) != len(self.metricas_extra):
            raise ValueError("Las columnas extra deben ser métricas distintas de la principal.")
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
        if self.visualizacion == "KPI" and self.agrupar_por:
            raise ValueError("Un KPI muestra una sola cifra: no admite agrupación.")
        if self.visualizacion in ("BARRAS", "LINEAS") and not self.agrupar_por:
            raise ValueError("Un gráfico necesita una agrupación.")
        if self.visualizacion == "LINEAS" and self.agrupar_por != "DIA":
            raise ValueError("Las líneas muestran una evolución: requieren agrupar por DIA.")
        return self


UNIDAD = {"UNIDADES": "unidades", "PEDIDOS": "pedidos", "MONTO": "Bs"}


def valores_reporte(spec: EspecificacionReporte, resumen: dict) -> dict:
    """Cifras del reporte según sus métricas, tal como salen del resumen de ventas (nada se calcula con el LLM).

    `valor` es la métrica principal (gráfico); `valores` trae además las columnas extra pedidas.
    """
    columnas = [spec.metrica, *spec.metricas_extra]

    def valor(fila: dict, metrica: str):
        if metrica == "MONTO":
            return float(fila["monto"])  # solo presentación (gráfico, Excel y PDF); el modelo de lectura guarda centavos
        return fila["unidades"] if metrica == "UNIDADES" else fila["pedidos"]

    def valores(fila: dict) -> dict:
        return {m: valor(fila, m) for m in columnas}

    return {"titulo": spec.titulo, "metrica": spec.metrica, "periodo": spec.periodo, "agrupar_por": spec.agrupar_por,
            "unidad": UNIDAD[spec.metrica], "columnas": columnas,
            "total": valor(resumen, spec.metrica), "totales": valores(resumen),
            "filas": [{"clave": g["clave"], "valor": valor(g, spec.metrica), "valores": valores(g)} for g in resumen["grupos"]],
            "pedidos": resumen["pedidos"], "unidades": resumen["unidades"], "monto": resumen["monto"],
            "datos_al": resumen.get("datos_al")}


NOMBRE_METRICA = {"UNIDADES": "Unidades vendidas", "MONTO": "Ventas en Bs", "PEDIDOS": "Pedidos"}
NOMBRE_GRUPO = {"TALLA": "talla", "COLOR": "color", "CATEGORIA": "categoría", "PRODUCTO": "producto", "DIA": "día"}
NOMBRE_PERIODO = {"HOY": "hoy", "SEMANA": "últimos 7 días", "MES": "últimos 30 días", "TODO": "todo el historial"}
NOMBRE_ORDEN = {"METRICA_DESC": "de mayor a menor", "METRICA_ASC": "de menor a mayor", "CLAVE_ASC": "alfabético"}


def _fecha(valor) -> str:
    d = valor if isinstance(valor, date) else date.fromisoformat(str(valor))
    return d.strftime("%d/%m/%Y")


def describir(spec: dict) -> str:
    """Interpretación legible de una especificación (también del historial anterior a F4): lo que se asumió."""
    partes = [NOMBRE_METRICA[spec["metrica"]] + (f" por {NOMBRE_GRUPO[spec['agrupar_por']]}" if spec.get("agrupar_por") else "")]
    extra = spec.get("metricas_extra") or []
    if extra:
        partes.append("con " + " y ".join(NOMBRE_METRICA[m][0].lower() + NOMBRE_METRICA[m][1:] for m in extra))
    if spec.get("periodo") == "RANGO":
        partes.append(f"del {_fecha(spec['desde'])} al {_fecha(spec['hasta'])}")
    else:
        partes.append(NOMBRE_PERIODO[spec.get("periodo", "SEMANA")])
    filtros = {k: v for k, v in (spec.get("filtros") or {}).items() if v}
    if filtros:
        partes.append("solo " + ", ".join(f"{NOMBRE_GRUPO[k.upper()]} {v}" for k, v in filtros.items()))
    if spec.get("agrupar_por"):
        orden = "cronológico" if spec["agrupar_por"] == "DIA" else NOMBRE_ORDEN[spec.get("orden", "METRICA_DESC")]
        partes.append(f"top {spec.get('limite', 10)}, {orden}")
    return " · ".join(partes)


def rango_fechas(spec: EspecificacionReporte, ahora: datetime) -> tuple[datetime | None, datetime | None]:
    """Ventana [desde, hasta) de la consulta; un RANGO usa días calendario de Bolivia completos."""
    if spec.periodo == "RANGO":
        return (datetime.combine(spec.desde, time(), ZONA_BOLIVIA),
                datetime.combine(spec.hasta + timedelta(days=1), time(), ZONA_BOLIVIA))
    return inicio_periodo(spec.periodo, ahora), None


TERMINOS_DOMINIO = ("vent", "vend", "compr", "ingres", "monto", "dinero", "bs", "bolivian", "factur", "recaud", "pedido",
                    "orden", "unidad", "prenda", "producto", "talla", "color", "categoria", "dia", "diari", "evolucion",
                    "tendencia", "hoy", "semana", "mes", "todo", "historic", "kpi", "polera", "camisa", "pantal", "jean",
                    "buzo", "chaquet")
SUGERENCIAS = ("Ventas en Bs por categoría del último mes", "Unidades vendidas por talla esta semana",
               "Evolución diaria de pedidos de los últimos 30 días")


def es_ambigua(peticion: str) -> bool:
    """Sin ningún término de ventas, prendas o periodos no hay reporte que deducir: se pide aclarar en vez de inventar."""
    texto = _normalizar(peticion)
    return not any(re.search(rf"\b{t}", texto) for t in TERMINOS_DOMINIO)


def sin_delimitadores(texto: str) -> str:
    """El texto del usuario va entre <<< >>> como dato: no puede cerrar ese delimitador."""
    return texto.replace("<<<", "").replace(">>>", "").strip()


def inicio_periodo(periodo: Periodo, ahora: datetime) -> datetime | None:
    """Inicio de la ventana del periodo; HOY es el día calendario de Bolivia."""
    if periodo == "HOY":
        return ahora.astimezone(ZONA_BOLIVIA).replace(hour=0, minute=0, second=0, microsecond=0)
    if periodo == "SEMANA":
        return ahora - timedelta(days=7)
    if periodo == "MES":
        return ahora - timedelta(days=30)
    return None  # TODO (y RANGO, que se resuelve en rango_fechas)


def _normalizar(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sin_tildes)


def _primera(texto: str, opciones: list[tuple[tuple[str, ...], str]], defecto):
    for palabras, valor in opciones:
        if any(re.search(rf"\b{p}", texto) for p in palabras):
            return valor
    return defecto


def especificacion_por_palabras(peticion: str) -> EspecificacionReporte:
    """Interpretación determinista («no generativa», PDF CU05) para cuando el modelo no está disponible o falla."""
    texto = _normalizar(peticion)
    agrupar = _primera(texto, [(("talla",), "TALLA"), (("color",), "COLOR"), (("categoria",), "CATEGORIA"),
                               (("producto", "prenda"), "PRODUCTO"), (("dia", "diari", "evolucion", "tendencia"), "DIA")], None)
    metrica = _primera(texto, [(("monto", "ingreso", "dinero", "bs", "bolivianos", "factura", "recaud"), "MONTO"),
                               (("pedido", "orden"), "PEDIDOS")], "UNIDADES")
    periodo = _primera(texto, [(("hoy",), "HOY"), (("semana",), "SEMANA"), (("mes",), "MES"),
                               (("todo", "historic", "siempre"), "TODO")], "SEMANA")
    visual = _primera(texto, [(("barra",), "BARRAS"), (("linea",), "LINEAS"), (("kpi", "cifra", "indicador"), "KPI"),
                              (("tabla",), "TABLA")], "BARRAS" if agrupar else "KPI")
    destino = _primera(texto, [(("vista", "dedicada", "pantalla completa"), "VISTA"), (("historial",), "HISTORIAL")], "PANEL")
    orden = _primera(texto, [(("menos vendid", "menor", "peor"), "METRICA_ASC"), (("alfabetic",), "CLAVE_ASC")], "METRICA_DESC")
    if visual == "KPI":
        agrupar = None
    elif agrupar is None:
        visual = "KPI"
    elif visual == "LINEAS" and agrupar != "DIA":
        visual = "BARRAS"
    nombres = {"UNIDADES": "Unidades vendidas", "MONTO": "Ventas en Bs", "PEDIDOS": "Pedidos"}
    titulo = nombres[metrica] + (f" por {agrupar.lower()}" if agrupar else "")
    return EspecificacionReporte(titulo=titulo, metrica=metrica, agrupar_por=agrupar, periodo=periodo,
                                 visualizacion=visual, destino=destino, orden=orden)
