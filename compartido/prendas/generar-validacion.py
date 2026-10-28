"""Fixtures procedurales reproducibles: no son fotografías reales ni datos de entrenamiento."""

import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RAIZ = Path(__file__).resolve().parent / "validacion"
RAIZ.mkdir(exist_ok=True)
ANCHO, ALTO = 512, 640


def prenda(indice):
    azar = random.Random(20261023 + indice)
    izquierda = 146 + azar.randrange(-9, 10)
    derecha = 512 - izquierda
    superior = 92 + azar.randrange(-6, 7)
    inferior = 574 + azar.randrange(-10, 11)
    puntos = [
        (izquierda, superior),
        (214, superior),
        (225, superior + 25),
        (245, superior + 44),
        (267, superior + 44),
        (287, superior + 25),
        (298, superior),
        (derecha, superior),
        (464, 218),
        (401, 274),
        (derecha, 226),
        (derecha - 5, inferior),
        (izquierda + 5, inferior),
        (izquierda, 226),
        (111, 274),
        (48, 218),
    ]
    mascara = Image.new("L", (ANCHO * 2, ALTO * 2))
    ImageDraw.Draw(mascara).polygon([(x * 2, y * 2) for x, y in puntos], fill=255)
    mascara = mascara.resize((ANCHO, ALTO), Image.Resampling.LANCZOS)
    colores = [(175, 30, 40), (30, 65, 145), (40, 110, 70), (45, 45, 50), (220, 205, 175), (125, 45, 120)]
    base = colores[indice % len(colores)]
    y, x = np.mgrid[:ALTO, :ANCHO]
    textura = np.zeros((ALTO, ANCHO, 3), dtype=np.float32)
    # Variación suave de tejido y pliegues; sin usar imágenes de terceros.
    luz = 1 + 0.06 * np.sin(x / 23) + 0.025 * np.cos(y / 19)
    if indice % 3 == 1:
        luz += 0.10 * ((y // 18) % 2)
    for canal, color in enumerate(base):
        textura[:, :, canal] = color * luz
    tejido = Image.fromarray(np.uint8(np.clip(textura, 0, 255))).convert("RGBA")
    tejido.putalpha(mascara)
    fondo = Image.new("RGBA", (ANCHO, ALTO), (245, 245, 243, 255) if indice < 6 else (220, 225, 228, 255))
    sombra = Image.new("RGBA", fondo.size, (80, 80, 80, 0))
    sombra.putalpha(mascara.filter(ImageFilter.GaussianBlur(5)).point(lambda a: int(a * 0.10)))
    fondo.alpha_composite(sombra)
    fondo.alpha_composite(tejido)
    return (
        fondo.convert("RGB"),
        mascara,
        {"hombro_izquierdo": [izquierda, superior], "hombro_derecho": [derecha, superior], "borde_inferior": inferior},
    )


casos = []
for indice in range(12):
    imagen, mascara, anclas = prenda(indice)
    nombre = f"valida-{indice + 1:02}"
    imagen.save(RAIZ / (nombre + ".png"))
    mascara.save(RAIZ / (nombre + "-mascara.png"))
    casos.append(
        {
            "id": nombre,
            "archivo": nombre + ".png",
            "mascara": nombre + "-mascara.png",
            "valida": True,
            "anclas_pixeles": anclas,
        }
    )

base, _, _ = prenda(0)
cortada = base.crop((100, 40, 412, 480))
cortada.save(RAIZ / "invalida-cortada.png")
maniqui = base.copy()
d = ImageDraw.Draw(maniqui)
d.rectangle((220, 45, 292, 136), fill=(180, 160, 135))
d.ellipse((184, 5, 328, 110), fill=(185, 165, 140))
maniqui.save(RAIZ / "invalida-maniqui.png")
multiple = Image.new("RGB", (ANCHO, ALTO), "white")
mini = base.resize((230, 350))
multiple.paste(mini, (5, 140))
multiple.paste(mini, (277, 140))
multiple.save(RAIZ / "invalida-multiples.png")
Image.new("RGB", (ANCHO, ALTO), (250, 250, 250)).save(RAIZ / "invalida-contraste.png")
for nombre in ["cortada", "maniqui", "multiples", "contraste"]:
    casos.append({"id": "invalida-" + nombre, "archivo": "invalida-" + nombre + ".png", "valida": False})
(RAIZ / "manifiesto.json").write_text(
    json.dumps(
        {
            "origen": "sintetico-programatico",
            "semilla": 20261023,
            "alcance": "12 variantes procedurales de silueta frontal, 4 entradas inválidas; NO demuestra generalización a fotos reales",
            "generador": "compartido/prendas/generar-validacion.py",
            "casos": casos,
        },
        ensure_ascii=False,
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)
print("Generados 16 fixtures sintéticos y 12 máscaras de referencia.")
