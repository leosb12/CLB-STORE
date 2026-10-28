"""Caso de uso de las notificaciones operativas que registra la automatización (n8n) y atiende el administrador."""
from fuente.aplicacion.interfaces import RepositorioAnalitica
from fuente.dominio.notificaciones import EstadoNotificacion, NotificacionStockBajo


class NotificacionInexistente(LookupError):
    pass


class GestionarNotificaciones:
    def __init__(self, repositorio: RepositorioAnalitica):
        self.repositorio = repositorio

    async def registrar(self, notificacion: NotificacionStockBajo, origen: str) -> tuple[dict, bool]:
        """Idempotente por evento: si n8n reintenta (o reprocesa tras caerse) devuelve la existente sin duplicarla."""
        nueva = await self.repositorio.guardar_notificacion({**notificacion.model_dump(mode="json"), "mensaje": notificacion.mensaje(),
                                                            "origen": origen})
        return await self.repositorio.notificacion(str(notificacion.evento)), nueva

    async def listar(self, estado: EstadoNotificacion | None) -> list[dict]:
        return await self.repositorio.notificaciones(estado)

    async def atender(self, evento: str, usuario: str) -> dict:
        """Atender dos veces no cambia quién ni cuándo la atendió primero."""
        await self.repositorio.atender_notificacion(evento, usuario)
        notificacion = await self.repositorio.notificacion(evento)
        if notificacion is None:
            raise NotificacionInexistente(evento)
        return notificacion
