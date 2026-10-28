"""Especificación de reporte: el único formato que el modelo de lenguaje puede producir.

Cada campo es una lista cerrada (o un número acotado): el LLM solo traduce la petición a esta forma y nunca decide cifras,
consultas ni SQL. Las cifras salen después, de forma determinista, del modelo de lectura.
"""
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Metrica = Literal["UNIDADES", "MONTO", "PEDIDOS"]
Agrupacion = Literal["TALLA", "COLOR", "CATEGORIA", "PRODUCTO", "DIA"]
Periodo = Literal["HOY", "SEMANA", "MES", "TODO"]
Visualizacion = Literal["TABLA", "BARRAS", "LINEAS", "KPI"]
Destino = Literal["PANEL", "VISTA", "HISTORIAL"]

# Bolivia no tiene horario de verano: UTC-4 fijo.
ZONA_BOLIVIA = timezone(timedelta(hours=-4), "BOT")


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

    @model_validator(mode="after")
    def coherente(self):
        if self.visualizacion == "KPI" and self.agrupar_por:
            raise ValueError("Un KPI muestra una sola cifra: no admite agrupación.")
        if self.visualizacion in ("BARRAS", "LINEAS") and not self.agrupar_por:
            raise ValueError("Un gráfico necesita una agrupación.")
        if self.visualizacion == "LINEAS" and self.agrupar_por != "DIA":
            raise ValueError("Las líneas muestran una evolución: requieren agrupar por DIA.")
        return self


def valores_reporte(spec: EspecificacionReporte, resumen: dict) -> dict:
    """Cifras del reporte según su métrica, tal como salen del resumen de ventas (nada se calcula con el LLM)."""
    def valor(fila: dict):
        if spec.metrica == "MONTO":
            return float(fila["monto"])  # solo presentación (gráfico y Excel); el modelo de lectura guarda centavos
        return fila["unidades"] if spec.metrica == "UNIDADES" else fila["pedidos"]
    return {"titulo": spec.titulo, "metrica": spec.metrica, "periodo": spec.periodo, "agrupar_por": spec.agrupar_por,
            "unidad": {"UNIDADES": "unidades", "PEDIDOS": "pedidos", "MONTO": "Bs"}[spec.metrica],
            "total": valor(resumen), "filas": [{"clave": g["clave"], "valor": valor(g)} for g in resumen["grupos"]],
            "pedidos": resumen["pedidos"], "unidades": resumen["unidades"], "monto": resumen["monto"],
            "datos_al": resumen.get("datos_al")}


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
    return None


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
    if visual == "KPI":
        agrupar = None
    elif agrupar is None:
        visual = "KPI"
    elif visual == "LINEAS" and agrupar != "DIA":
        visual = "BARRAS"
    nombres = {"UNIDADES": "Unidades vendidas", "MONTO": "Ventas en Bs", "PEDIDOS": "Pedidos"}
    titulo = nombres[metrica] + (f" por {agrupar.lower()}" if agrupar else "")
    return EspecificacionReporte(titulo=titulo, metrica=metrica, agrupar_por=agrupar, periodo=periodo,
                                 visualizacion=visual, destino=destino)
