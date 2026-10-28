"""Puertos de punta a punta: servidor real (uvicorn), PostgreSQL real, MCP por HTTP, GraphQL y REST.

La identidad y el LLM se reemplazan por dobles (los tokens reales de Keycloak se prueban en la demostración).
"""
import asyncio
import io
import json
import socket
import threading
import time
import uuid
from datetime import datetime, timezone

import httpx
import httpx2
import pytest
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from openpyxl import load_workbook

from fuente.aplicacion.interfaces import ModeloNoDisponible, RechazoDeServicio
from fuente.infraestructura.herramientas_mcp import HerramientasMcp
from fuente.infraestructura.analitica import RepositorioPostgres
from fuente.infraestructura.arranque import crear_aplicacion
from fuente.infraestructura.configuracion import Configuracion
from fuente.infraestructura.identidad import TokenInvalido, Usuario
from pruebas.conftest import conexion_analitica
from pruebas.test_ingesta_analitica import pedido

pytestmark = pytest.mark.anyio


class VerificadorFalso:
    async def verificar(self, token):
        roles = {"admin": {"admin", "cliente"}, "cliente": {"cliente"}, "servicio": {"servicio"}}.get(token)
        if roles is None:
            raise TokenInvalido()
        return Usuario(f"{token}-sub", frozenset(roles), token)


class TranscriptorFalso:
    async def transcribir(self, audio):
        return f"recibí {len(audio)} bytes"


class LlmApagado:
    async def json(self, *a):
        raise ModeloNoDisponible()

    async def conversar(self, *a):
        raise ModeloNoDisponible()

    async def disponible(self):
        return False


@pytest.fixture
async def servidor():
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
    await datos.aplicar_eventos_ventas([{"identificador": i + 1, "tipo": "pedido_confirmado", "identificador_pedido": d["identificador"],
                                         "datos": d} for i, d in enumerate([
        pedido("ana", [("A-M", "Poleras", "M", 2, 100)]), pedido("beto", [("A-S", "Poleras", "S", 1, 100)]),
        pedido("caro", [("B-L", "Pantalones", "L", 3, 250)], dias=40)])], 3)
    await datos.marcar_al_dia("ventas")
    try:
        yield f"http://127.0.0.1:{puerto}"
    finally:
        uv.should_exit = True
        hilo.join(10)
        async with datos.pool.connection() as c:
            await c.execute(f"drop schema {esquema} cascade")
        await datos.cerrar()


def _cabecera(token):
    return {"Authorization": f"Bearer {token}"}


async def test_graphql_campos_puntuales_y_rol_admin(servidor):
    consulta = {"query": "{ productos { nombre stock ventas } resumenVentas(periodo: TODO, agruparPor: TALLA) { unidades grupos { clave unidades } } }"}
    async with httpx.AsyncClient(base_url=servidor) as http:
        assert (await http.post("/api/v1/graphql", json=consulta)).status_code == 401
        assert (await http.post("/api/v1/graphql", json=consulta, headers=_cabecera("cliente"))).json()["código"] == "ACCESO_DENEGADO"
        datos = (await http.post("/api/v1/graphql", json=consulta, headers=_cabecera("admin"))).json()["data"]
        assert datos["resumenVentas"] == {"unidades": 6, "grupos": [{"clave": "L", "unidades": 3}, {"clave": "M", "unidades": 2},
                                                                  {"clave": "S", "unidades": 1}]}
        assert datos["productos"] == []  # sin copia de existencias todavía
        libre = await http.post("/api/v1/graphql", json={"query": "{ resumenVentas(periodo: \"; drop table pedidos\") { unidades } }"},
                                headers=_cabecera("admin"))
        assert libre.json()["errors"]


async def test_mcp_exige_identidad_y_aplica_la_lista_blanca(servidor):
    async def llamar(token, agente, herramienta, argumentos):
        http = httpx2.AsyncClient(headers={**_cabecera(token), "X-Clb-Agente": agente})
        async with http, Client(streamable_http_client(f"{servidor}/mcp/", http_client=http)) as cliente:
            return await cliente.call_tool(herramienta, argumentos)

    permitido = await llamar("admin", "monitoreo", "obtener_ventas", {"periodo": "TODO"})
    assert not permitido.is_error and json.loads(permitido.content[0].text)["unidades"] == 6
    assert (await llamar("admin", "clientes", "obtener_ventas", {"periodo": "TODO"})).is_error
    fuera_de_esquema = await llamar("admin", "monitoreo", "obtener_ventas", {"periodo": "SIEMPRE; DROP"})
    assert fuera_de_esquema.is_error
    # Con el cliente MCP de los agentes: el rechazo llega como RechazoDeServicio, no envuelto en un ExceptionGroup.
    with pytest.raises(RechazoDeServicio, match="no está permitida"):
        async with HerramientasMcp(f"{servidor}/mcp/").sesion("clientes", "admin") as sesion:
            await sesion.llamar("obtener_ventas", {"periodo": "TODO"})
    async with httpx.AsyncClient(base_url=servidor) as http:
        assert (await http.post("/mcp/", json={}, headers={"X-Clb-Agente": "monitoreo"})).status_code == 401
        assert (await http.post("/mcp/", json={}, headers={**_cabecera("admin"), "X-Clb-Agente": "intruso"})).status_code == 403
        assert (await http.post("/mcp/", json={}, headers={**_cabecera("cliente"), "X-Clb-Agente": "monitoreo"})).status_code == 403
        auditoria = (await http.get("/api/v1/agentes/auditoria", headers=_cabecera("admin"))).json()["auditoria"]
    rechazos = [a for a in auditoria if not a["permitido"]]
    assert rechazos and rechazos[0]["agente"] == "clientes" and rechazos[0]["usuario"] == "admin-sub"


async def test_reporte_por_texto_historial_y_excel(servidor):
    async with httpx.AsyncClient(base_url=servidor, timeout=30) as http:
        respuesta = await http.post("/api/v1/reportes", json={"peticion": "ventas por talla de todo el historial, barras"},
                                    headers=_cabecera("admin"))
        assert respuesta.status_code == 201, respuesta.text
        reporte = respuesta.json()
        assert reporte["generativa"] is False and reporte["especificacion"]["agrupar_por"] == "TALLA"
        assert reporte["datos"]["filas"][0] == {"clave": "L", "valor": 3} and reporte["datos_al"]
        invalido = await http.post("/api/v1/reportes", json={"especificacion": {"titulo": "x", "metrica": "MONTO", "visualizacion": "KPI",
                                                                                "agrupar_por": "TALLA"}}, headers=_cabecera("admin"))
        assert invalido.status_code == 422 and invalido.json()["código"] == "ESPECIFICACION_INVALIDA"
        assert (await http.get("/api/v1/reportes", headers=_cabecera("admin"))).json()["reportes"][0]["identificador"] == reporte["identificador"]
        excel = await http.get(f"/api/v1/reportes/{reporte['identificador']}/excel", headers=_cabecera("admin"))
    hoja = load_workbook(io.BytesIO(excel.content))["Reporte"]
    filas = [tuple(f) for f in hoja.iter_rows(min_row=7, max_col=2, values_only=True)]
    assert filas[:3] == [("L", 3), ("M", 2), ("S", 1)] and hoja._charts


async def test_mision_sin_modelo_tallas_y_salud(servidor):
    async with httpx.AsyncClient(base_url=servidor, timeout=60) as http:
        mision = (await http.post("/api/v1/agentes/misiones", json={"mision": "Monitorea mi negocio"}, headers=_cabecera("admin"))).json()
        assert [a["agente"] for a in mision["agentes"]] == ["monitoreo", "reportes", "inventario", "clientes"]
        clientes = mision["agentes"][3]
        assert clientes["fuentes"][0]["herramienta"] == "obtener_segmentos" and clientes["fuentes"][0]["resultado"]["clientes"] == 3
        assert (await http.post("/api/v1/agentes/misiones", json={"mision": "x"}, headers=_cabecera("cliente"))).status_code == 403
        modelo = (await http.get("/api/v1/tallas/modelo")).json()
        assert modelo["clases"] == ["XS", "S", "M", "L", "XL"] and modelo["metricas"]["exactitud"] > 0.85
        talla = (await http.post("/api/v1/tallas/recomendacion", json={"altura_cm": 170, "peso_kg": 70, "pecho_cm": 98, "cintura_cm": 82})).json()
        assert talla["talla"] == "M" and "orientativa" in talla["aviso"]
        assert (await http.post("/api/v1/tallas/recomendacion", json={"altura_cm": 1, "peso_kg": 70, "pecho_cm": 98, "cintura_cm": 82})).status_code == 422
        salud = (await http.get("/salud")).json()
        assert salud["estado"] == "ACTIVO" and salud["dependencias"]["ollama"].startswith("NO_DISPONIBLE")


async def test_voz_exige_admin_antes_de_leer_el_audio(servidor):
    archivos = {"audio": ("voz.webm", b"audio-de-prueba" * 3, "audio/webm")}
    async with httpx.AsyncClient(base_url=servidor) as http:
        assert (await http.post("/api/v1/voz", files=archivos)).status_code == 401
        assert (await http.post("/api/v1/voz", files=archivos, headers=_cabecera("cliente"))).status_code == 403
        respuesta = await http.post("/api/v1/voz", files=archivos, headers=_cabecera("admin"))
        assert respuesta.json() == {"texto": "recibí 45 bytes"}
        sin_campo = await http.post("/api/v1/voz", files={"otro": ("x", b"1")}, headers=_cabecera("admin"))
        assert sin_campo.status_code == 422 and sin_campo.json()["código"] == "AUDIO_INVALIDO"


async def test_notificaciones_de_n8n_idempotentes_y_atendidas_por_admin(servidor):
    evento = str(uuid.uuid4())
    cuerpo = {"evento": evento, "tipo": "stock_bajo", "variante": str(uuid.uuid4()), "producto": "Polera básica", "sku": "CLB-POL-M",
              "talla": "M", "color": "Negro", "disponible": 1, "minimo": 3, "fecha_evento": "2026-10-22T12:00:00Z"}
    async with httpx.AsyncClient(base_url=servidor) as http:
        ruta = "/api/v1/interno/notificaciones"
        assert (await http.post(ruta, json=cuerpo)).status_code == 401
        assert (await http.post(ruta, json=cuerpo, headers=_cabecera("cliente"))).status_code == 403
        assert (await http.post(ruta, json=cuerpo, headers=_cabecera("firma-invalida"))).status_code == 401
        assert (await http.post(ruta, json=cuerpo, headers=_cabecera("admin"))).status_code == 403  # solo la automatización
        primera = await http.post(ruta, json=cuerpo, headers=_cabecera("servicio"))
        assert primera.status_code == 201
        assert primera.json()["notificacion"]["mensaje"] == "Polera básica (M, Negro) bajó a 1 unidad; el mínimo es 3. Conviene reponer."
        repetida = await http.post(ruta, json={**cuerpo, "disponible": 0}, headers=_cabecera("servicio"))
        assert repetida.status_code == 200 and repetida.json()["notificacion"]["disponible"] == 1  # n8n reintentó: no se duplica
        assert (await http.post(ruta, json={**cuerpo, "evento": str(uuid.uuid4()), "producto": "<script>"},
                                headers=_cabecera("servicio"))).status_code == 422
        assert (await http.get("/api/v1/notificaciones", headers=_cabecera("cliente"))).status_code == 403
        nuevas = (await http.get("/api/v1/notificaciones?estado=NUEVA", headers=_cabecera("admin"))).json()["notificaciones"]
        assert [n["evento"] for n in nuevas] == [evento]
        atendida = (await http.post(f"/api/v1/notificaciones/{evento}/atender", headers=_cabecera("admin"))).json()["notificacion"]
        assert atendida["estado"] == "ATENDIDA" and atendida["atendida_por"] == "admin-sub"
        assert (await http.get("/api/v1/notificaciones?estado=NUEVA", headers=_cabecera("admin"))).json()["notificaciones"] == []
        assert (await http.post(f"/api/v1/notificaciones/{uuid.uuid4()}/atender", headers=_cabecera("admin"))).status_code == 404
