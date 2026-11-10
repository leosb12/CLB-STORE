"""Raíz de composición: único lugar que conoce todas las implementaciones y las inyecta en los casos de uso.

Ejecutar: `uvicorn --factory fuente.infraestructura.arranque:app_desde_entorno --host 0.0.0.0 --port 8000`
"""
import asyncio
import contextlib
import logging
import os
from types import SimpleNamespace

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from strawberry.fastapi import GraphQLRouter

from fuente.aplicacion.agentes import EjecutarMision, GestionarPropuestas
from fuente.aplicacion.consultas import ConsultarAnalitica
from fuente.aplicacion.herramientas import GobiernoHerramientas
from fuente.aplicacion.ingesta import IngerirEventos
from fuente.aplicacion.notificaciones import GestionarNotificaciones
from fuente.aplicacion.reportes import GenerarReporte
from fuente.aplicacion.tallas import RecomendarTalla
from fuente.infraestructura.analitica import RepositorioPostgres
from fuente.infraestructura.aprendizaje import AgrupadorKMeans, ModeloTallasLogistico
from fuente.infraestructura.configuracion import Configuracion
from fuente.infraestructura.herramientas_mcp import HerramientasMcp
from fuente.infraestructura.identidad import VerificadorTokens
from fuente.infraestructura.ollama import ModeloOllama
from fuente.infraestructura.servicios_rest import (CatalogoInventario, DirectorioClientesRest, EventosRest, InventarioGestionRest, InventarioRest, PerfilesRest,
                                                   TokenDeServicio)
from fuente.infraestructura.voz import TranscriptorWhisper
from fuente.puertos import rest
from fuente.puertos.graphql import esquema_gestion
from fuente.puertos.mcp import AutenticacionMcp, crear_servidor_mcp

registro = logging.getLogger("clb.ia")


def crear_aplicacion(configuracion: Configuracion | None = None, **reemplazos) -> FastAPI:
    """`reemplazos` permite a las pruebas sustituir adaptadores externos (LLM, identidad, transcriptor)."""
    c = configuracion or Configuracion()
    http = httpx.AsyncClient(timeout=15)
    repositorio = reemplazos.get("repositorio") or RepositorioPostgres(c.conexion, c.analitica_esquema)
    token = TokenDeServicio(http, c.token_url, c.identidad_secreto)
    residencia = os.environ.get('CLB_IA_MODELO_RESIDENCIA', '30m')
    llm = reemplazos.get("llm") or ModeloOllama(http, c.ollama_url, c.modelo,
        residencia=-1 if residencia == '-1' else residencia,
        contexto=int(os.environ.get('CLB_IA_MODELO_CONTEXTO', '4096')))
    herramientas = HerramientasMcp(c.mcp_url)
    consultas = ConsultarAnalitica(repositorio, AgrupadorKMeans())
    modelo_tallas = ModeloTallasLogistico()
    servicios = SimpleNamespace(
        repositorio=repositorio, consultas=consultas, llm=llm, modelo_tallas=modelo_tallas,
        ingesta=IngerirEventos(repositorio, EventosRest(http, c.ventas_url, token), EventosRest(http, c.inventario_url, token),
                               CatalogoInventario(http, c.inventario_url), copia_cada=5,
                               directorio=DirectorioClientesRest(http, c.clientes_url, token)),
        reportes=GenerarReporte(llm, herramientas, repositorio),
        mision=EjecutarMision(llm, herramientas, repositorio),
        propuestas=GestionarPropuestas(repositorio, InventarioRest(http, c.inventario_url)),
        notificaciones=GestionarNotificaciones(repositorio),
        inventario_gestion=reemplazos.get("inventario_gestion") or InventarioGestionRest(http, c.inventario_url),
        tallas=RecomendarTalla(modelo_tallas, PerfilesRest(http, c.clientes_url)),
        transcriptor=reemplazos.get("transcriptor") or TranscriptorWhisper(c.modelo_voz, c.directorio_modelos))
    verificador = reemplazos.get("verificador") or VerificadorTokens(c.jwks, c.identidad_emisor)
    servidor_mcp = crear_servidor_mcp(consultas, GobiernoHerramientas(repositorio))

    async def ingerir_periodicamente():
        while True:
            try:
                await servicios.ingesta.ejecutar()
            except Exception:  # nunca debe detener el servicio; el siguiente ciclo reintenta desde el cursor
                registro.exception("Ciclo de ingesta fallido")
            await asyncio.sleep(c.intervalo_ingesta)

    @contextlib.asynccontextmanager
    async def vida(_app: FastAPI):
        await repositorio.abrir()
        tarea = asyncio.create_task(ingerir_periodicamente()) if c.intervalo_ingesta > 0 else None
        try:
            async with servidor_mcp.session_manager.run():
                yield
        finally:
            if tarea:
                tarea.cancel()
            await http.aclose()
            await repositorio.cerrar()

    app = FastAPI(title="CLB Store — Inteligencia Artificial", version="1.0.0", lifespan=vida, docs_url=None, redoc_url=None)
    app.state.servicios, app.state.verificador = servicios, verificador
    rest.registrar_errores(app)
    app.include_router(rest.api)

    async def contexto_graphql(usuario: rest.Admin):
        return {"consultas": consultas, "usuario": usuario, "servicios": servicios, "trabajo_llm": rest.TRABAJO_LLM}

    # Gestión empresarial: el rol admin se exige antes de ejecutar cualquier operación (401/403 como en REST).
    app.include_router(GraphQLRouter(esquema_gestion, context_getter=contexto_graphql, graphql_ide=None, allow_queries_via_get=False),
                       prefix="/api/v1/graphql")
    # Solo para los agentes, por la red interna; la pasarela no lo publica.
    app.mount("/mcp", AutenticacionMcp(servidor_mcp.streamable_http_app(streamable_http_path="/", stateless_http=True,
                                                                         json_response=True), verificador))

    @app.get("/salud")
    async def salud(request: Request):
        postgres = await repositorio.disponible()
        ollama = await llm.disponible() if hasattr(llm, "disponible") else True
        cuerpo = {"estado": "ACTIVO" if postgres else "DEGRADADO", "servicio": "inteligencia-artificial",
                  "dependencias": {"postgresql": "ACTIVO" if postgres else "NO_DISPONIBLE",
                                   "ollama": "ACTIVO" if ollama else "NO_DISPONIBLE (respuestas no generativas)"},
                  "ingesta": servicios.ingesta.estado, "modelo": c.modelo}
        return JSONResponse(cuerpo, 200 if postgres else 503)

    return app


def app_desde_entorno() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # la ingesta consulta cada 20 s: solo se registran fallas
    return crear_aplicacion()
