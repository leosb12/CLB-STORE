"""Reportes v2: catálogo explícito, periodos calendario de La Paz, procedencia veraz, formatos pedidos y datos reales.

Integración: servidor real (uvicorn) y PostgreSQL en un esquema temporal; identidad y LLM dobles. El LLM real se prueba
en test_ollama.py.
"""
import asyncio
import io
import json
import socket
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
import uvicorn
from openpyxl import load_workbook
from pydantic import ValidationError

from fuente.aplicacion.interfaces import ModeloNoDisponible
from fuente.aplicacion.reportes import (EspecificacionInvalida, GenerarReporte, ReporteAmbiguo, ReporteNoDisponible,
                                        esquema_modelo, procedencia)
from fuente.dominio.catalogo_reportes import EspecificacionV2, desde_v1, describir_v2, normalizar, valor_filtro, ventana
from fuente.dominio.reglas_reportes import interpretar_por_reglas
from fuente.dominio.reportes import ZONA_BOLIVIA
from fuente.infraestructura.analitica import RepositorioPostgres
from fuente.infraestructura.arranque import crear_aplicacion
from fuente.infraestructura.configuracion import Configuracion
from pruebas.conftest import conexion_analitica
from pruebas.test_aplicacion import RepositorioMemoria
from pruebas.test_ingesta_analitica import pedido, variante
from pruebas.test_puertos import LlmApagado, TranscriptorFalso, VerificadorFalso, _cabecera

pytestmark = pytest.mark.anyio

EJEMPLO = ("Quiero las ventas de esta semana con nombres de clientes, productos, cantidad, precio unitario y total "
           "comprado, un gráfico de barras y salida solo PDF")
DETALLE = {"version": 2, "titulo": "Ventas de la semana", "fuente": "VENTAS", "tipo": "DETALLE",
           "columnas": ["CLIENTE", "PRODUCTO", "CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL"], "periodo": "TODO",
           "grafico": {"tipo": "BARRAS", "eje": "CLIENTE", "valor": "MONTO"}, "formatos": ["PDF"]}


def _v2(**cambios):
    return {**DETALLE, **cambios}


# --- Dominio: catálogo y periodos ---------------------------------------------------------------------------------

@pytest.mark.parametrize("cambios", [
    {"columnas": ["CLIENTE", "MONTO"]},                       # total en un detalle
    {"tipo": "AGREGADO", "columnas": ["CLIENTE", "CANTIDAD"]},  # dato de fila en un agregado
    {"tipo": "AGREGADO", "columnas": ["CLIENTE"], "grafico": {"tipo": "NINGUNO"}},  # agregado sin total
    {"columnas": ["CLIENTE", "COSTO"]},                       # campo inexistente
    {"columnas": ["CLIENTE", "CLIENTE"]},
    {"filtros": [{"campo": "CLIENTE", "operador": "MAYOR_O_IGUAL", "valor": "Ana"}]},
    {"filtros": [{"campo": "TALLA", "operador": "IGUAL", "valor": "M'; drop table pedidos"}]},
    {"filtros": [{"campo": "SUBTOTAL", "operador": "MAYOR_O_IGUAL", "valor": "mucho"}]},
    {"filtros": [{"campo": "ESTADO", "operador": "IGUAL", "valor": "BORRADO"}]},
    {"orden": [{"campo": "TALLA", "direccion": "ASC"}]},       # orden por algo que no es columna
    {"grafico": {"tipo": "LINEAS", "eje": "CLIENTE", "valor": "MONTO"}},
    {"grafico": {"tipo": "BARRAS", "eje": "CLIENTE", "valor": "SUBTOTAL"}},
    {"fuente": "INVENTARIO", "columnas": ["PRODUCTO", "STOCK_DISPONIBLE"], "periodo": "ESTA_SEMANA",
     "grafico": {"tipo": "NINGUNO"}},
    {"periodo": "RANGO", "desde": "2026-01-01"},
    {"formatos": ["PDF", "PDF"]},
    {"titulo": "=HYPERLINK(1)"},
    {"sql": "select 1"},
])
def test_el_catalogo_rechaza_combinaciones_imposibles(cambios):
    with pytest.raises(ValidationError):
        EspecificacionV2.model_validate(_v2(**cambios))


def test_periodos_calendario_distintos_de_los_moviles():
    miercoles = datetime(2026, 11, 11, 15, 0, tzinfo=ZONA_BOLIVIA)
    assert ventana("ESTA_SEMANA", miercoles)[0] == datetime(2026, 11, 9, tzinfo=ZONA_BOLIVIA)
    assert ventana("ULTIMOS_7_DIAS", miercoles)[0] == miercoles - timedelta(days=7)
    assert ventana("SEMANA_PASADA", miercoles) == (datetime(2026, 11, 2, tzinfo=ZONA_BOLIVIA), datetime(2026, 11, 9, tzinfo=ZONA_BOLIVIA))
    assert ventana("ESTE_MES", miercoles)[0] == datetime(2026, 11, 1, tzinfo=ZONA_BOLIVIA)
    assert ventana("ULTIMOS_30_DIAS", miercoles)[0] == miercoles - timedelta(days=30)
    assert ventana("MES_PASADO", miercoles) == (datetime(2026, 10, 1, tzinfo=ZONA_BOLIVIA), datetime(2026, 11, 1, tzinfo=ZONA_BOLIVIA))
    # 23:30 del domingo en La Paz ya es lunes en UTC: la semana se decide en hora boliviana.
    domingo_noche = datetime(2026, 11, 9, 3, 30, tzinfo=timezone.utc)
    assert ventana("ESTA_SEMANA", domingo_noche)[0] == datetime(2026, 11, 2, tzinfo=ZONA_BOLIVIA)


def test_dinero_en_centavos_y_valores_tipados():
    assert valor_filtro("DINERO", "SUBTOTAL", "150.5") == 15050
    assert valor_filtro("DINERO", "SUBTOTAL", "Bs 1234,05") == 123405
    assert valor_filtro("BOOLEANO", "STOCK_BAJO", "sí") is True
    assert valor_filtro("TEXTO", "ESTADO", "cancelado") == "CANCELADO"


def test_historial_v1_se_convierte_sin_cambiar_su_periodo_movil():
    v1 = {"titulo": "Unidades por talla", "metrica": "UNIDADES", "agrupar_por": "TALLA", "periodo": "SEMANA",
          "visualizacion": "BARRAS", "metricas_extra": ["MONTO"], "filtros": {"categoria": "Poleras"}}
    spec = EspecificacionV2.model_validate(desde_v1(v1))
    assert (spec.tipo, spec.columnas, spec.periodo) == ("AGREGADO", ["TALLA", "UNIDADES", "MONTO"], "ULTIMOS_7_DIAS")
    assert spec.grafico.eje == "TALLA" and spec.filtros[0].campo == "CATEGORIA"


def test_reglas_entienden_el_ejemplo_y_preguntan_si_no_saben():
    spec, _, pregunta = interpretar_por_reglas(EJEMPLO)
    assert pregunta is None and spec["tipo"] == "DETALLE" and spec["periodo"] == "ESTA_SEMANA"
    assert spec["columnas"] == ["CLIENTE", "PRODUCTO", "CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL"]
    assert spec["formatos"] == ["PDF"] and spec["grafico"]["tipo"] == "BARRAS"
    assert interpretar_por_reglas("hazme algo bonito")[2]
    assert interpretar_por_reglas("ventas de los ultimos 7 dias")[0]["periodo"] == "ULTIMOS_7_DIAS"


def test_esquema_del_modelo_es_plano():
    texto = json.dumps(esquema_modelo())
    assert "$ref" not in texto and "anyOf" not in texto and "pattern" not in texto


# --- Aplicación con dobles ----------------------------------------------------------------------------------------

class LlmFijo:
    def __init__(self, respuesta=None, error=None):
        self.respuesta, self.error, self.llamadas = respuesta, error, 0

    async def json(self, *a):
        self.llamadas += 1
        if self.error:
            raise self.error
        return json.dumps(self.respuesta) if isinstance(self.respuesta, dict) else self.respuesta


def _salida_modelo(**cambios):
    return {"titulo": "Ventas de la semana", "fuente": "VENTAS", "tipo": "DETALLE",
            "columnas": ["CLIENTE", "PRODUCTO", "CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL"], "filtros": [],
            "periodo": "ESTA_SEMANA", "desde": "", "hasta": "", "orden": [], "limite": 200,
            "grafico": {"tipo": "BARRAS", "eje": "CLIENTE", "valor": "MONTO"}, "formatos": ["PDF"], "faltantes": [],
            "aclaracion": "", **cambios}


class Herramientas:
    def __init__(self):
        self.argumentos = None

    def sesion(self, agente, token):
        herramientas = self

        class Sesion:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def llamar(self, nombre, argumentos):
                herramientas.argumentos = argumentos
                return {"version": 2, "filas": [], "notas": [], "datos_al": None}
        return Sesion()


async def test_modelo_valido_queda_como_modelo_del_servidor():
    r = await GenerarReporte(LlmFijo(_salida_modelo()), None, None).interpretar(EJEMPLO)
    assert (r["procedencia"], r["generativa"]) == ("MODELO", True)
    assert r["especificacion"].formatos == ["PDF"] and r["especificacion"].periodo == "ESTA_SEMANA"


async def test_columnas_y_grafico_no_pedidos_se_quitan_con_aviso():
    salida = _salida_modelo(columnas=["CLIENTE", "PRECIO_UNITARIO", "CANTIDAD", "SUBTOTAL", "STOCK_ACTUAL"],
                            formatos=["PDF", "EXCEL"])
    r = await GenerarReporte(LlmFijo(salida), None, None).interpretar("ventas de hoy con cliente y precio unitario")
    spec = r["especificacion"]
    assert spec.columnas == ["CLIENTE", "PRECIO_UNITARIO"] and spec.grafico.tipo == "NINGUNO" and spec.formatos == []
    assert any("Se quitaron columnas" in n for n in r["notas"])


@pytest.mark.parametrize("motivo,texto", [("DESCONECTADO", "No se pudo conectar"), ("TIMEOUT", "no respondió a tiempo"),
                                          ("NO_DISPONIBLE", "respondió con un error")])
async def test_fallos_del_modelo_se_distinguen_y_las_reglas_lo_dicen(motivo, texto):
    llm = LlmFijo(error=ModeloNoDisponible("x", motivo))
    r = await GenerarReporte(llm, None, None).interpretar(EJEMPLO)
    assert (r["procedencia"], r["generativa"], r["motivo_fallo"]) == ("REGLAS", False, motivo)
    assert texto in r["observacion"] and "limitada por reglas" in r["observacion"]
    assert r["especificacion"].columnas == ["CLIENTE", "PRODUCTO", "CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL"]


async def test_respuesta_incompatible_cortada_o_fuera_del_catalogo():
    for respuesta in ('{"titulo": "x", "fuente": "VENT', _salida_modelo(periodo="RANGO", desde="ayer")):
        r = await GenerarReporte(LlmFijo(respuesta), None, None).interpretar(EJEMPLO)
        assert r["procedencia"] == "REGLAS" and r["motivo_fallo"] == "INCOMPATIBLE"


async def test_lo_inexistente_se_explica_y_lo_ambiguo_se_pregunta():
    with pytest.raises(ReporteNoDisponible, match="costo"):
        await GenerarReporte(LlmFijo(error=AssertionError("no se llama")), None, None).interpretar("margen por producto")
    with pytest.raises(ReporteNoDisponible, match="devoluciones"):
        await GenerarReporte(LlmFijo(_salida_modelo(faltantes=["devoluciones"])), None, None).interpretar("ventas y devoluciones")
    with pytest.raises(ReporteAmbiguo, match="¿Qué semana"):
        await GenerarReporte(LlmFijo(_salida_modelo(aclaracion="¿Qué semana?")), None, None).interpretar("ventas de la semana X")
    with pytest.raises(ReporteAmbiguo, match="torta"):
        await GenerarReporte(LlmFijo(), None, None).interpretar("ventas por talla en gráfico de torta")
    llm = LlmFijo()
    with pytest.raises(ReporteAmbiguo):  # sin nada que medir se pregunta antes de llamar al modelo
        await GenerarReporte(llm, None, None).interpretar("hazme un informe bonito")
    assert llm.llamadas == 0


async def test_la_eleccion_de_formato_en_pantalla_prevalece_y_lo_manual_se_declara():
    herramientas, repo = Herramientas(), RepositorioMemoria()
    caso = GenerarReporte(LlmFijo(_salida_modelo()), herramientas, repo)
    r = await caso.ejecutar("a", "t", EJEMPLO, formatos=["EXCEL", "PANTALLA"])
    assert r["especificacion"]["formatos"] == ["EXCEL", "PANTALLA"] and r["procedencia"] == "MODELO"
    assert herramientas.argumentos["especificacion"]["formatos"] == ["EXCEL", "PANTALLA"]
    manual = await caso.ejecutar("a", "t", especificacion=_v2())
    assert manual["procedencia"] == "MANUAL" and not manual["generativa"]
    with pytest.raises(EspecificacionInvalida):
        await caso.ejecutar("a", "t", especificacion=_v2(columnas=["CLIENTE", "PEDIDOS"]))
    assert procedencia({"generativa": False, "observacion": "Especificación editada por el usuario."}) == "MANUAL"
    assert procedencia({"generativa": True}) == "MODELO" and procedencia({"generativa": False, "observacion": "x"}) == "REGLAS"


def test_interpretacion_legible_con_fechas_y_salida():
    spec = EspecificacionV2.model_validate(normalizar(_v2(periodo="ESTA_SEMANA"))[0]).model_dump(mode="json")
    texto = describir_v2(spec, datetime(2026, 11, 11, 15, tzinfo=ZONA_BOLIVIA))
    assert "Cliente, Producto, Cantidad, Precio unitario, Total comprado" in texto
    assert "esta semana (desde el lunes): 09/11/2026 al 11/11/2026" in texto and "salida: solo PDF" in texto
    assert "gráfico de barras: Ventas (Bs) por cliente" in texto


# --- Integración con PostgreSQL real ------------------------------------------------------------------------------

@pytest.fixture
async def servidor_v2():
    conexion = conexion_analitica()
    if not conexion:
        pytest.skip("Requiere clb_postgres con clb_analitica.")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        puerto = s.getsockname()[1]
    esquema = f"clb_prueba_{uuid.uuid4().hex[:12]}"
    configuracion = Configuracion(analitica_clave="no-se-usa", identidad_emisor="x", identidad_secreto="x",
                                  intervalo_ingesta=0, mcp_url=f"http://127.0.0.1:{puerto}/mcp/")
    app = crear_aplicacion(configuracion, repositorio=RepositorioPostgres(conexion, esquema), llm=LlmApagado(),
                           verificador=VerificadorFalso(), transcriptor=TranscriptorFalso())
    uv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=puerto, log_level="warning", lifespan="on"))
    hilo = threading.Thread(target=lambda: asyncio.run(uv.serve(), loop_factory=asyncio.SelectorEventLoop), daemon=True)
    hilo.start()
    while not uv.started:
        time.sleep(0.05)
    datos = RepositorioPostgres(conexion, esquema)
    await datos.abrir()
    pedidos = [pedido("ana", [("A-M", "Poleras", "M", 2, 100), ("B-L", "Pantalones", "L", 1, 250)]),
               pedido("beto", [("A-S", "Poleras", "S", 1, 120)]),
               pedido("caro", [("B-L", "Pantalones", "L", 3, 250)], dias=40),
               pedido("ana", [("A-M", "Poleras", "M", 5, 90)], estado="CANCELADO")]
    await datos.aplicar_eventos_ventas([{"identificador": i + 1, "tipo": "pedido_confirmado" if d["estado"] == "CONFIRMADO" else
                                         "pedido_cancelado", "identificador_pedido": d["identificador"], "datos": d}
                                        for i, d in enumerate(pedidos)], 4)
    await datos.guardar_nombres([{"cliente": "ana", "nombre": "Ana Pérez", "origen": "PERFIL"},
                                 {"cliente": "beto", "nombre": "Beto Rojas", "origen": "CUENTA"}])  # caro: sin nombre
    await datos.reemplazar_existencias([variante("A-M", 1, 3, "prod-A"), variante("A-S", 10, 3, "prod-A"),
                                        variante("B-L", 0, 2, "prod-B")])
    for fuente in ("ventas", "existencias", "clientes"):
        await datos.marcar_al_dia(fuente)
    try:
        yield f"http://127.0.0.1:{puerto}", datos
    finally:
        uv.should_exit = True
        hilo.join(10)
        async with datos.pool.connection() as c:
            await c.execute(f"drop schema {esquema} cascade")
        await datos.cerrar()


REPORTE = """mutation($p: String, $e: JSON, $f: [FormatoReporte!]) { generarReporte(peticion: $p, especificacion: $e, formatos: $f) {
  identificador especificacion datos interpretacion procedencia generativa observacion } }"""


async def _generar(http, **variables):
    r = (await http.post("/api/v1/graphql", json={"query": REPORTE, "variables": variables}, headers=_cabecera("admin"))).json()
    assert "errors" not in r, r
    return r["data"]["generarReporte"]


async def test_ejemplo_real_detalle_con_nombres_precios_historicos_grafico_y_solo_pdf(servidor_v2):
    url, _ = servidor_v2
    async with httpx.AsyncClient(base_url=url, timeout=60) as http:
        # Sin modelo (LlmApagado): procedencia REGLAS declarada, pero el contenido pedido se respeta.
        r = await _generar(http, p=EJEMPLO)
        assert (r["procedencia"], r["generativa"]) == ("REGLAS", False) and "limitada por reglas" in r["observacion"]
        datos = r["datos"]
        assert [c["campo"] for c in datos["columnas"]] == ["CLIENTE", "PRODUCTO", "CANTIDAD", "PRECIO_UNITARIO", "SUBTOTAL"]
        hoy = {tuple(f) for f in datos["filas"]}
        assert {("Ana Pérez", "Prenda A-M", 2, 10000, 20000), ("Ana Pérez", "Prenda B-L", 1, 25000, 25000),
                ("Beto Rojas", "Prenda A-S", 1, 12000, 12000)} == hoy  # sin el cancelado ni el de hace 40 días
        assert datos["totales"] == {"CANTIDAD": 4, "SUBTOTAL": 57000}
        assert datos["grafico"]["eje"] == "CLIENTE" and datos["grafico"]["puntos"][0] == {"clave": "Ana Pérez", "valor": 45000}
        assert "salida: solo PDF" in r["interpretacion"] and any("Precios históricos" in n for n in datos["notas"])
        assert datos["periodo"]["codigo"] == "ESTA_SEMANA" and datos["datos_al"]
        ident = r["identificador"]
        pdf = await http.get(f"/api/v1/reportes/{ident}/pdf", headers=_cabecera("admin"))
        excel = await http.get(f"/api/v1/reportes/{ident}/excel", headers=_cabecera("admin"))
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and len(pdf.content) > 2500
    assert excel.status_code == 409 and excel.json()["código"] == "FORMATO_NO_SOLICITADO"


async def test_agregado_por_cliente_y_producto_con_excel_y_sin_nombre_declarado(servidor_v2):
    url, _ = servidor_v2
    spec = {"version": 2, "titulo": "Ventas por cliente", "fuente": "VENTAS", "tipo": "AGREGADO",
            "columnas": ["CLIENTE", "PRODUCTO", "UNIDADES", "MONTO"], "periodo": "TODO",
            "orden": [{"campo": "MONTO", "direccion": "DESC"}], "formatos": ["EXCEL", "PDF"]}
    async with httpx.AsyncClient(base_url=url, timeout=60) as http:
        r = await _generar(http, e=spec)
        assert r["procedencia"] == "MANUAL"
        filas = [tuple(f) for f in r["datos"]["filas"]]
        assert filas[0] == ("Sin nombre registrado", "Prenda B-L", 3, 75000)
        assert ("Ana Pérez", "Prenda A-M", 2, 20000) in filas and r["datos"]["totales"] == {"UNIDADES": 7, "MONTO": 132000}
        assert any("1 cliente(s) sin nombre registrado" in n for n in r["datos"]["notas"])
        excel = await http.get(f"/api/v1/reportes/{r['identificador']}/excel", headers=_cabecera("admin"))
        assert (await http.get(f"/api/v1/reportes/{r['identificador']}/pdf", headers=_cabecera("admin"))).status_code == 200
    hoja = load_workbook(io.BytesIO(excel.content))["Reporte"]
    filas_hoja = [tuple(f) for f in hoja.iter_rows(values_only=True)]
    encabezado = filas_hoja.index(("Cliente", "Producto", "Unidades", "Ventas (Bs)"))
    assert filas_hoja[encabezado + 1] == ("Sin nombre registrado", "Prenda B-L", 3, 750)
    assert filas_hoja[-1] == ("Total", None, 7, 1320)
    assert hoja.cell(encabezado + 2, 4).number_format == '"Bs" #,##0.00'


async def test_filtros_combinados_cancelados_y_periodo_vacio(servidor_v2):
    url, _ = servidor_v2
    base = {"version": 2, "titulo": "Filtrado", "fuente": "VENTAS", "tipo": "DETALLE", "periodo": "TODO",
            "columnas": ["CLIENTE", "TALLA", "SUBTOTAL"]}
    async with httpx.AsyncClient(base_url=url, timeout=60) as http:
        r = await _generar(http, e={**base, "filtros": [{"campo": "CATEGORIA", "operador": "IGUAL", "valor": "poleras"},
                                                        {"campo": "SUBTOTAL", "operador": "MAYOR_O_IGUAL", "valor": "150"}]})
        assert [tuple(f) for f in r["datos"]["filas"]] == [("Ana Pérez", "M", 20000)]
        cancelados = await _generar(http, e={**base, "filtros": [{"campo": "ESTADO", "operador": "IGUAL", "valor": "CANCELADO"}]})
        assert [tuple(f) for f in cancelados["datos"]["filas"]] == [("Ana Pérez", "M", 45000)]
        ayer = await _generar(http, e={**base, "periodo": "AYER"})
        assert ayer["datos"]["filas"] == [] and any("No hay datos" in n for n in ayer["datos"]["notas"])
        mes_pasado = (date.today().replace(day=1) - timedelta(days=1))
        rango = await _generar(http, e={**base, "periodo": "RANGO", "desde": (date.today() - timedelta(days=45)).isoformat(),
                                        "hasta": (date.today() - timedelta(days=35)).isoformat()})
        assert [f[0] for f in rango["datos"]["filas"]] == ["Sin nombre registrado"] and mes_pasado


async def test_stock_bajo_inventario_y_formatos_por_defecto(servidor_v2):
    url, _ = servidor_v2
    spec = {"version": 2, "titulo": "Stock bajo", "fuente": "INVENTARIO", "tipo": "DETALLE", "periodo": "TODO",
            "columnas": ["SKU", "STOCK_DISPONIBLE", "STOCK_MINIMO"],
            "filtros": [{"campo": "STOCK_BAJO", "operador": "IGUAL", "valor": "SI"}],
            "orden": [{"campo": "STOCK_DISPONIBLE", "direccion": "ASC"}]}
    async with httpx.AsyncClient(base_url=url, timeout=60) as http:
        r = await _generar(http, e=spec)
        assert [tuple(f) for f in r["datos"]["filas"]] == [("B-L", 0, 2), ("A-M", 1, 3)]
        assert r["datos"]["periodo"]["texto"] == "existencias actuales" and "pantalla (exportaciones a pedido)" in r["interpretacion"]
        # Sin formato pedido se ofrecen ambos archivos bajo demanda.
        for formato in ("excel", "pdf"):
            assert (await http.get(f"/api/v1/reportes/{r['identificador']}/{formato}", headers=_cabecera("admin"))).status_code == 200
        total = await _generar(http, e={**spec, "tipo": "AGREGADO", "columnas": ["VARIANTES", "VARIANTES_STOCK_BAJO",
                                                                                  "DISPONIBLE_TOTAL"], "filtros": [], "orden": []})
        assert total["datos"]["filas"] == [[3, 2, 11]]


async def test_errores_de_contrato_y_historial_v1_legible(servidor_v2):
    url, datos = servidor_v2
    async with httpx.AsyncClient(base_url=url, timeout=60) as http:
        r = (await http.post("/api/v1/graphql", json={"query": REPORTE, "variables": {"p": "margen de ganancia por producto"}},
                             headers=_cabecera("admin"))).json()
        assert r["errors"][0]["extensions"]["codigo"] == "NO_DISPONIBLE" and r["errors"][0]["extensions"]["motivos"]
        # Un reporte guardado antes de la v2 se sigue leyendo y exportando igual.
        antiguo = {"identificador": str(uuid.uuid4()), "usuario": "a", "peticion": "ventas por talla", "salida_modelo": None,
                   "especificacion": {"titulo": "Unidades por talla", "metrica": "UNIDADES", "agrupar_por": "TALLA",
                                      "periodo": "TODO", "visualizacion": "BARRAS", "destino": "PANEL", "limite": 10},
                   "generativa": True, "observacion": None,
                   "datos": {"filas": [{"clave": "L", "valor": 3}], "total": 3, "columnas": ["UNIDADES"]},
                   "datos_al": None, "fecha": datetime.now(timezone.utc).isoformat()}
        await datos.guardar_reporte(antiguo)
        leido = (await http.post("/api/v1/graphql", json={"query": "query($i: UUID!) { reporte(identificador: $i) { interpretacion "
                                                                     "procedencia } }", "variables": {"i": antiguo["identificador"]}},
                                 headers=_cabecera("admin"))).json()["data"]["reporte"]
        assert leido == {"interpretacion": "Unidades vendidas por talla · todo el historial · top 10, de mayor a menor",
                         "procedencia": "MODELO"}
        assert (await http.get(f"/api/v1/reportes/{antiguo['identificador']}/excel", headers=_cabecera("admin"))).status_code == 200
        # Re-ejecutar la especificación v1 del historial: se convierte al catálogo y se declara.
        re = await _generar(http, e=antiguo["especificacion"])
        assert re["especificacion"]["version"] == 2 and any("convertida" in n for n in re["datos"]["notas"])
