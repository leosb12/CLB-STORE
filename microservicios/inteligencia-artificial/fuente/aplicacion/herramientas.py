"""Reglas de las herramientas MCP, fuera del puerto: lista blanca por agente, auditoría y la única escritura (proponer).

El servidor MCP (puerto) solo traduce: valida tipos, ejecuta su consulta GraphQL fija y delega aquí la decisión.
"""
import json
import uuid
from typing import Awaitable, Callable

from fuente.aplicacion.interfaces import RepositorioAnalitica
from fuente.dominio.agentes import autorizada


class HerramientaRechazada(Exception):
    pass


class GobiernoHerramientas:
    def __init__(self, repositorio: RepositorioAnalitica):
        self.repositorio = repositorio

    async def ejecutar(self, agente: str, usuario: str, herramienta: str, argumentos: dict, accion: Callable[[], Awaitable[dict]]) -> dict:
        if not autorizada(agente, herramienta):
            await self.repositorio.auditar(usuario, agente, herramienta, argumentos, False, "fuera de la lista blanca")
            raise HerramientaRechazada(f"La herramienta {herramienta} no está permitida para el agente {agente}.")
        try:
            resultado = await accion()
        except Exception as error:  # también se audita una falla técnica, no solo los rechazos
            await self.repositorio.auditar(usuario, agente, herramienta, argumentos, True, f"error: {type(error).__name__}: {error}")
            raise
        await self.repositorio.auditar(usuario, agente, herramienta, argumentos, True, _resumen(resultado))
        return resultado

    async def proponer_reposicion(self, variante: str, cantidad: int, motivo: str, usuario: str) -> dict:
        existente = await self.repositorio.variante(variante)
        if existente is None:
            raise HerramientaRechazada("La variante no existe o no está activa.")
        propuesta = {"identificador": str(uuid.uuid4()), "variante": variante, "sku": existente["sku"], "cantidad": cantidad,
                     "motivo": motivo, "usuario": usuario}
        # Una sola propuesta abierta por variante: un texto inyectado no puede llenar el panel de propuestas.
        if not await self.repositorio.guardar_propuesta(propuesta):
            raise HerramientaRechazada(f"Ya hay una propuesta abierta para {existente['sku']}.")
        return {**propuesta, "estado": "PENDIENTE", "requiere_confirmacion": True,
                "disponible": existente["disponible"], "minimo": existente["minimo"]}


def _resumen(resultado) -> str:
    return json.dumps(resultado, ensure_ascii=False, default=str)[:300]
