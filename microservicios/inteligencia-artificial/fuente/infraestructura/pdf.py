"""Exportación de reportes a PDF con reportlab: título, interpretación, tabla y gráfico nativo.

Sale de los mismos `datos` guardados que la pantalla y el Excel. Las celdas de texto se ajustan en varias líneas (nada
se recorta), el encabezado de la tabla se repite en cada página y con más de tres columnas la hoja va apaisada.
"""
import io
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from fuente.dominio.reportes import NOMBRE_GRUPO, NOMBRE_METRICA, describir
from fuente.infraestructura.excel import columnas_de, fecha_local, filas_de

# Verde de la marca, oscuro sobre blanco (contraste > 7:1 para texto y marcas).
VERDE = colors.HexColor("#1F5C47")
FONDO_ENCABEZADO = colors.HexColor("#E3EDE8")
GRIS = colors.HexColor("#4A4A4A")
MAX_ETIQUETA = 28


def numero(valor, metrica: str) -> str:
    """Formato boliviano: miles con punto y decimales con coma; montos con «Bs»."""
    if metrica == "MONTO":
        texto = f"{float(valor):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
        return f"Bs {texto}"
    return f"{int(valor):,}".replace(",", ".")


def _corta(texto: str) -> str:
    return texto if len(texto) <= MAX_ETIQUETA else texto[:MAX_ETIQUETA - 1] + "…"


def _grafico(reporte: dict, ancho: float) -> Drawing | None:
    spec = reporte["especificacion"]
    filas = filas_de(reporte)
    if spec["visualizacion"] not in ("BARRAS", "LINEAS") or not reporte["datos"].get("filas"):
        return None
    metrica = columnas_de(reporte)[0]
    valores = [float(v.get(metrica, 0)) for _, v in filas]
    dibujo = Drawing(ancho, 70 * mm)
    grafico = VerticalBarChart() if spec["visualizacion"] == "BARRAS" else HorizontalLineChart()
    grafico.x, grafico.y, grafico.width, grafico.height = 18 * mm, 18 * mm, ancho - 26 * mm, 46 * mm
    grafico.data = [valores]
    grafico.categoryAxis.categoryNames = [_corta(c) for c, _ in filas]
    inclinadas = len(filas) > 4 or max(len(c) for c, _ in filas) > 12
    grafico.categoryAxis.labels.angle = 35 if inclinadas else 0
    grafico.categoryAxis.labels.boxAnchor = "ne" if inclinadas else "n"
    if inclinadas:  # espacio inferior para etiquetas inclinadas
        dibujo.height, grafico.y = 85 * mm, 33 * mm
    for etiquetas in (grafico.categoryAxis.labels, grafico.valueAxis.labels):
        etiquetas.fontName, etiquetas.fontSize, etiquetas.fillColor = "Helvetica", 7, GRIS
    grafico.valueAxis.valueMin = 0
    grafico.valueAxis.labelTextFormat = lambda v: numero(v, metrica).replace("Bs ", "")
    if isinstance(grafico, VerticalBarChart):
        grafico.bars[0].fillColor = VERDE
        grafico.bars[0].strokeColor = None
    else:
        grafico.lines[0].strokeColor = VERDE
        grafico.lines[0].strokeWidth = 2
    dibujo.add(grafico)
    return dibujo


def reporte_pdf(reporte: dict) -> bytes:
    if reporte["datos"].get("version") == 2:
        return _pdf_v2(reporte)
    spec = reporte["especificacion"]
    columnas = columnas_de(reporte)
    pagina = landscape(A4) if len(columnas) + 1 > 3 else A4
    salida = io.BytesIO()
    documento = SimpleDocTemplate(salida, pagesize=pagina, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm,
                                  bottomMargin=15 * mm, title=spec["titulo"], author="CLB Store")
    estilos = getSampleStyleSheet()
    titulo = ParagraphStyle("titulo", parent=estilos["Title"], alignment=0, textColor=VERDE, fontSize=18, spaceAfter=4)
    normal = ParagraphStyle("normal", parent=estilos["Normal"], fontSize=9, leading=12, textColor=GRIS)
    celda = ParagraphStyle("celda", parent=normal, textColor=colors.black)
    cifra = ParagraphStyle("cifra", parent=celda, alignment=TA_RIGHT)
    fuerte = ParagraphStyle("fuerte", parent=celda, fontName="Helvetica-Bold")
    fuerte_cifra = ParagraphStyle("fuerte_cifra", parent=fuerte, alignment=TA_RIGHT)

    datos_al = fecha_local(reporte.get("datos_al"))
    historia = [
        Paragraph(escape(spec["titulo"]), titulo),
        Paragraph(escape(describir(spec)), normal),
        Paragraph("Datos al " + (datos_al.strftime("%d/%m/%Y %H:%M") if datos_al else "—") + " · "
                  + ("generado con el modelo local" if reporte["generativa"] else "plantilla no generativa"), normal),
        Spacer(1, 6 * mm),
    ]
    grafico = _grafico(reporte, pagina[0] - 30 * mm)
    if grafico:
        historia += [grafico, Spacer(1, 4 * mm)]

    grupo = NOMBRE_GRUPO.get(spec.get("agrupar_por") or "", "total").capitalize()
    tabla = [[Paragraph(grupo, fuerte), *[Paragraph(escape(NOMBRE_METRICA[m]), fuerte_cifra) for m in columnas]]]
    for clave, valores in filas_de(reporte):
        tabla.append([Paragraph(escape(clave), celda), *[Paragraph(numero(valores.get(m, 0), m), cifra) for m in columnas]])
    ancho_util = pagina[0] - 30 * mm
    primera = ancho_util * (0.46 if len(columnas) == 1 else 0.34)
    resto = (ancho_util - primera) / len(columnas)
    t = Table(tabla, colWidths=[primera, *[resto] * len(columnas)], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), FONDO_ENCABEZADO),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, VERDE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#D0D7D3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    historia.append(t)

    def pie(lienzo, doc):
        lienzo.saveState()
        lienzo.setFont("Helvetica", 8)
        lienzo.setFillColor(GRIS)
        lienzo.drawString(15 * mm, 8 * mm, "CLB Store · reporte de gestión")
        lienzo.drawRightString(pagina[0] - 15 * mm, 8 * mm, f"Página {doc.page}")
        lienzo.restoreState()

    documento.build(historia, onFirstPage=pie, onLaterPages=pie)
    return salida.getvalue()


# --- Reportes v2 (catálogo de campos) -------------------------------------------------------------------------------

def texto_v2(valor, tipo: str) -> str:
    """Formato boliviano para pantalla/PDF: «Bs 1.234,50» desde centavos, fechas dd/mm/aaaa, sí/no."""
    if valor is None:
        return "—"
    if tipo == "DINERO":
        return numero(int(valor) / 100, "MONTO")
    if tipo == "ENTERO":
        return numero(valor, "UNIDADES")
    if tipo == "FECHA":
        a, m, d = str(valor)[:10].split("-")
        return f"{d}/{m}/{a}"
    if tipo == "BOOLEANO":
        return "Sí" if valor else "No"
    return str(valor)


def _grafico_v2(grafico: dict, ancho: float) -> Drawing | None:
    puntos = grafico["puntos"]
    if not puntos:
        return None
    tipo_valor = grafico["tipo_valor"]
    valores = [float(p["valor"]) / (100 if tipo_valor == "DINERO" else 1) for p in puntos]
    claves = [texto_v2(p["clave"], "FECHA") if grafico["eje"] == "FECHA" else str(p["clave"]) for p in puntos]
    dibujo = Drawing(ancho, 70 * mm)
    g = VerticalBarChart() if grafico["tipo"] == "BARRAS" else HorizontalLineChart()
    g.x, g.y, g.width, g.height = 20 * mm, 18 * mm, ancho - 28 * mm, 46 * mm
    g.data = [valores]
    g.categoryAxis.categoryNames = [_corta(c) for c in claves]
    inclinadas = len(claves) > 4 or max(len(c) for c in claves) > 12
    g.categoryAxis.labels.angle = 35 if inclinadas else 0
    g.categoryAxis.labels.boxAnchor = "ne" if inclinadas else "n"
    if inclinadas:
        dibujo.height, g.y = 85 * mm, 33 * mm
    for etiquetas in (g.categoryAxis.labels, g.valueAxis.labels):
        etiquetas.fontName, etiquetas.fontSize, etiquetas.fillColor = "Helvetica", 7, GRIS
    g.valueAxis.valueMin = 0
    g.valueAxis.labelTextFormat = lambda v: numero(v, "MONTO" if tipo_valor == "DINERO" else "UNIDADES").replace("Bs ", "")
    if isinstance(g, VerticalBarChart):
        g.bars[0].fillColor, g.bars[0].strokeColor = VERDE, None
    else:
        g.lines[0].strokeColor, g.lines[0].strokeWidth = VERDE, 2
    dibujo.add(g)
    return dibujo


def _pdf_v2(reporte: dict) -> bytes:
    from fuente.dominio.catalogo_reportes import describir_v2
    from fuente.infraestructura.excel import procedencia_de
    from datetime import datetime
    datos, spec = reporte["datos"], reporte["especificacion"]
    columnas = datos["columnas"]
    pagina = landscape(A4) if len(columnas) > 4 else A4
    salida = io.BytesIO()
    documento = SimpleDocTemplate(salida, pagesize=pagina, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm,
                                  bottomMargin=15 * mm, title=datos["titulo"], author="CLB Store")
    estilos = getSampleStyleSheet()
    titulo = ParagraphStyle("titulo", parent=estilos["Title"], alignment=0, textColor=VERDE, fontSize=18, spaceAfter=4)
    normal = ParagraphStyle("normal", parent=estilos["Normal"], fontSize=9, leading=12, textColor=GRIS)
    nota = ParagraphStyle("nota", parent=normal, fontSize=8, leading=10)
    celda = ParagraphStyle("celda", parent=normal, textColor=colors.black)
    cifra = ParagraphStyle("cifra", parent=celda, alignment=TA_RIGHT)
    fuerte = ParagraphStyle("fuerte", parent=celda, fontName="Helvetica-Bold")
    fuerte_cifra = ParagraphStyle("fuerte_cifra", parent=fuerte, alignment=TA_RIGHT)
    numericas = {"DINERO", "ENTERO"}
    datos_al = fecha_local(datos.get("datos_al"))
    fecha = datetime.fromisoformat(str(reporte["fecha"])) if reporte.get("fecha") else None
    historia = [
        Paragraph(escape(datos["titulo"]), titulo),
        Paragraph(escape(describir_v2(spec, fecha)), normal),
        Paragraph(escape(f"Periodo: {datos['periodo']['texto']} · Datos al "
                         + (datos_al.strftime("%d/%m/%Y %H:%M") if datos_al else "—") + " · " + procedencia_de(reporte)), normal),
        *[Paragraph(escape(n), nota) for n in datos.get("notas") or []],
        Spacer(1, 5 * mm),
    ]
    if datos.get("grafico"):
        dibujo = _grafico_v2(datos["grafico"], pagina[0] - 30 * mm)
        if dibujo:
            historia += [Paragraph(escape(f"{datos['grafico']['etiqueta_valor']} por "
                                          f"{datos['grafico']['etiqueta_eje'].lower()}"), fuerte), dibujo, Spacer(1, 4 * mm)]
    tabla = [[Paragraph(escape(c["etiqueta"]), fuerte_cifra if c["tipo"] in numericas else fuerte) for c in columnas]]
    for fila in datos["filas"]:
        tabla.append([Paragraph(escape(texto_v2(v, c["tipo"])), cifra if c["tipo"] in numericas else celda)
                      for v, c in zip(fila, columnas)])
    totales = datos.get("totales") or {}
    if totales and datos["filas"]:
        tabla.append([Paragraph(escape(texto_v2(totales[c["campo"]], c["tipo"])) if c["campo"] in totales else
                                ("Total" if i == 0 else ""), fuerte_cifra if c["campo"] in totales else fuerte)
                      for i, c in enumerate(columnas)])
    if not datos["filas"]:
        tabla.append([Paragraph("Sin datos para este periodo y filtros.", celda), *[""] * (len(columnas) - 1)])
    ancho_util = pagina[0] - 30 * mm
    pesos = [2.2 if c["tipo"] == "TEXTO" else 1.0 for c in columnas]
    t = Table(tabla, colWidths=[ancho_util * p / sum(pesos) for p in pesos], repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), FONDO_ENCABEZADO),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, VERDE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#D0D7D3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if totales and datos["filas"]:
        estilo.append(("LINEABOVE", (0, -1), (-1, -1), 0.8, VERDE))
    t.setStyle(TableStyle(estilo))
    historia.append(t)

    def pie(lienzo, doc):
        lienzo.saveState()
        lienzo.setFont("Helvetica", 8)
        lienzo.setFillColor(GRIS)
        lienzo.drawString(15 * mm, 8 * mm, "CLB Store · reporte de gestión")
        lienzo.drawRightString(pagina[0] - 15 * mm, 8 * mm, f"Página {doc.page}")
        lienzo.restoreState()

    documento.build(historia, onFirstPage=pie, onLaterPages=pie)
    return salida.getvalue()
