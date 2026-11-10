"""Casos de uso del tablero. No calculan KPI: piden a IA los mismos bloques que usan los reportes y los agentes."""
from collections.abc import Callable
from typing import Protocol

from fuente.adaptadores.ia import SesionVencida
from fuente.dominio.tablero import Filtros


# Lo que se puede descargar del dataset sintético: la vista completa (una fila por línea de venta) o cada tabla.
DESCARGAS = ("completo", "clientes", "pedidos", "lineas_venta", "existencias")


class ServicioIA(Protocol):
    def indicadores(self, variables: dict, token: str) -> dict: ...
    def generar_reporte(self, especificacion: dict, token: str) -> dict: ...
    def dataset_csv(self, nombre: str, token: str) -> tuple[bytes, str]: ...
    def modelo_tallas(self) -> dict: ...
    def recomendar_talla(self, medidas: dict) -> dict: ...


class Tablero:
    def __init__(self, ia: ServicioIA, token: Callable[[], str | None]):
        self.ia, self._token = ia, token

    def _vigente(self) -> str:
        token = self._token()
        if not token:
            raise SesionVencida()
        return token

    def indicadores(self, filtros: Filtros) -> dict:
        return self.ia.indicadores(filtros.variables(), self._vigente())

    def generar_reporte(self, especificaciones: dict) -> dict:
        """El reporte reutiliza TAL CUAL la especificación del bloque mensual (conjunto, periodo y filtros incluidos):
        en Gestión se verán las mismas cifras, con Excel y PDF."""
        spec = {**especificaciones["mensual"], "titulo": "Evolución mensual (demostración)",
                "grafico": {"tipo": "LINEAS", "eje": "MES", "valor": "MONTO"}}
        return self.ia.generar_reporte(spec, self._vigente())

    def descargar_dataset(self, nombre: str) -> tuple[bytes, str]:
        if nombre not in DESCARGAS:
            raise ValueError("Descarga desconocida.")
        return self.ia.dataset_csv(nombre, self._vigente())

    def modelo_tallas(self) -> dict:
        return self.ia.modelo_tallas()

    def recomendar_talla(self, medidas: dict) -> dict:
        return self.ia.recomendar_talla(medidas)
