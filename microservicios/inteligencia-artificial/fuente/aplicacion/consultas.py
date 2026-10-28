"""Consultas del sistema de gestión empresarial sobre el modelo de lectura. GraphQL las expone; nada más las usa."""
import asyncio
import statistics
from datetime import datetime, timezone

from fuente.aplicacion.interfaces import Agrupador, RepositorioAnalitica
from fuente.dominio import segmentos
from fuente.dominio.reportes import Agrupacion, Metrica, Periodo, inicio_periodo


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class ConsultarAnalitica:
    def __init__(self, repositorio: RepositorioAnalitica, agrupador: Agrupador, reloj=_ahora):
        self.repositorio, self.agrupador, self.reloj = repositorio, agrupador, reloj

    async def resumen_ventas(self, periodo: Periodo, agrupar_por: Agrupacion | None, limite: int, metrica: Metrica = "UNIDADES") -> dict:
        resumen = await self.repositorio.resumen_ventas(inicio_periodo(periodo, self.reloj()), agrupar_por, limite, metrica)
        return {**resumen, "periodo": periodo, "agrupar_por": agrupar_por, "datos_al": await self._datos_al("ventas")}

    async def productos(self, limite: int) -> list[dict]:
        return await self.repositorio.productos(limite)

    async def stock_bajo(self) -> list[dict]:
        return await self.repositorio.stock_bajo()

    async def alertas(self, limite: int) -> list[dict]:
        return await self.repositorio.alertas(limite)

    async def datos_al(self) -> dict[str, datetime]:
        return await self.repositorio.frescura()

    async def segmentos(self) -> dict:
        """K-Means sobre recencia, frecuencia, gasto y diversidad de categorías de cada cliente, sin etiquetas previas."""
        clientes = await self.repositorio.compras_por_cliente(self.reloj())
        resultado = {"clientes": len(clientes), "silueta": None, "segmentos": [], "datos_al": await self._datos_al("ventas")}
        if len(clientes) < 3:
            return resultado
        filas = [[c[x] for x in segmentos.CARACTERISTICAS] for c in clientes]
        # K-Means y la silueta son CPU: en un hilo para no congelar la ingesta, el MCP ni /salud.
        etiquetas, centroides, silueta = await asyncio.to_thread(self.agrupador.agrupar, filas)
        medianas = {x: statistics.median(f[i] for f in filas) for i, x in enumerate(segmentos.CARACTERISTICAS)}
        for grupo, centro in enumerate(centroides):
            centroide = dict(zip(segmentos.CARACTERISTICAS, centro))
            nombre, descripcion = segmentos.describir(centroide, medianas)
            if any(s["nombre"] == nombre for s in resultado["segmentos"]):
                nombre += f" ({grupo + 1})"  # dos grupos con el mismo perfil: se distinguen por número
            # Solo el tamaño del grupo: los identificadores de clientes no salen del modelo de lectura.
            resultado["segmentos"].append({"grupo": grupo, "nombre": nombre, "descripcion": descripcion,
                                           "clientes": etiquetas.count(grupo), "centroide": centroide})
        resultado["silueta"] = silueta
        resultado["segmentos"].sort(key=lambda s: -s["clientes"])
        return resultado

    # Lecturas del panel (historial, propuestas, auditoría): los puertos no tocan el repositorio directamente.
    async def reportes(self, limite: int) -> list[dict]:
        return await self.repositorio.reportes(limite)

    async def reporte(self, identificador: str) -> dict | None:
        return await self.repositorio.reporte(identificador)

    async def propuestas(self, estado: str | None) -> list[dict]:
        return await self.repositorio.propuestas(estado)

    async def auditoria(self, limite: int) -> list[dict]:
        return await self.repositorio.auditoria(limite)

    async def _datos_al(self, fuente: str) -> datetime | None:
        return (await self.repositorio.frescura()).get(fuente)
