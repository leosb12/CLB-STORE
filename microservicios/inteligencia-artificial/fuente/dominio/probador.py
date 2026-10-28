"""Contratos del probador fotográfico; independientes de CUDA, HTTP y persistencia."""
from typing import Protocol


class ErrorProbador(Exception):
    def __init__(self, codigo: str, mensaje: str, estado: int = 422):
        super().__init__(mensaje)
        self.codigo, self.estado = codigo, estado


class MotorProbador(Protocol):
    def generar(self, persona: bytes, prenda: bytes, categoria: str, semilla: int) -> bytes: ...


class RepositorioTrabajos(Protocol):
    """Estados y resultados privados; `transaccion()` serializa las reservas de la cola."""
    def recuperar_interrumpidos(self) -> None: ...
    def transaccion(self): ...
    def obtener(self, clave: str, titular: str) -> tuple | None: ...
    def marcar(self, clave: str, creado: float, estado: str, codigo: str | None = None, mensaje: str | None = None) -> bool: ...
    def guardar_resultado(self, clave: str, creado: float, datos: bytes) -> bool: ...
    def leer_resultado(self, clave: str) -> bytes: ...
    def eliminar(self, titular: str, clave: str | None = None) -> None: ...
    def purgar_vencidos(self, limite: float) -> None: ...


ACTIVOS = ("PENDIENTE", "PROCESANDO")
# Fallos del servidor, no de la foto: el cliente conserva la solicitud y reintenta con la misma clave.
CODIGOS_REINTENTABLES = frozenset({
    "TRABAJO_INTERRUMPIDO", "GPU_SIN_MEMORIA", "GPU_NO_DISPONIBLE", "WORKER_NO_DISPONIBLE", "MOTOR_NO_PREPARADO",
    "TIEMPO_AGOTADO", "INFERENCIA_FALLIDA", "GENERACION_FALLIDA", "RESULTADO_NO_DISPONIBLE",
})


def categoria_vton(categoria: str) -> str:
    normalizada = categoria.strip().lower()
    grupos = {
        "upper": ("upper", "polera", "poleras", "camisa", "camisas", "chaqueta", "chaquetas", "suéter", "sueter", "suéteres", "sueteres", "abrigo", "abrigos", "superior", "camiseta", "camisetas",
                  "buzo", "buzos", "polerón", "poleron", "polerones"),
        "lower": ("lower", "pantalón", "pantalones", "pantalon", "jean", "jeans", "falda", "faldas", "inferior", "short", "shorts"),
        "overall": ("overall", "vestido", "vestidos", "enterizo", "cuerpo completo"),
    }
    for grupo, nombres in grupos.items():
        if normalizada in nombres:
            return grupo
    raise ErrorProbador("CATEGORIA_NO_ADMITIDA", "Selecciona una prenda superior, inferior o de cuerpo completo.")
