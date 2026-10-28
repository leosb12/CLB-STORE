"""Cliente MCP real (HTTP streamable) que usan los agentes. Envía el token del administrador y el nombre del agente:
el servidor valida ambos y vuelve a aplicar la lista blanca."""
import json
from contextlib import asynccontextmanager

import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError as McpError

from fuente.aplicacion.interfaces import RechazoDeServicio, ServicioNoDisponible


class SesionMcp:
    def __init__(self, cliente: Client):
        self.cliente = cliente

    async def listar(self) -> list[dict]:
        return [{"nombre": h.name, "descripcion": h.description or "", "esquema": h.input_schema}
                for h in (await self.cliente.list_tools()).tools]

    async def llamar(self, nombre: str, argumentos: dict):
        resultado = await self.cliente.call_tool(nombre, argumentos)
        texto = resultado.content[0].text if resultado.content else ""
        if resultado.is_error:
            raise RechazoDeServicio(422, {"mensaje": texto[:300]})
        return json.loads(texto) if texto else {}


class HerramientasMcp:
    def __init__(self, url: str):
        self.url = url

    @asynccontextmanager
    async def sesion(self, agente: str, token: str):
        http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}", "X-Clb-Agente": agente}, timeout=60)
        try:
            async with http, Client(streamable_http_client(self.url, http_client=http)) as cliente:
                yield SesionMcp(cliente)
        except BaseExceptionGroup as grupo:
            # Los task groups de anyio envuelven cualquier excepción (también las del propio caso de uso): se relanza
            # la hoja, traduciendo las de red o protocolo a «servicio no disponible».
            raise _hoja(grupo) from grupo
        except (httpx2.HTTPError, OSError, McpError) as error:
            raise ServicioNoDisponible(f"servidor MCP ({type(error).__name__})") from error


def _hoja(error: BaseException) -> BaseException:
    while isinstance(error, BaseExceptionGroup) and error.exceptions:
        error = error.exceptions[0]
    if isinstance(error, (httpx2.HTTPError, OSError, McpError)):
        return ServicioNoDisponible(f"servidor MCP ({type(error).__name__})")
    return error
