"""Caso de uso CLEAR. La segmentación y la geometría son puertos de salida."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class PrendaPreparada:
    textura: bytes
    maestro: bytes
    metadatos: dict
    evidencia: dict | None = None
    # Espalda deducida del modelo 3D (PNG 768×1024); None si la silueta no permitió construirlo.
    espalda: bytes | None = None


class PreparadorFotografico(Protocol):
    def preparar(self, original: bytes) -> PrendaPreparada: ...
    def preparar_generativa(self, original: bytes, categoria: str) -> PrendaPreparada: ...


class PrepararPrenda:
    def __init__(self, preparador: PreparadorFotografico):
        self.preparador = preparador

    def ejecutar(self, original: bytes, categoria: str) -> PrendaPreparada:
        from fuente.dominio.prendas import PrendaNoPreparada
        from fuente.dominio.probador import categoria_vton, ErrorProbador
        try:
            etiqueta = categoria_vton(categoria)
        except ErrorProbador as error:
            raise PrendaNoPreparada(str(error)) from error
        # Las altas nuevas alimentan CatVTON: ninguna categoría necesita anclas 2D.
        # Los recursos de esquema 1 ya publicados conservan su compatibilidad local.
        return self.preparador.preparar_generativa(original, etiqueta)
