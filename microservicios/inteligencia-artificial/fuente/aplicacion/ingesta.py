"""Ingesta del modelo de lectura (CQRS, D3): eventos de Ventas e Inventario por REST con cursor, más la copia de existencias.

Nunca lee bases ajenas ni depende de n8n. Cada lote se aplica en una transacción junto con su cursor y cada evento se
registra por su identificador, así que repetir un lote (caída a mitad, cursor reiniciado) no duplica nada.
"""
import logging

from fuente.aplicacion.interfaces import Catalogo, CursorFueraDeRango, FuenteEventos, RepositorioAnalitica

registro = logging.getLogger("clb.ia.ingesta")


class IngerirEventos:
    def __init__(self, repositorio: RepositorioAnalitica, ventas: FuenteEventos, inventario: FuenteEventos, catalogo: Catalogo,
                 copia_cada: int = 1):
        self.repositorio = repositorio
        self.fuentes = {"ventas": (ventas, repositorio.aplicar_eventos_ventas),
                        "inventario": (inventario, repositorio.aplicar_eventos_inventario)}
        self.catalogo = catalogo
        self.estado: dict[str, str] = {}
        # Los eventos son baratos (cursor); la copia de existencias recorre el catálogo: se hace cada «copia_cada» ciclos.
        self.copia_cada, self.ciclo = copia_cada, 0

    async def ejecutar(self) -> dict[str, str]:
        for nombre, (fuente, aplicar) in self.fuentes.items():
            try:
                aplicados = await self._consumir(nombre, fuente, aplicar)
                await self.repositorio.marcar_al_dia(nombre)
                self.estado[nombre] = "AL_DIA"
                if aplicados:
                    registro.info("%s: %d eventos nuevos", nombre, aplicados)
            except Exception as error:  # una fuente caída no detiene a las demás; se reintenta en el próximo ciclo
                self.estado[nombre] = f"ERROR: {type(error).__name__}"
                registro.warning("%s: %s", nombre, error)
        self.ciclo += 1
        if (self.ciclo - 1) % self.copia_cada:
            return dict(self.estado)
        try:
            await self.repositorio.reemplazar_existencias(await self.catalogo.variantes())
            await self.repositorio.marcar_al_dia("existencias")
            self.estado["existencias"] = "AL_DIA"
        except Exception as error:
            self.estado["existencias"] = f"ERROR: {type(error).__name__}"
            registro.warning("existencias: %s", error)
        return dict(self.estado)

    async def _consumir(self, nombre, fuente: FuenteEventos, aplicar) -> int:
        aplicados, reiniciado = 0, False
        while True:
            desde = await self.repositorio.posicion(nombre)
            try:
                eventos, siguiente = await fuente.eventos(desde)
            except CursorFueraDeRango:
                if reiniciado:
                    raise
                await self.repositorio.reiniciar(nombre)
                reiniciado = True
                continue
            if not eventos:
                return aplicados
            aplicados += await aplicar(eventos, siguiente)
