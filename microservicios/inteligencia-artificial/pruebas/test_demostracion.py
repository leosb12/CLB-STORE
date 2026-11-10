"""Dataset sintético de inteligencia de negocios: determinismo, aislamiento, paridad de KPI con reportes, segmentación
invalidada al regenerar y acceso (GraphQL admin, lista blanca MCP). PostgreSQL real en un esquema temporal demo_prueba_*."""
import json
import uuid
from datetime import date

import httpx
import pytest

from fuente.aplicacion.consultas import ConsultarAnalitica
from fuente.dominio.agentes import autorizada
from fuente.dominio.catalogo_reportes import EspecificacionV2
from fuente.dominio.demostracion import esquema_valido
from fuente.infraestructura.aprendizaje import AgrupadorKMeans
from fuente.infraestructura.dataset_demostracion import RepositorioDemostracion, entrenar, generar
from fuente.puertos.graphql import esquema
from pruebas.conftest import conexion_analitica
from pruebas.test_graphql_gestion import _gql
from pruebas.test_puertos import _cabecera
from pruebas.test_puertos import servidor  # noqa: F401 (fixture)

pytestmark = pytest.mark.anyio
OPERATIVAS = ("pedidos", "lineas_venta", "existencias", "clientes", "eventos_procesados")
INDICADORES = """query($d: Date, $h: Date, $c: String, $p: String) {
  indicadoresDemostracion(desde: $d, hasta: $h, categoria: $c, producto: $p) }"""


def test_generacion_determinista_de_unos_diez_mil_registros():
    filas, meta = generar()
    otra, meta2 = generar()
    assert meta["hash"] == meta2["hash"] and filas == otra
    assert 9_500 <= meta["total_registros"] <= 10_500 and meta["registros"]["clientes"] == 1000
    assert generar(semilla=8)[1]["hash"] != meta["hash"]
    assert all(p[1].startswith("demo-cliente-") for p in filas["pedidos"])


def test_solo_escribe_en_un_esquema_de_demostracion_distinto_del_operativo():
    for invalido in ("public", "clb_analitica", "demo_bi; drop", "demo_bi"):
        with pytest.raises(ValueError):
            esquema_valido(invalido, "demo_bi" if invalido == "demo_bi" else "public")
    assert esquema_valido("demo_bi", "public") == "demo_bi"


@pytest.fixture
async def demo():
    conexion = conexion_analitica()
    if not conexion:
        pytest.skip("Requiere clb_postgres con clb_analitica.")
    repo = RepositorioDemostracion(conexion, f"demo_prueba_{uuid.uuid4().hex[:10]}")
    await repo.abrir()
    try:
        yield repo
    finally:
        async with repo.pool.connection() as c:
            await c.execute(f"drop schema {repo.esquema} cascade")
        await repo.cerrar()


async def _operativo(repo) -> dict:
    async with repo.pool.connection() as c:
        return {t: (await (await c.execute(f"select count(*) n from public.{t}")).fetchone())["n"] for t in OPERATIVAS}


async def test_aislamiento_paridad_de_kpi_y_segmentacion_invalidada(demo):
    antes = await _operativo(demo)
    filas, meta = generar()
    await demo.reemplazar(filas, meta)
    seg = await entrenar(demo)
    assert await _operativo(demo) == antes, "el conjunto sintético no debe tocar las tablas operativas"
    assert await demo.conteos() == meta["registros"]

    consultas = ConsultarAnalitica(demo, AgrupadorKMeans(), demostracion=demo)
    octubre = await consultas.indicadores_demostracion(date(2026, 10, 1), date(2026, 10, 31))
    reporte = await consultas.datos_reporte(EspecificacionV2.model_validate({
        "conjunto": "DEMOSTRACION", "titulo": "Ingresos octubre", "tipo": "AGREGADO", "columnas": ["MONTO", "PEDIDOS"],
        "periodo": "RANGO", "desde": "2026-10-01", "hasta": "2026-10-31"}))
    async with demo.pool.connection() as c:
        sql = await (await c.execute(
            "select sum(l.subtotal_centavos) monto, count(distinct p.identificador) pedidos from pedidos p "
            "join lineas_venta l on l.pedido = p.identificador where p.estado = 'CONFIRMADO' "
            "and p.fecha_creacion >= '2026-10-01 00:00-04' and p.fecha_creacion < '2026-11-01 00:00-04'")).fetchone()
    assert octubre["kpi"]["ingresos_centavos"] == reporte["filas"][0][0] == sql["monto"] > 0
    assert octubre["kpi"]["pedidos"] == reporte["filas"][0][1] == sql["pedidos"]
    assert reporte["conjunto"] == "DEMOSTRACION" and "sintéticos" in reporte["notas"][0]
    assert sum(m["monto_centavos"] for m in (await consultas.indicadores_demostracion())["mensual"]) == \
        (await consultas.indicadores_demostracion())["kpi"]["ingresos_centavos"]
    # Un filtro por categoría se aplica igual en el tablero y en el reporte.
    buzos = await consultas.indicadores_demostracion(categoria="Buzos")
    assert {c["categoria"] for c in buzos["categorias"]} == {"Buzos"}

    # CSV: una fila por registro (más el encabezado), UTF-8 con BOM y «;»; la vista completa = una fila por línea de venta.
    for nombre, esperado in (*meta["registros"].items(), ("completo", meta["registros"]["lineas_venta"])):
        csv = (await consultas.dataset_csv(nombre))[0]
        assert csv.startswith(b"\xef\xbb\xbf") and csv.decode("utf-8-sig").count("\n") == esperado + 1, nombre
    cabecera = (await consultas.dataset_csv("completo"))[0].decode("utf-8-sig").splitlines()[0]
    assert cabecera.startswith("fecha;pedido;estado;cliente;cliente_nombre") and "subtotal_bs" in cabecera

    assert octubre["segmentacion"]["hash_dataset"] == meta["hash"] and len(octubre["segmentacion"]["puntos"]) == seg["clientes"]
    await demo.reemplazar(filas, meta)  # regenerar invalida la segmentación hasta volver a entrenar
    assert await demo.segmentacion() is None
    otra = await entrenar(demo)
    assert (otra["silueta"], [s["clientes"] for s in otra["segmentos"]]) == (seg["silueta"], [s["clientes"] for s in seg["segmentos"]])

    resultado = await esquema.execute(INDICADORES, variable_values={"c": "x'; drop table pedidos; --"},
                                      context_value={"consultas": consultas})
    assert resultado.errors and "Filtros inválidos" in resultado.errors[0].message
    resultado = await esquema.execute(INDICADORES, variable_values={"d": "2026-10-01"}, context_value={"consultas": consultas})
    assert resultado.errors and "desde y hasta" in resultado.errors[0].message


async def test_graphql_exige_admin_y_la_herramienta_es_solo_del_agente_de_reportes(servidor):
    async with httpx.AsyncClient(base_url=servidor, timeout=30) as http:
        assert (await _gql(http, INDICADORES, token="cliente")).status_code == 403
        sin_dataset = (await _gql(http, INDICADORES)).json()["data"]["indicadoresDemostracion"]
        assert sin_dataset["disponible"] is False
        csv = "/api/v1/demostracion/dataset/completo.csv"
        assert (await http.get(csv)).status_code == 401
        assert (await http.get(csv, headers=_cabecera("cliente"))).status_code == 403
        assert (await http.get(csv, headers=_cabecera("admin"))).status_code == 404  # sin dataset generado
        assert (await http.get("/api/v1/demostracion/dataset/pg_shadow.csv", headers=_cabecera("admin"))).status_code == 422
    assert autorizada("reportes", "obtener_indicadores_demostracion")
    assert not any(autorizada(a, "obtener_indicadores_demostracion") for a in ("monitoreo", "inventario", "clientes"))


def test_el_conjunto_lo_decide_la_peticion_y_las_reglas_entienden_el_mes():
    from fuente.dominio.demostracion import conjunto_de
    from fuente.dominio.reglas_reportes import interpretar_por_reglas
    assert conjunto_de("Ingresos de octubre de 2026 del conjunto de DEMOSTRACIÓN") == "DEMOSTRACION"
    assert conjunto_de("ventas mensuales del dataset sintético") == "DEMOSTRACION"
    assert conjunto_de("ventas por talla de esta semana") == "OPERACION"
    spec, _, _ = interpretar_por_reglas("ventas totales de octubre de 2026")
    assert (spec["periodo"], spec["desde"], spec["hasta"]) == ("RANGO", "2026-10-01", "2026-10-31")
    spec, _, _ = interpretar_por_reglas("ventas de febrero 2024")
    assert spec["hasta"] == "2024-02-29"


def test_mision_sobre_la_demostracion_consulta_primero_el_dataset_sintetico():
    import asyncio
    from contextlib import asynccontextmanager
    from fuente.aplicacion.agentes import EjecutarMision
    from fuente.aplicacion.interfaces import ModeloNoDisponible
    llamadas = []

    class Llm:
        async def json(self, *_):
            raise ModeloNoDisponible()

    class Sesion:
        async def llamar(self, nombre, argumentos):
            llamadas.append((nombre, argumentos))
            return {"conjunto": "DEMOSTRACION", "periodo": "del 01/10/2026 al 31/10/2026", "ingresos_bs": "138450.00",
                    "pedidos_confirmados": 276, "unidades": 581, "ticket_promedio_bs": "501.63"}

    class Herramientas:
        @asynccontextmanager
        async def sesion(self, agente, token):
            yield Sesion()

    class Repo:
        async def auditar(self, *_):
            pass

    r = asyncio.run(EjecutarMision(Llm(), Herramientas(), Repo()).ejecutar(
        "Ingresos de octubre de 2026 del conjunto de demostración", "admin", "t"))
    assert llamadas == [("obtener_indicadores_demostracion", {"desde": "2026-10-01", "hasta": "2026-10-31"})]
    assert "138450.00" in r["agentes"][0]["respuesta"] and "sintéticos" in r["agentes"][0]["respuesta"]


# Regresión del 10-nov en la nube (salida real del modelo, fechas, «ingresos» y verificador): test_fechas_y_verificador.py


def test_la_auditoria_guarda_la_redaccion_descartada():
    import asyncio
    from contextlib import asynccontextmanager
    from fuente.aplicacion.agentes import EjecutarMision
    auditoria = []

    class Llm:
        async def json(self, *_):
            return json.dumps({"agentes": ["reportes"]})

        async def conversar(self, mensajes, herramientas):
            return {"content": "En octubre de 2026 se vendieron 999999 Bs."}

    class Sesion:
        async def llamar(self, nombre, argumentos):
            return {"periodo": "del 01/10/2026 al 31/10/2026", "ingresos_bs": "138450.00", "pedidos_confirmados": 276,
                    "unidades": 581, "ticket_promedio_bs": "501.63"}

        async def listar(self):
            return []

    class Herramientas:
        @asynccontextmanager
        async def sesion(self, agente, token):
            yield Sesion()

    class Repo:
        async def auditar(self, *a):
            auditoria.append(a)

    asyncio.run(EjecutarMision(Llm(), Herramientas(), Repo()).ejecutar(
        "Ingresos de octubre de 2026 del conjunto de demostración", "admin", "t"))
    rechazo = next(a for a in auditoria if a[2] == "verificador_cifras")
    assert rechazo[3] == {"cifras": ["999999"], "respuesta": "En octubre de 2026 se vendieron 999999 Bs."}
