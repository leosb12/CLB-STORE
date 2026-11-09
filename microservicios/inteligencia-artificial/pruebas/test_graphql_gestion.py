"""R5: consultas y acciones de gestión por GraphQL, con las mismas garantías que sus rutas REST equivalentes.

Servidor real (uvicorn) y PostgreSQL en un esquema temporal (fixture `servidor` de test_puertos); identidad y LLM dobles.
"""
import asyncio
import uuid
from types import SimpleNamespace

import httpx
import pytest

from fuente.puertos.graphql import ErrorGestion, _con_llm
from pruebas.test_puertos import _cabecera, servidor  # noqa: F401 (fixture)

pytestmark = pytest.mark.anyio

REPORTE = """mutation($p: String, $e: JSON) { generarReporte(peticion: $p, especificacion: $e) {
  identificador generativa especificacion datos datos_al: datosAl salida_modelo: salidaModelo } }"""


async def _gql(http, consulta, variables=None, token="admin"):
    return await http.post("/api/v1/graphql", json={"query": consulta, "variables": variables or {}}, headers=_cabecera(token))


def _error(respuesta):
    return respuesta.json()["errors"][0]["extensions"]


async def test_reporte_por_mutacion_historial_y_errores_con_estado_http(servidor):
    async with httpx.AsyncClient(base_url=servidor, timeout=30) as http:
        assert (await http.post("/api/v1/graphql", json={"query": REPORTE})).status_code == 401
        assert (await _gql(http, REPORTE, {"p": "ventas por talla"}, "cliente")).status_code == 403
        reporte = (await _gql(http, REPORTE, {"p": "ventas por talla de todo el historial, barras"})).json()["data"]["generarReporte"]
        assert reporte["generativa"] is False and reporte["especificacion"]["columnas"] == ["TALLA", "UNIDADES"]
        assert reporte["datos"]["filas"][0] == ["L", 3] and reporte["datos_al"]
        invalido = await _gql(http, REPORTE, {"e": {"titulo": "x", "metrica": "MONTO", "visualizacion": "KPI", "agrupar_por": "TALLA"}})
        assert _error(invalido)["codigo"] == "ESPECIFICACION_INVALIDA" and _error(invalido)["estado_http"] == 422
        con_formato = await _gql(http, """mutation($p: String, $f: [FormatoReporte!]) { generarReporte(peticion: $p, formatos: $f) {
          especificacion procedencia } }""", {"p": "ventas por talla de todo el historial en pdf", "f": ["EXCEL"]})
        elegido = con_formato.json()["data"]["generarReporte"]
        assert elegido["especificacion"]["formatos"] == ["EXCEL"] and elegido["procedencia"] == "REGLAS", con_formato.text
        ambos = await _gql(http, REPORTE, {"p": "ventas", "e": {}})
        assert _error(ambos)["estado_http"] == 422
        historial = (await _gql(http, "{ reportes(limite: 5) { identificador } }")).json()["data"]["reportes"]
        assert reporte["identificador"] in [h["identificador"] for h in historial]
        uno = (await _gql(http, "query($i: UUID!) { reporte(identificador: $i) { identificador } }",
                          {"i": reporte["identificador"]})).json()["data"]["reporte"]
        assert uno["identificador"] == reporte["identificador"]
        faltante = await _gql(http, "query($i: UUID!) { reporte(identificador: $i) { identificador } }", {"i": str(uuid.uuid4())})
        assert _error(faltante) == {"codigo": "NO_ENCONTRADO", "estado_http": 404}
        assert _error(await _gql(http, "{ reportes(limite: 0) { identificador } }"))["estado_http"] == 422
        # La descarga binaria sigue en REST con el mismo JWT admin.
        assert (await http.get(f"/api/v1/reportes/{reporte['identificador']}/excel", headers=_cabecera("admin"))).status_code == 200


async def test_mision_y_auditoria_por_graphql(servidor):
    mision = "mutation($m: String!) { ejecutarMision(mision: $m) { mision generativa agentes } }"
    async with httpx.AsyncClient(base_url=servidor, timeout=60) as http:
        assert (await _gql(http, mision, {"m": "Monitorea mi negocio"}, "cliente")).status_code == 403
        resultado = (await _gql(http, mision, {"m": "Monitorea mi negocio"})).json()["data"]["ejecutarMision"]
        assert [a["agente"] for a in resultado["agentes"]] == ["monitoreo", "reportes", "inventario", "clientes"]
        assert _error(await _gql(http, mision, {"m": "x"}))["estado_http"] == 422
        auditoria = (await _gql(http, "{ auditoria(limite: 20) { agente herramienta permitido argumentos } }")).json()["data"]["auditoria"]
        assert any(a["herramienta"] == "mision" for a in auditoria)


async def test_alertas_atendidas_por_graphql_son_idempotentes(servidor):
    evento = str(uuid.uuid4())
    cuerpo = {"evento": evento, "tipo": "stock_bajo", "variante": str(uuid.uuid4()), "producto": "Polera básica", "sku": "CLB-POL-M",
              "talla": "M", "color": "Negro", "disponible": 1, "minimo": 3, "fecha_evento": "2026-10-22T12:00:00Z"}
    atender = "mutation($e: UUID!) { atenderNotificacion(evento: $e) { evento estado atendida_por: atendidaPor } }"
    async with httpx.AsyncClient(base_url=servidor) as http:
        # La integración n8n sigue en REST interno.
        assert (await http.post("/api/v1/interno/notificaciones", json=cuerpo, headers=_cabecera("servicio"))).status_code == 201
        assert (await _gql(http, "{ notificaciones { evento } }", token="cliente")).status_code == 403
        nuevas = (await _gql(http, "{ notificaciones(estado: NUEVA) { evento mensaje fecha_evento: fechaEvento } }")).json()["data"]
        assert [n["evento"] for n in nuevas["notificaciones"]] == [evento]
        primera = (await _gql(http, atender, {"e": evento})).json()["data"]["atenderNotificacion"]
        assert primera == {"evento": evento, "estado": "ATENDIDA", "atendida_por": "admin-sub"}
        # Reintento de la cola offline con la misma alerta: mismo resultado, sin error.
        assert (await _gql(http, atender, {"e": evento})).json()["data"]["atenderNotificacion"] == primera
        assert (await _gql(http, "{ notificaciones(estado: NUEVA) { evento } }")).json()["data"]["notificaciones"] == []
        assert _error(await _gql(http, atender, {"e": str(uuid.uuid4())}))["estado_http"] == 404


async def test_propuestas_inexistentes_responden_404(servidor):
    resolver = "mutation($i: UUID!, $c: Boolean!) { resolverPropuesta(identificador: $i, confirmar: $c) { estado } }"
    async with httpx.AsyncClient(base_url=servidor) as http:
        assert (await _gql(http, "{ propuestas(estado: PENDIENTE) { identificador } }")).json()["data"]["propuestas"] == []
        for confirmar in (True, False):
            assert _error(await _gql(http, resolver, {"i": str(uuid.uuid4()), "c": confirmar}))["estado_http"] == 404


async def test_una_mision_o_reporte_a_la_vez_responde_ocupado():
    trabajo = asyncio.Semaphore(1)
    await trabajo.acquire()
    info = SimpleNamespace(context={"trabajo_llm": trabajo})
    with pytest.raises(ErrorGestion) as error:
        await _con_llm(info, lambda: asyncio.sleep(0))
    assert error.value.extensions == {"codigo": "OCUPADO", "estado_http": 429}
