"""Exportación de reportes a Excel (xlsx) con openpyxl: datos, gráfico nativo y la evidencia de cómo se generó."""
import io
import json

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.styles import Font

UNIDADES = {"UNIDADES": "Unidades", "MONTO": "Bs", "PEDIDOS": "Pedidos"}
_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def _texto(valor):
    """Inyección de fórmulas: un texto (título, petición, nombre de prenda) que empieza como fórmula queda como texto."""
    return "'" + valor if isinstance(valor, str) and valor.startswith(_FORMULA) else valor


def _fila(hoja, valores):
    hoja.append([_texto(v) for v in valores])


def reporte_xlsx(reporte: dict) -> bytes:
    spec, datos = reporte["especificacion"], reporte["datos"]
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Reporte"
    _fila(hoja, [spec["titulo"]])
    hoja["A1"].font = Font(bold=True, size=14)
    _fila(hoja, ["Datos al", str(reporte.get("datos_al") or "sin datos")])
    _fila(hoja, ["Periodo", spec["periodo"]])
    _fila(hoja, ["Generado por", "Modelo local (generativo)" if reporte["generativa"] else "Plantilla (no generativa)"])
    _fila(hoja, [])
    encabezado = hoja.max_row + 1
    _fila(hoja, [(spec.get("agrupar_por") or "Total").capitalize(), UNIDADES[spec["metrica"]]])
    for celda in hoja[encabezado]:
        celda.font = Font(bold=True)
    filas = datos.get("filas") or [{"clave": "Total", "valor": datos.get("total", 0)}]
    for fila in filas:
        _fila(hoja, [fila["clave"], fila["valor"]])
        if spec["metrica"] == "MONTO":
            hoja.cell(hoja.max_row, 2).number_format = "#,##0.00"
    hoja.column_dimensions["A"].width = 32
    hoja.column_dimensions["B"].width = 16
    if spec["visualizacion"] in ("BARRAS", "LINEAS") and datos.get("filas"):
        grafico = BarChart() if spec["visualizacion"] == "BARRAS" else LineChart()
        grafico.title, grafico.legend = spec["titulo"], None
        grafico.add_data(Reference(hoja, min_col=2, min_row=encabezado, max_row=hoja.max_row), titles_from_data=True)
        grafico.set_categories(Reference(hoja, min_col=1, min_row=encabezado + 1, max_row=hoja.max_row))
        hoja.add_chart(grafico, "D2")
    evidencia = libro.create_sheet("Especificacion")
    _fila(evidencia, ["Petición", reporte.get("peticion") or ""])
    _fila(evidencia, ["Salida del modelo", reporte.get("salida_modelo") or ""])
    _fila(evidencia, ["Especificación validada", json.dumps(spec, ensure_ascii=False)])
    _fila(evidencia, ["Observación", reporte.get("observacion") or ""])
    evidencia.column_dimensions["A"].width = 26
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()
