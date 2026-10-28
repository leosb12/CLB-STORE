"""Integridad del único modelo admitido por este laboratorio."""

import hashlib
from pathlib import Path

SHA256_MODELO = "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"


def leer_modelo(carpeta: Path) -> bytes:
    datos = (carpeta / "selfie_multiclass_256x256.tflite").read_bytes()
    if hashlib.sha256(datos).hexdigest() != SHA256_MODELO:
        raise ValueError(
            "El modelo semántico no coincide con la versión oficial fijada."
        )
    return datos
