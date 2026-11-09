"""Interpretación por reglas (respaldo no generativo, CU05) de una petición de reporte al catálogo v2.

Es deliberadamente limitada: reconoce los nombres del catálogo y sus sinónimos comunes, en el orden en que aparecen.
Cada suposición (métrica o periodo no indicados, columnas básicas) queda anotada para mostrarla; si no reconoce qué
mostrar, devuelve una pregunta en lugar de inventar un reporte.
"""
import re

from fuente.dominio.catalogo_reportes import CATALOGO, normalizar_texto

# (patrón, campo en detalle, campo en agregado). El orden de aparición en el texto decide el orden de las columnas.
_VENTAS = (
    (r"\bclientes?\b|\bcompradores?\b", "CLIENTE", "CLIENTE"),
    (r"\bproductos?\b|\bprendas?\b|\barticulos?\b", "PRODUCTO", "PRODUCTO"),
    (r"\bsku\b|\bcodigos?\b", "SKU", "SKU"),
    (r"\bcategorias?\b", "CATEGORIA", "CATEGORIA"),
    (r"\btallas?\b", "TALLA", "TALLA"),
    (r"\bcolor(es)?\b", "COLOR", "COLOR"),
    (r"\bfechas?\b|\b(por|cada) dia\b|\bdiari", "FECHA", "FECHA"),
    (r"\bestados?\b", "ESTADO", "ESTADO"),
    (r"\bcantidad(es)?\b|\bunidades\b", "CANTIDAD", "UNIDADES"),
    (r"\bprecios? unitarios?\b|\ba que precio\b|\bprecios?\b", "PRECIO_UNITARIO", "PRECIO_PROMEDIO"),
    (r"\btotal comprado\b|\bsubtotal(es)?\b|\btotal(es)?\b|\bmontos?\b|\bimportes?\b|\bbolivianos\b|\bingresos?\b", "SUBTOTAL", "MONTO"),
    (r"\bstock\b|\bexistencias?\b", "STOCK_ACTUAL", None),
    (r"\bticket promedio\b", None, "TICKET_PROMEDIO"),
    (r"\bcuantos pedidos\b|\bnumero de pedidos\b|\bcantidad de pedidos\b", None, "PEDIDOS"),
    (r"\bcuantos clientes\b|\bnumero de clientes\b", None, "CLIENTES"),
)
_INVENTARIO = (
    (r"\bproductos?\b|\bprendas?\b", "PRODUCTO", "PRODUCTO"),
    (r"\bsku\b|\bcodigos?\b", "SKU", "SKU"),
    (r"\bcategorias?\b", "CATEGORIA", "CATEGORIA"),
    (r"\btallas?\b", "TALLA", "TALLA"),
    (r"\bcolor(es)?\b", "COLOR", "COLOR"),
    (r"\bfisic", "STOCK_FISICO", "FISICO_TOTAL"),
    (r"\breservad", "STOCK_RESERVADO", None),
    (r"\bdisponib|\bstock\b(?! bajo)|\bexistencias?\b", "STOCK_DISPONIBLE", "DISPONIBLE_TOTAL"),
    (r"\bminimos?\b", "STOCK_MINIMO", None),
    (r"\bvariantes\b", None, "VARIANTES"),
)
_DIMENSIONES = {"CLIENTE", "PRODUCTO", "SKU", "CATEGORIA", "TALLA", "COLOR", "FECHA", "ESTADO"}
_DIM_TEXTO = r"(cliente|producto|prenda|sku|categoria|talla|color|dia|fecha|estado)s?"
_AGRUPA = re.compile(r"\b(ranking|top \d|mas vendid|menos vendid|agrupad[oa]s?)\b")
_POR = re.compile(rf"\b(?:por|segun) {_DIM_TEXTO}\b")
# «gráfico de barras por cliente» indica el eje del gráfico, no que el reporte sea agregado.
_GRAFICO_POR = re.compile(rf"\bgrafic\w*(?: de (?:barras|lineas))?(?: de [a-z ]{{1,30}}?)? (?:por|segun) {_DIM_TEXTO}\b")
_DIM = {"prenda": "PRODUCTO", "dia": "FECHA"}
_NO_VALORES = {"esta", "este", "del", "los", "las", "con", "por", "para", "que", "como", "mas", "menos", "semana", "mes",
               "hoy", "ayer", "todo", "todos", "todas", "cada", "una", "uno", "sus", "son"}
_PERIODOS = (
    (r"\bsemana pasada\b|\banterior semana\b", "SEMANA_PASADA"),
    (r"\bultim[ao]s? 7 dias\b|\bultima semana\b|\bsiete dias\b", "ULTIMOS_7_DIAS"),
    (r"\besta semana\b|\bde la semana\b|\bsemana actual\b|\bsemanal", "ESTA_SEMANA"),
    (r"\bmes pasado\b|\banterior mes\b", "MES_PASADO"),
    (r"\bultimos 30 dias\b|\btreinta dias\b|\bultimo mes\b", "ULTIMOS_30_DIAS"),
    (r"\beste mes\b|\bdel mes\b|\bmes actual\b|\bmensual", "ESTE_MES"),
    (r"\bayer\b", "AYER"),
    (r"\bhoy\b", "HOY"),
    (r"\btodo\b|\bhistoric|\bsiempre\b|\btotal historico\b", "TODO"),
)
_VENTAS_INDICIO = re.compile(r"\b(vent|vend|compr|pedid|factur|ingres|cliente)")
_INVENTARIO_INDICIO = re.compile(r"\b(stock|inventario|existencia|disponib|agotad|reponer|reposicion)")


def _campos(texto: str, tabla, agregado: bool) -> list[str]:
    encontrados: list[tuple[int, str]] = []
    for patron, detalle, total in tabla:
        campo = total if agregado else detalle
        m = re.search(patron, texto)
        if m and campo and campo not in (c for _, c in encontrados):
            encontrados.append((m.start(), campo))
    return [c for _, c in sorted(encontrados)]


def _formatos(texto: str) -> list[str]:
    formatos = [f for f, patron in (("PANTALLA", r"\bpantalla\b|\bver(lo)? aqui\b|\bmostrar\b"), ("PDF", r"\bpdf\b"),
                                    ("EXCEL", r"\bexcel\b|\bxlsx\b|\bhoja de calculo\b")) if re.search(patron, texto)]
    if re.search(r"\bambos\b|\blos dos\b", texto) and not {"PDF", "EXCEL"} & set(formatos):
        formatos += ["PDF", "EXCEL"]
    return formatos


def _grafico(texto: str) -> str:
    if re.search(r"\bsin (ningun )?grafic", texto):
        return "NINGUNO"
    if re.search(r"\blinea|\bevolucion\b|\btendencia\b", texto):
        return "LINEAS"
    if re.search(r"\bbarra|\bgrafic", texto):
        return "BARRAS"
    return "NINGUNO"


def interpretar_por_reglas(peticion: str) -> tuple[dict | None, list[str], str | None]:
    """(especificación sin validar, notas de lo supuesto, pregunta si no se entendió qué mostrar)."""
    texto = normalizar_texto(peticion)
    fuente = "INVENTARIO" if _INVENTARIO_INDICIO.search(texto) and not _VENTAS_INDICIO.search(texto) else "VENTAS"
    tabla = _VENTAS if fuente == "VENTAS" else _INVENTARIO
    notas: list[str] = []
    eje = None
    m = _GRAFICO_POR.search(texto)
    if m:
        eje = _DIM.get(m.group(1), m.group(1).upper())
        texto_tabla = texto.replace(m.group(0), " ")
    else:
        texto_tabla = texto
    filtros = []
    valores = {"TALLA": r"(xxxl|xxl|xl|xs|s|m|l|\d{1,2})", "COLOR": r"([a-z]{3,20})", "CATEGORIA": r"([a-z]{3,20})"}
    for campo, patron in valores.items():
        m = re.search(rf"\b{campo.lower()} {patron}\b", texto)
        if m and m.group(1) not in _NO_VALORES:
            filtros.append({"campo": campo, "operador": "IGUAL", "valor": m.group(1).upper() if campo == "TALLA" else m.group(1)})
            texto_tabla = texto_tabla.replace(m.group(0), " ")  # «talla M» filtra; no pide la columna Talla
    agregado = bool(_POR.search(texto_tabla) or _AGRUPA.search(texto_tabla))
    columnas = _campos(texto_tabla, tabla, agregado)
    if agregado:
        dims_por = [_DIM.get(d, d.upper()) for d in _POR.findall(texto_tabla)]
        columnas = [*dict.fromkeys([*dims_por, *(c for c in columnas if c in _DIMENSIONES)]),
                    *(c for c in columnas if c not in _DIMENSIONES)]
        if not any(c not in _DIMENSIONES for c in columnas):
            total = "UNIDADES" if fuente == "VENTAS" else "DISPONIBLE_TOTAL"
            columnas.append(total)
            notas.append(f"No se indicó qué sumar: se usó «{'Unidades' if fuente == 'VENTAS' else 'Disponible total'}».")
    elif not columnas:
        if fuente == "INVENTARIO":
            columnas = ["PRODUCTO", "TALLA", "COLOR", "STOCK_DISPONIBLE", "STOCK_MINIMO"]
            notas.append("No se indicaron columnas: se usaron las básicas del inventario.")
        elif _VENTAS_INDICIO.search(texto):
            agregado, columnas = True, ["UNIDADES", "MONTO", "PEDIDOS"]
            notas.append("No se indicaron columnas: se muestran los totales de unidades, ventas y pedidos.")
        else:
            return None, notas, ("¿Qué quieres ver? Por ejemplo: «ventas de esta semana por producto» o "
                                 "«detalle de ventas del mes con cliente, producto y total».")
    if fuente == "INVENTARIO":
        periodo = "TODO"
    else:
        periodo = next((p for patron, p in _PERIODOS if re.search(patron, texto)), None)
        if periodo is None:
            periodo = "ESTE_MES"
            notas.append("No se indicó periodo: se usó «este mes».")
    if fuente == "INVENTARIO" and re.search(r"\bstock bajo\b|\bbajo stock\b|\bpor agotarse\b", texto):
        filtros.append({"campo": "STOCK_BAJO", "operador": "IGUAL", "valor": "SI"})
        if agregado:  # en un agregado el «stock bajo» es una cuenta, no un filtro de fila
            filtros.pop()
            columnas.append("VARIANTES_STOCK_BAJO")
    if fuente == "VENTAS" and re.search(r"\bcancelad", texto):
        filtros.append({"campo": "ESTADO", "operador": "IGUAL", "valor": "CANCELADO"})
    orden = []
    metricas = [c for c in columnas if c not in _DIMENSIONES]
    if agregado and metricas:
        asc = re.search(r"\bmenos vendid|\bde menor a mayor\b", texto)
        orden = [{"campo": metricas[0], "direccion": "ASC" if asc else "DESC"}]
    elif "FECHA" in columnas:
        orden = [{"campo": "FECHA", "direccion": "DESC"}]
    m = re.search(r"\btop (\d{1,3})\b", texto)
    limite = min(500, max(1, int(m.group(1)))) if m else (50 if agregado else 200)
    spec = {"version": 2, "titulo": _titulo(fuente, agregado, columnas), "fuente": fuente,
            "tipo": "AGREGADO" if agregado else "DETALLE", "columnas": columnas, "filtros": filtros, "periodo": periodo,
            "orden": orden, "limite": limite, "grafico": {"tipo": _grafico(texto), "eje": eje if _grafico(texto) != "NINGUNO" else None},
            "formatos": _formatos(texto)}
    return spec, notas, None


def _titulo(fuente: str, agregado: bool, columnas: list[str]) -> str:
    base = "Ventas" if fuente == "VENTAS" else "Inventario"
    dims = [c.lower() for c in columnas if c in _DIMENSIONES]
    if agregado and dims:
        return f"{base} por {' y '.join(dims)}"
    return f"{'Detalle de ventas' if fuente == 'VENTAS' else 'Inventario'}" if not agregado else f"Totales de {base.lower()}"


# Sinónimos de los totales (solo agregados) para comprobar que la petición los nombra.
_METRICAS_TEXTO = {
    "UNIDADES": r"\bunidades\b|\bcantidad\b|\bprendas vendidas\b|\bcuant[ao]s? (prendas|unidades)\b",
    "MONTO": r"\bmonto|\bbs\b|\bbolivianos\b|\bingres|\bimporte|\btotal|\bdinero\b|\bgast|\bmas compr|\bfactur|\bcuanto (se )?vend",
    "PEDIDOS": r"\bpedidos\b|\bordenes\b|\bcuantos pedidos\b",
    "CLIENTES": r"\bcuantos clientes\b|\bnumero de clientes\b|\bclientes distintos\b",
    "PRECIO_PROMEDIO": r"\bprecio",
    "TICKET_PROMEDIO": r"\bticket",
    "DISPONIBLE_TOTAL": r"\bdisponib|\bstock\b|\bexistencias?\b",
    "FISICO_TOTAL": r"\bfisic",
    "VARIANTES": r"\bvariantes\b",
    "VARIANTES_STOCK_BAJO": r"\bstock bajo\b",
}


def mencionados(peticion: str, fuente: str) -> set[str]:
    """Campos que la petición nombra (por sinónimo). Sirve para no aceptar columnas que nadie pidió."""
    texto = normalizar_texto(peticion)
    tabla = _VENTAS if fuente == "VENTAS" else _INVENTARIO
    campos = {c for patron, detalle, total in tabla if re.search(patron, texto) for c in (detalle, total) if c}
    campos |= {c for c, patron in _METRICAS_TEXTO.items() if re.search(patron, texto)}
    campos |= {_DIM.get(d, d.upper()) for d in re.findall(_DIM_TEXTO, texto)}
    return campos


def reforzar(peticion: str, datos: dict, metricas: set[str], dimensiones: set[str]) -> tuple[dict, list[str]]:
    """Aplica sobre la propuesta del modelo lo que la petición dice de forma explícita y quita lo que no pidió.

    Columnas: se quitan las que la petición no nombra (si no nombra ninguna, se conserva la propuesta con aviso).
    Gráfico, formatos, «top N», «stock bajo» y «cancelados»: se toman del texto, que es la fuente de verdad."""
    texto = normalizar_texto(peticion)
    datos, notas = dict(datos), []
    fuente = datos.get("fuente", "VENTAS")
    nombrados = mencionados(peticion, fuente)
    propuestas = list(datos.get("columnas") or [])
    quedan = [c for c in propuestas if c in nombrados]
    if datos.get("tipo") == "AGREGADO" and propuestas and not any(c in metricas for c in quedan):
        primera = next((c for c in propuestas if c in metricas), None)
        if primera:
            quedan.append(primera)
            notas.append(f"No se indicó qué sumar: se usó «{_etiqueta(fuente, primera)}».")
    if quedan and len(quedan) < len(propuestas):
        notas.append("Se quitaron columnas que la petición no menciona: "
                     + ", ".join(_etiqueta(fuente, c) for c in propuestas if c not in quedan) + ".")
        datos["columnas"] = quedan
    elif not quedan and propuestas:
        notas.append("La petición no nombra columnas: se usaron las propuestas por el modelo.")
    grafico = dict(datos.get("grafico") or {})
    pedido = _grafico(texto)
    if pedido == "NINGUNO" and grafico.get("tipo", "NINGUNO") != "NINGUNO":
        grafico = {"tipo": "NINGUNO", "eje": None, "valor": None}
    elif pedido != "NINGUNO" and grafico.get("tipo") != pedido:
        grafico = {"tipo": pedido, "eje": None, "valor": None}
    m = _GRAFICO_POR.search(texto)
    if m and pedido != "NINGUNO":
        grafico["eje"] = _DIM.get(m.group(1), m.group(1).upper())
    datos["grafico"] = grafico
    datos["formatos"] = _formatos(texto)
    m = re.search(r"\btop (\d{1,3})\b|\blos (\d{1,3}) (mas|menos)\b", texto)
    if m:
        datos["limite"] = min(500, max(1, int(m.group(1) or m.group(2))))
    filtros = [f for f in datos.get("filtros") or [] if f.get("campo") in dimensiones | metricas or f.get("campo") in
               ("CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL", "STOCK_BAJO", "STOCK_DISPONIBLE", "STOCK_MINIMO")]
    if fuente == "INVENTARIO" and re.search(r"\bstock bajo\b|\bbajo stock\b|\bpor agotarse\b", texto) \
            and datos.get("tipo") == "DETALLE" and not any(f.get("campo") == "STOCK_BAJO" for f in filtros):
        filtros.append({"campo": "STOCK_BAJO", "operador": "IGUAL", "valor": "SI"})
    if fuente == "VENTAS" and re.search(r"\bcancelad", texto) and not any(f.get("campo") == "ESTADO" for f in filtros):
        filtros.append({"campo": "ESTADO", "operador": "IGUAL", "valor": "CANCELADO"})
    datos["filtros"] = filtros
    return datos, notas


def _etiqueta(fuente: str, campo: str) -> str:
    return CATALOGO[fuente][campo].etiqueta if campo in CATALOGO[fuente] else campo
