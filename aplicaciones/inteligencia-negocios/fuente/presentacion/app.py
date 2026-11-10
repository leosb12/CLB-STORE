"""Tablero de inteligencia de negocios (Dash) en /bi/. Presentación: arma la pantalla y traduce errores en estados."""
import os
from datetime import date
from pathlib import Path

from dash import ALL, Dash, Input, Output, State, ctx, dcc, html, no_update
from flask import Flask, jsonify, redirect, request

from fuente.adaptadores.ia import ClienteIA, DatosInvalidos, ServicioNoDisponible, SesionVencida, SinPermiso
from fuente.adaptadores.sso import ConfiguracionSso, Sso, ruta_permitida
from fuente.aplicacion.tablero import Tablero
from fuente.dominio.tablero import FiltroInvalido, Filtros, bs, entero, fecha
from fuente.presentacion import graficos

PREFIJO = "/bi/"
GRAFICO = {"displayModeBar": False, "responsive": True, "locale": "es"}
TABLAS = (("clientes", "Clientes"), ("pedidos", "Pedidos"), ("lineas_venta", "Líneas de venta"), ("existencias", "Existencias"))
MEDIDAS = (("altura_cm", "Altura", "cm", 100, 230, 170), ("peso_kg", "Peso", "kg", 30, 250, 68),
           ("pecho_cm", "Pecho", "cm", 50, 200, 98), ("cintura_cm", "Cintura", "cm", 40, 200, 82))


def _grafico(figura):
    """Altura fija en el contenedor: al cambiar el ancho, Plotly no la recalcula hacia abajo."""
    return dcc.Graph(figure=figura, config=GRAFICO, className="grafico-bi", style={"height": f"{figura.layout.height}px"})


def _aviso(texto, accion=None, tono="aviso"):
    return html.Div([html.P(texto), accion] if accion else [html.P(texto)], className=f"estado-bi {tono}", role="alert")


def _ingresar():
    return html.A("Ingresar de nuevo", href=f"{PREFIJO}ingresar", className="enlace")


def _seccion(titulo, *hijos, clase="seccion-bi"):
    return html.Section([html.H2(titulo), *hijos], className=clase)


def _tabla(encabezados, filas, numericas=()):
    return html.Div(html.Table([
        html.Thead(html.Tr([html.Th(e, className="numero" if i in numericas else None) for i, e in enumerate(encabezados)])),
        html.Tbody([html.Tr([html.Td(c, className="numero" if i in numericas else None) for i, c in enumerate(f)])
                    for f in filas])]), className="tabla-administracion")


def _kpis(k):
    datos = (("Ingresos", bs(k["ingresos_centavos"])), ("Pedidos", entero(k["pedidos"])),
             ("Unidades", entero(k["unidades"])), ("Ticket promedio", bs(k["ticket_promedio_centavos"])),
             ("Clientes", entero(k["clientes"])))
    return html.Div([html.Div([html.Span(n), html.Strong(v)], className="kpi") for n, v in datos], className="kpis")


def _segmentacion(seg, alcance):
    if not seg:
        return _seccion("Segmentación de clientes · K-Means", _aviso(
            "La segmentación de clientes todavía no está disponible. Vuelve a intentarlo más tarde."))
    filas = [[html.Span([html.I(className="muestra", style={"background": graficos.color_segmento(i)}), s["nombre"]],
                        className="nombre-segmento"),
              entero(s["clientes"]), f"{s['centroide']['recencia_dias']:.0f} días", f"{s['centroide']['frecuencia']:.1f}",
              bs(round(s["centroide"]["monto_bs"] * 100)), f"{s['centroide']['diversidad']:.1f}"]
             for i, s in enumerate(seg["segmentos"])]
    silueta = f"{seg['silueta']:.3f}".replace(".", ",") if seg.get("silueta") is not None else "—"
    return _seccion(
        "Segmentación de clientes · K-Means",
        html.P(f"Todos los clientes · corte {fecha(seg['fecha_corte'])} · no cambia con los filtros de ventas",
               className="alcance"),
        html.P(f"Aprendizaje no supervisado sobre recencia, frecuencia, gasto y diversidad de categorías de cada cliente. "
               f"k = {len(seg['segmentos'])} elegido por silueta · silueta {silueta} · {entero(seg['clientes'])} clientes · "
               f"entrenado el {fecha(seg['entrenado'])}.", className="meta-bi"),
        _grafico(graficos.segmentacion(seg)),
        _tabla(("Segmento", "Clientes", "Última compra", "Pedidos", "Gasto medio", "Categorías"), filas, numericas=(1, 2, 3, 4, 5)),
        html.P("Los nombres salen de reglas de negocio aplicadas a cada centroide (inactivo: más de 30 días sin comprar; "
               "alto gasto: más de 1,5 veces la mediana). K-Means no conoce esas etiquetas.", className="meta-bi"),
        clase="seccion-bi seccion-ml")


def _dataset(i):
    m, c = i["dataset"], i["conteos"]
    filas = [[n, entero(c.get(t))] for t, n in TABLAS] + [[html.Strong("Total"), html.Strong(entero(sum(c.values())))]]
    return _seccion(
        "Registros",
        html.P(f"Datos del {fecha(m['inicio'])} al {fecha(m['fecha_corte'])} · actualizado el {fecha(m['generado'])}.",
               className="texto-bi"),
        _tabla(("Tabla", "Registros"), filas, numericas=(1,)),
        html.H3("Descargar en CSV"),
        html.P(f"«Todo»: una fila por línea de venta ({entero(c.get('lineas_venta'))}) con su pedido, cliente, producto y "
               "stock actual. También cada tabla por separado. Se abre directo en Excel.", className="texto-bi"),
        html.Div([html.Button("Descargar todo (CSV)", id={"tipo": "descargar", "nombre": "completo"},
                              className="botón-principal", n_clicks=0)]
                 + [html.Button(n, id={"tipo": "descargar", "nombre": t}, className="botón-secundario", n_clicks=0,
                                **{"aria-label": f"Descargar la tabla {n.lower()} en CSV"}) for t, n in TABLAS],
                 className="descargas"),
        html.Div(id="descarga-estado", **{"aria-live": "polite"}))


def _tallas(modelo):
    m = modelo["metricas"]
    total = m["entrenamiento"] + m["prueba"]
    exactitud = f"{m['exactitud'] * 100:.1f} %".replace(".", ",")
    return [
        html.P(f"Aprendizaje supervisado: la regresión logística multinomial que ya usa la tienda (web y Android). Se entrenó "
               f"con {entero(total)} medidas generadas a partir de la tabla de tallas, con variación de medición casera "
               f"(σ = 4 cm / 4 kg); no hay historial real de devoluciones por talla. Métricas sobre {entero(m['prueba'])} casos "
               "de prueba que el modelo no vio.", className="texto-bi"),
        html.Div([html.Div([html.Span("Exactitud en prueba"), html.Strong(exactitud)], className="kpi"),
                  html.Div([html.Span("Casos de entrenamiento"), html.Strong(entero(m["entrenamiento"]))], className="kpi"),
                  html.Div([html.Span("Casos de prueba"), html.Strong(entero(m["prueba"]))], className="kpi"),
                  html.Div([html.Span("Características"), html.Strong(str(len(modelo["caracteristicas"])))], className="kpi")],
                 className="kpis kpis-compactos"),
        html.H3("Matriz de confusión"),
        _grafico(graficos.confusion(m["matriz_confusion"], modelo["clases"])),
    ]


def _maquetar(gestion: str) -> html.Div:
    return html.Div([
        dcc.Location(id="url"),
        dcc.Store(id="especificaciones"), dcc.Store(id="opciones"), dcc.Download(id="descarga"),
        html.Header([
            html.A([html.Span(["CLB", html.Span("®")], className="monograma"),
                    html.Span(["CLB Store", html.Small("INTELIGENCIA DE NEGOCIOS")], className="nombre-marca")],
                   href=gestion, className="marca", **{"aria-label": "Volver a Gestión de CLB Store"}),
            html.Nav([html.A("Volver a Gestión", href=gestion), html.A("Salir del tablero", href=f"{PREFIJO}salir")],
                     **{"aria-label": "Tablero"}),
        ], className="encabezado encabezado-bi"),
        html.Main([
            html.Div([html.H1("CLB STORE · Inteligencia de negocios"),
                      html.P(id="resumen-datos", className="resumen-datos"),
                      html.P("Indicadores calculados por el servicio de IA con las mismas fórmulas que los reportes y los agentes "
                             "de Gestión.")],
                     className="titulo-gestion"),
            html.Div([
                html.Div([html.Label("Fechas", htmlFor="fechas"),
                          dcc.DatePickerRange(id="fechas", display_format="DD/MM/YYYY", first_day_of_week=1,
                                              start_date_placeholder_text="Desde", end_date_placeholder_text="Hasta",
                                              clearable=True, minimum_nights=0)], className="filtro"),
                html.Div([html.Label("Categoría", htmlFor="categoria"),
                          dcc.Dropdown(id="categoria", placeholder="Todas las categorías", clearable=True)], className="filtro"),
                html.Div([html.Label("Producto", htmlFor="producto"),
                          dcc.Dropdown(id="producto", placeholder="Todos los productos", clearable=True)],
                         className="filtro filtro-ancho"),
                html.Button("Limpiar filtros", id="limpiar", className="botón-secundario", n_clicks=0),
            ], className="filtros", role="search"),
            html.Div(id="estado", **{"aria-live": "polite"}),
            dcc.Loading(html.Div(id="contenido"), delay_show=250, color="#254e43", type="dot"),
            _seccion("Recomendación de talla · regresión logística",
                     dcc.Loading(html.Div(id="tallas"), delay_show=250, color="#254e43", type="dot"),
                     html.H3("Simulador"),
                     html.Div([html.Div([html.Label(f"{n} ({u})", htmlFor=c),
                                         dcc.Input(id=c, type="number", min=mi, max=ma, step=1, value=v, debounce=True)],
                                        className="filtro") for c, n, u, mi, ma, v in MEDIDAS]
                              + [html.Button("Recomendar talla", id="recomendar", className="botón-principal", n_clicks=0)],
                              className="filtros simulador"),
                     html.Div(id="recomendacion", **{"aria-live": "polite"}),
                     clase="seccion-bi seccion-ml"),
            html.Div(id="dataset"),
            _seccion("Llevar a reportes",
                     html.P("Guarda la evolución mensual con estos mismos filtros en el historial de reportes de Gestión "
                            "(pantalla, Excel y PDF). Las cifras serán idénticas: es la misma especificación.", className="texto-bi"),
                     html.Button("Generar reporte con estos filtros", id="reporte", className="botón-principal", n_clicks=0),
                     dcc.Loading(html.Div(id="reporte-resultado", **{"aria-live": "polite"}), delay_show=250, color="#254e43",
                                 type="dot")),
        ], id="contenido-principal", className="bi"),
    ])


def crear_aplicacion(config: ConfiguracionSso | None = None, ia=None, gestion: str | None = None,
                     ia_url: str | None = None) -> Dash:
    servidor = Flask(__name__)
    sso = Sso(servidor, config or ConfiguracionSso.desde_entorno(), PREFIJO)
    tablero = Tablero(ia or ClienteIA(ia_url or os.environ.get("CLB_BI_IA_URL", "http://pasarela:8080")), sso.token)
    gestion = gestion or os.environ.get("CLB_BI_URL_GESTION", "/gestion")

    @servidor.get(f"{PREFIJO}salud")
    def salud():
        return jsonify(estado="ACTIVO", servicio="inteligencia-negocios")

    @servidor.before_request
    def exigir_sesion():
        if not request.path.startswith(PREFIJO) or ruta_permitida(request.path, PREFIJO) or sso.autenticado():
            return None
        if request.path.startswith(f"{PREFIJO}_dash-update-component"):
            return jsonify(mensaje="Sesión vencida.", código="NO_AUTENTICADO"), 401
        return redirect(f"{PREFIJO}ingresar")

    @servidor.get("/bi")
    def sin_barra():
        return redirect(PREFIJO)

    app = Dash(__name__, server=servidor, url_base_pathname=PREFIJO, title="CLB STORE · Inteligencia de negocios",
               update_title=None, assets_folder=str(Path(__file__).parent / "assets"), suppress_callback_exceptions=True)
    app.layout = _maquetar(gestion)

    @app.callback(
        Output("resumen-datos", "children"), Output("estado", "children"), Output("contenido", "children"),
        Output("dataset", "children"), Output("especificaciones", "data"), Output("opciones", "data"),
        Output("categoria", "options"), Output("fechas", "min_date_allowed"), Output("fechas", "max_date_allowed"),
        Output("fechas", "initial_visible_month"),
        Input("fechas", "start_date"), Input("fechas", "end_date"), Input("categoria", "value"), Input("producto", "value"))
    def cargar(desde, hasta, categoria, producto):
        sin_cambio = (no_update,) * 10
        try:
            filtros = Filtros(date.fromisoformat(desde) if desde else None, date.fromisoformat(hasta) if hasta else None,
                              categoria, producto)
        except FiltroInvalido as error:
            return (no_update, _aviso(str(error)), *sin_cambio[2:])
        try:
            i = tablero.indicadores(filtros)
        except SesionVencida:
            return (no_update, _aviso("Tu sesión del tablero venció.", _ingresar()), [], [], None, None, *sin_cambio[6:])
        except SinPermiso:
            return (no_update, _aviso("Se requiere rol administrador para ver el tablero.", tono="error"), [], [], None, None,
                    *sin_cambio[6:])
        except (DatosInvalidos, ServicioNoDisponible) as error:
            return (no_update, _aviso(str(error), tono="error"), *sin_cambio[2:])
        if not i.get("disponible"):
            return ("", _aviso("Aún no hay datos para mostrar en el tablero. Vuelve a intentarlo más tarde."), [], [],
                    None, None, *sin_cambio[6:])
        m = i["dataset"]
        banda = f"{entero(m['total_registros'])} registros · actualizado el {fecha(m['generado'])}"
        contenido = [
            html.P(["Periodo: ", html.Strong(i["periodo"]["texto"].capitalize()),
                    *([" · Categoría: ", html.Strong(categoria)] if categoria else []),
                    *([" · Producto: ", html.Strong(producto)] if producto else [])], className="periodo-bi"),
            _kpis(i["kpi"]),
            html.P("Ingresos: suma de las líneas de pedidos confirmados. Ticket promedio: ingresos ÷ pedidos. Son las "
                   "definiciones de los reportes de Gestión.", className="meta-bi"),
            _seccion("Evolución mensual de ingresos",
                     _grafico(graficos.mensual(i["mensual"]))),
            html.Div([
                _seccion("Productos más vendidos",
                         _grafico(graficos.productos(i["productos"]))),
                _seccion("Ventas por categoría", _tabla(
                    ("Categoría", "Ingresos", "Unidades"),
                    [[c["categoria"], bs(c["monto_centavos"]), entero(c["unidades"])] for c in i["categorias"]],
                    numericas=(1, 2))),
            ], className="dos-columnas"),
            _segmentacion(i.get("segmentacion"), i["alcance_segmentacion"]),
        ]
        return (banda, None, contenido, _dataset(i), i["especificaciones"], i["opciones"],
                [{"label": c, "value": c} for c in i["opciones"]["categorias"]], m["inicio"], m["fecha_corte"],
                desde or m["fecha_corte"])

    @app.callback(Output("producto", "options"), Output("producto", "value"),
                  Input("opciones", "data"), Input("categoria", "value"), State("producto", "value"))
    def productos(opciones, categoria, producto):
        if not opciones:
            return [], no_update
        por_categoria = opciones["productos_por_categoria"]
        lista = sorted(por_categoria.get(categoria, [])) if categoria else sorted(p for ps in por_categoria.values() for p in ps)
        return [{"label": p, "value": p} for p in lista], (producto if producto in lista else None)

    @app.callback(Output("fechas", "start_date"), Output("fechas", "end_date"), Output("categoria", "value"),
                  Input("limpiar", "n_clicks"), prevent_initial_call=True)
    def limpiar(_):
        return None, None, None

    @app.callback(Output("tallas", "children"), Input("url", "pathname"))
    def tallas(_):
        try:
            return _tallas(tablero.modelo_tallas())
        except (ServicioNoDisponible, DatosInvalidos) as error:
            return _aviso(f"No se pudo leer el modelo de tallas: {error}", tono="error")

    @app.callback(Output("recomendacion", "children"), Input("recomendar", "n_clicks"),
                  *[State(c, "value") for c, *_ in MEDIDAS], prevent_initial_call=True)
    def recomendar(_, *valores):
        if any(v is None for v in valores):
            return _aviso("Completa las cuatro medidas dentro de los rangos indicados.")
        try:
            r = tablero.recomendar_talla({c: v for (c, *_), v in zip(MEDIDAS, valores)})
        except (DatosInvalidos, ServicioNoDisponible) as error:
            return _aviso(str(error), tono="error")
        p = r["probabilidades"][r["talla"]]
        return html.Div([
            html.P([html.Span("Talla sugerida "), html.Strong(r["talla"]),
                    html.Span(f" · probabilidad {p * 100:.0f} % · por la tabla de tallas: {r['talla_por_tabla']}")],
                   className="talla-sugerida"),
            _grafico(graficos.probabilidades(r["probabilidades"], r["talla"])),
            html.P(r["aviso"], className="meta-bi")])

    @app.callback(Output("descarga", "data"), Output("descarga-estado", "children"),
                  Input({"tipo": "descargar", "nombre": ALL}, "n_clicks"), prevent_initial_call=True)
    def descargar(clics):
        if not ctx.triggered_id or not any(clics):
            return no_update, no_update
        try:
            contenido, archivo = tablero.descargar_dataset(ctx.triggered_id["nombre"])
        except SesionVencida:
            return no_update, _aviso("Tu sesión del tablero venció.", _ingresar())
        except SinPermiso:
            return no_update, _aviso("Se requiere rol administrador.", tono="error")
        except (DatosInvalidos, ServicioNoDisponible) as error:
            return no_update, _aviso(str(error), tono="error")
        # Nombre de archivo de presentación; el contenido es exactamente el que entrega IA.
        return dcc.send_bytes(contenido, f"clb-bi-{ctx.triggered_id['nombre'].replace('_', '-')}.csv"), None

    @app.callback(Output("reporte-resultado", "children"), Input("reporte", "n_clicks"), State("especificaciones", "data"),
                  prevent_initial_call=True)
    def reporte(_, especificaciones):
        if not especificaciones:
            return _aviso("Primero deben cargarse los indicadores.")
        try:
            r = tablero.generar_reporte(especificaciones)
        except SesionVencida:
            return _aviso("Tu sesión del tablero venció.", _ingresar())
        except SinPermiso:
            return _aviso("Se requiere rol administrador.", tono="error")
        except (DatosInvalidos, ServicioNoDisponible) as error:
            return _aviso(str(error), tono="error")
        return html.Div([html.P("Reporte guardado en Gestión."),
                         html.A("Ver el reporte en Gestión", href=f"{gestion}/reportes/{r['identificador']}", className="enlace")],
                        className="estado-bi exito", role="status")

    return app


def servidor_wsgi():
    """Punto de entrada de gunicorn: `gunicorn 'fuente.presentacion.app:servidor_wsgi()'`."""
    return crear_aplicacion().server
