"""Notificaciones operativas: avisos accionables que crea la automatización (n8n) y que una persona atiende en el panel.

No son datos para reportes (eso es `alertas_stock`, que la ingesta copia del registro de Inventario): tienen ciclo de vida
NUEVA → ATENDIDA y llevan la variante ya enriquecida (producto, talla, color) para actuar sin buscar nada más.
"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EstadoNotificacion = Literal["NUEVA", "ATENDIDA"]

# Sin caracteres de control ni marcado: el texto viene de otro servicio y se muestra en el panel.
TEXTO = r"^[^\x00-\x1f<>{}]*$"


class NotificacionStockBajo(BaseModel):
    """Lo que envía el flujo A de n8n; el identificador del evento de Inventario la hace idempotente."""
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    evento: UUID
    tipo: Literal["stock_bajo"]
    variante: UUID
    producto: str = Field(min_length=1, max_length=160, pattern=TEXTO)
    sku: str = Field(min_length=1, max_length=64, pattern=TEXTO)
    talla: str = Field(min_length=1, max_length=32, pattern=TEXTO)
    color: str = Field(min_length=1, max_length=80, pattern=TEXTO)
    disponible: int = Field(ge=0, le=1_000_000_000)
    minimo: int = Field(ge=0, le=1_000_000_000)
    fecha_evento: datetime

    def mensaje(self) -> str:
        unidades = "unidad" if self.disponible == 1 else "unidades"
        return (f"{self.producto} ({self.talla}, {self.color}) bajó a {self.disponible} {unidades}; "
                f"el mínimo es {self.minimo}. Conviene reponer.")
