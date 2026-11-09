"""Exportación de reportes a Excel (xlsx) con openpyxl: datos, gráfico nativo y la evidencia de cómo se generó.

Usa los mismos `datos` guardados que la pantalla y el PDF: mismos filtros, periodo y cifras.
"""
import io
import json
from datetime import datetime

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill

from fuente.dominio.reportes import NOMBRE_GRUPO, NOMBRE_METRICA, ZONA_BOLIVIA, describir

_FORMULA = ("=", "+", "-", "@", "\t", "\r")
FORMATO = {"MONTO": "#,##0.00", "UNIDADES": "#,##0", "PEDIDOS": "#,##0"}
ENCABEZADO = PatternFill("solid", fgColor="E3EDE8")


def _texto(valor):
    """Inyección de fórmulas: un texto (título, petición, nombre de prenda) que empieza como fórmula queda como texto."""
    return "'" + valor if isinstance(valor, str) and valor.startswith(_FORMULA) else valor


def _fila(hoja, valores):
    hoja.append([_texto(v) for v in valores])


def fecha_local(valor) -> datetime | None:
    """`datos_al` (ISO con zona) como fecha y hora de Bolivia sin zona: Excel no admite zonas horarias."""
    if not valor:
        return None
    fecha = valor if isinstance(valor, datetime) else datetime.fromisoformat(str(valor))
    return fecha.astimezone(ZONA_BOLIVIA).replace(tzinfo=None) if fecha.tzinfo else fecha


def columnas_de(reporte: dict) -> list[str]:
    return reporte["datos"].get("columnas") or [reporte["especificacion"]["metrica"]]


def filas_de(reporte: dict) -> list[tuple[str, dict]]:
    """(clave, {métrica: valor}) de cada fila; un KPI es una sola fila «Total». Compatible con reportes anteriores a F4."""
    spec, datos = reporte["especificacion"], reporte["datos"]
    filas = datos.get("filas") or [{"clave": "Total", "valor": datos.get("total", 0), "valores": datos.get("totales")}]
    return [(str(f["clave"]), f.get("valores") or {spec["metrica"]: f["valor"]}) for f in filas]


def reporte_xlsx(reporte: dict) -> bytes:
    if reporte["datos"].get("version") == 2:
        return _xlsx_v2(reporte)
    spec = reporte["especificacion"]
    columnas = columnas_de(reporte)
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Reporte"
    _fila(hoja, [spec["titulo"]])
    hoja["A1"].font = Font(bold=True, size=14)
    _fila(hoja, ["Datos al", fecha_local(reporte.get("datos_al")) or "sin datos"])
    if isinstance(hoja["B2"].value, datetime):
        hoja["B2"].number_format = "dd/mm/yyyy hh:mm"
        hoja["B2"].alignment = Alignment(horizontal="left")
    _fila(hoja, ["Interpretación", describir(spec)])
    _fila(hoja, ["Generado por", "Modelo local (generativo)" if reporte["generativa"] else "Plantilla (no generativa)"])
    _fila(hoja, [])
    grupo = NOMBRE_GRUPO.get(spec.get("agrupar_por") or "", "Total").capitalize()
    _fila(hoja, [grupo, *[NOMBRE_METRICA[m] for m in columnas]])
    encabezado = hoja.max_row  # después de escribirlo: una fila vacía no cuenta en max_row
    for celda in hoja[encabezado]:
        celda.font, celda.fill = Font(bold=True), ENCABEZADO
    for clave, valores in filas_de(reporte):
        _fila(hoja, [clave, *[valores.get(m, 0) for m in columnas]])
        for i, metrica in enumerate(columnas, start=2):
            hoja.cell(hoja.max_row, i).number_format = FORMATO[metrica]
    hoja.freeze_panes = hoja.cell(encabezado + 1, 1)
    # Anchos según el contenido (con tope): nada queda recortado al abrir el archivo.
    hoja.column_dimensions["A"].width = min(50, max(14, *(len(str(c.value or "")) + 2 for c in hoja["A"][encabezado - 1:])))
    hoja.column_dimensions["B"].width = max(18, min(60, len(describir(spec)) + 2))
    for i in range(3, len(columnas) + 2):
        hoja.column_dimensions[hoja.cell(1, i).column_letter].width = 20
    if spec["visualizacion"] in ("BARRAS", "LINEAS") and reporte["datos"].get("filas"):
        grafico = BarChart() if spec["visualizacion"] == "BARRAS" else LineChart()
        grafico.title, grafico.legend = spec["titulo"], None
        grafico.y_axis.title = NOMBRE_METRICA[columnas[0]]
        grafico.add_data(Reference(hoja, min_col=2, min_row=encabezado, max_row=hoja.max_row), titles_from_data=True)
        grafico.set_categories(Reference(hoja, min_col=1, min_row=encabezado + 1, max_row=hoja.max_row))
        hoja.add_chart(grafico, hoja.cell(2, len(columnas) + 3).coordinate)
    evidencia = libro.create_sheet("Especificacion")
    _fila(evidencia, ["Petición", reporte.get("peticion") or ""])
    _fila(evidencia, ["Salida del modelo", reporte.get("salida_modelo") or ""])
    _fila(evidencia, ["Especificación validada", json.dumps(spec, ensure_ascii=False)])
    _fila(evidencia, ["Observación", reporte.get("observacion") or ""])
    evidencia.column_dimensions["A"].width = 26
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()


# --- Reportes v2 (catálogo de campos) -------------------------------------------------------------------------------

PROCEDENCIA = {"MODELO": "Interpretado por el modelo de lenguaje del servidor (Ollama)",
               "REGLAS": "Interpretación limitada por reglas (el modelo del servidor no estuvo disponible o no fue compatible)",
               "MANUAL": "Especificación editada manualmente"}
FORMATO_TIPO = {"DINERO": '"Bs" #,##0.00', "ENTERO": "#,##0", "FECHA": "dd/mm/yyyy"}


def celda_v2(valor, tipo: str):
    """Valor de hoja: dinero de centavos a Bs (número), fecha ISO a fecha, booleano a Sí/No."""
    if valor is None:
        return None
    if tipo == "DINERO":
        return int(valor) / 100
    if tipo == "FECHA":
        return datetime.fromisoformat(str(valor))
    if tipo == "BOOLEANO":
        return "Sí" if valor else "No"
    return valor


def procedencia_de(reporte: dict) -> str:
    from fuente.aplicacion.reportes import procedencia
    return PROCEDENCIA[procedencia(reporte)]


def _xlsx_v2(reporte: dict) -> bytes:
    from fuente.dominio.catalogo_reportes import describir_v2
    datos, spec = reporte["datos"], reporte["especificacion"]
    columnas = datos["columnas"]
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Reporte"
    _fila(hoja, [datos["titulo"]])
    hoja["A1"].font = Font(bold=True, size=14)
    _fila(hoja, ["Datos al", fecha_local(datos.get("datos_al")) or "sin datos"])
    if isinstance(hoja["B2"].value, datetime):
        hoja["B2"].number_format = "dd/mm/yyyy hh:mm"
        hoja["B2"].alignment = Alignment(horizontal="left")
    fecha = datetime.fromisoformat(str(reporte["fecha"])) if reporte.get("fecha") else None
    _fila(hoja, ["Periodo", datos["periodo"]["texto"]])
    _fila(hoja, ["Interpretación", describir_v2(spec, fecha)])
    _fila(hoja, ["Generado por", procedencia_de(reporte)])
    for nota in datos.get("notas") or []:
        _fila(hoja, ["Nota", nota])
    _fila(hoja, [])
    _fila(hoja, [c["etiqueta"] for c in columnas])
    encabezado = hoja.max_row
    for celda in hoja[encabezado]:
        celda.font, celda.fill = Font(bold=True), ENCABEZADO
    for fila in datos["filas"]:
        _fila(hoja, [celda_v2(v, c["tipo"]) for v, c in zip(fila, columnas)])
        for i, c in enumerate(columnas, start=1):
            if c["tipo"] in FORMATO_TIPO:
                hoja.cell(hoja.max_row, i).number_format = FORMATO_TIPO[c["tipo"]]
    if datos.get("totales"):
        _fila(hoja, ["Total" if i == 0 and c["campo"] not in datos["totales"] else celda_v2(datos["totales"].get(c["campo"]), c["tipo"])
                     for i, c in enumerate(columnas)])
        for i, c in enumerate(columnas, start=1):
            hoja.cell(hoja.max_row, i).font = Font(bold=True)
            if c["tipo"] in FORMATO_TIPO:
                hoja.cell(hoja.max_row, i).number_format = FORMATO_TIPO[c["tipo"]]
    hoja.freeze_panes = hoja.cell(encabezado + 1, 1)
    for i, c in enumerate(columnas, start=1):
        largo = max([len(c["etiqueta"]), *(len(str(f[i - 1] or "")) for f in datos["filas"][:200])])
        hoja.column_dimensions[hoja.cell(encabezado, i).column_letter].width = min(48, max(12, largo + 4))
    hoja.column_dimensions["A"].width = max(hoja.column_dimensions["A"].width or 0, 16)
    grafico = datos.get("grafico")
    if grafico and grafico["puntos"]:
        hoja_g = libro.create_sheet("Gráfico")
        _fila(hoja_g, [grafico["etiqueta_eje"], grafico["etiqueta_valor"]])
        for p in grafico["puntos"]:
            _fila(hoja_g, [str(p["clave"]), celda_v2(p["valor"], grafico["tipo_valor"])])
            if grafico["tipo_valor"] in FORMATO_TIPO:
                hoja_g.cell(hoja_g.max_row, 2).number_format = FORMATO_TIPO[grafico["tipo_valor"]]
        hoja_g.column_dimensions["A"].width, hoja_g.column_dimensions["B"].width = 34, 18
        dibujo = BarChart() if grafico["tipo"] == "BARRAS" else LineChart()
        dibujo.title = f"{grafico['etiqueta_valor']} por {grafico['etiqueta_eje'].lower()}"
        dibujo.legend, dibujo.height, dibujo.width = None, 9, 18
        dibujo.y_axis.title = grafico["etiqueta_valor"]
        dibujo.add_data(Reference(hoja_g, min_col=2, min_row=1, max_row=hoja_g.max_row), titles_from_data=True)
        dibujo.set_categories(Reference(hoja_g, min_col=1, min_row=2, max_row=hoja_g.max_row))
        hoja_g.add_chart(dibujo, "D2")
    evidencia = libro.create_sheet("Especificacion")
    _fila(evidencia, ["Petición", reporte.get("peticion") or ""])
    _fila(evidencia, ["Procedencia", procedencia_de(reporte)])
    _fila(evidencia, ["Salida del modelo", reporte.get("salida_modelo") or ""])
    _fila(evidencia, ["Especificación validada", json.dumps(spec, ensure_ascii=False)])
    _fila(evidencia, ["Observación", reporte.get("observacion") or ""])
    evidencia.column_dimensions["A"].width = 26
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()
