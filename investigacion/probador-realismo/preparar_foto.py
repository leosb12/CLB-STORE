"""Prepara fixture pública ya descargada; nunca descarga durante la inferencia."""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

p = Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
fixture = Path(__file__).resolve().parent / "fixtures/persona-base.jpg"
procedencia = json.loads(
    (fixture.parent / "procedencia.json").read_text(encoding="utf-8")
)
if hashlib.sha256(fixture.read_bytes()).hexdigest() != procedencia["sha256"]:
    raise ValueError("La fotografía no coincide con la fixture pública documentada")
foto = Image.open(fixture).convert("RGB")
foto.save(p / "persona-entrada.png")
np.asarray(foto.resize((256, 256), Image.Resampling.BILINEAR)).tofile(p / "foto-rgb.u8")
lado = max(foto.size)
cuadrado = Image.new("RGB", (lado, lado))
cuadrado.paste(foto, (0, 0))
np.asarray(cuadrado.resize((192, 192), Image.Resampling.BILINEAR)).tofile(
    p / "pose-rgb.u8"
)
