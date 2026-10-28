"""Prototipo de material: conserva silueta/luz de una camiseta base neutra.

No reconstruye una prenda ni simula su talla. Sin retoques manuales de máscara.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def filtro_guiado(guia, mascara, radio=7, epsilon=0.001):
    def media(x):
        return cv2.boxFilter(x, -1, (radio * 2 + 1,) * 2)

    g = guia.astype(np.float32)
    p = mascara.astype(np.float32)
    mg, mp = media(g), media(p)
    a = (media(g * p) - mg * mp) / (media(g * g) - mg * mg + epsilon)
    return np.clip(media(a) * g + media(mp - a * mg), 0, 1)


def componer(foto, textura, probabilidades, pose):
    if foto.ndim != 3 or foto.shape[2] != 3 or foto.dtype != np.uint8:
        raise ValueError("Foto RGB uint8 requerida")
    if textura.ndim != 3 or textura.shape[2] != 4 or textura.dtype != np.uint8:
        raise ValueError("Textura RGBA uint8 requerida")
    if probabilidades.shape != (256, 256, 6) or not np.isfinite(probabilidades).all():
        raise ValueError("Máscara semántica inválida")
    if len(pose) != 17 or any(len(punto) != 3 for punto in pose):
        raise ValueError("Pose incompleta")
    if not np.isfinite(pose).all():
        raise ValueError("Pose inválida")
    if any(pose[i][2] < 0.35 for i in [5, 6, 11, 12]):
        raise ValueError("Se necesitan hombros y caderas visibles")
    h, w = foto.shape[:2]
    if max(h, w) > 2048:
        raise ValueError("Reducir la foto a un lado máximo de 2048 píxeles")
    lado = max(w, h)
    puntos = np.array(pose)[:, [1, 0]] * lado
    hombros = puntos[[5, 6]]
    caderas = puntos[[11, 12]]
    arriba, abajo = hombros[:, 1].mean(), caderas[:, 1].mean()
    izquierda, derecha = sorted(hombros[:, 0])
    if abajo - arriba < h * 0.15 or derecha - izquierda < w * 0.15:
        raise ValueError("Torso demasiado pequeño o pose inválida")
    if not (0 <= arriba < abajo < h and 0 <= izquierda < derecha < w):
        raise ValueError("Torso fuera de la fotografía")
    # Color de referencia automático del centro del pecho, alejado de cuello/piel.
    zona = foto[
        round(arriba + 0.18 * (abajo - arriba)) : round(
            arriba + 0.45 * (abajo - arriba)
        ),
        round(izquierda + 0.2 * (derecha - izquierda)) : round(
            derecha - 0.2 * (derecha - izquierda)
        ),
    ]
    base = np.median(zona.reshape(-1, 3), axis=0)
    if base.min() < 150 or base.max() - base.min() > 35:
        raise ValueError("Se necesita camiseta base clara y neutra")
    rgb = foto.astype(np.float32) / 255
    luz = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    prob = cv2.resize(probabilidades[:, :, 4], (w, h), interpolation=cv2.INTER_LINEAR)
    piel = cv2.resize(
        probabilidades[:, :, 2] + probabilidades[:, :, 3] + probabilidades[:, :, 1],
        (w, h),
        interpolation=cv2.INTER_LINEAR,
    )
    # Impide que pantalón y otros objetos de la categoría genérica 'ropa' entren.
    neutro = np.clip((luz - 0.30) / 0.24, 0, 1)
    semilla = prob * neutro
    semilla[: max(0, round(arriba - 0.20 * (abajo - arriba)))] = 0
    semilla[min(h, round(abajo + 0.10 * (abajo - arriba))) :] = 0
    cantidad, etiquetas, estadisticas, _ = cv2.connectedComponentsWithStats(
        (semilla > 0.5).astype(np.uint8)
    )
    if cantidad < 2:
        raise ValueError("No se identificó camiseta base")
    componente = 1 + estadisticas[1:, cv2.CC_STAT_AREA].argmax()
    soporte = cv2.dilate(
        (etiquetas == componente).astype(np.uint8), np.ones((9, 9), np.uint8)
    )
    mascara = filtro_guiado(luz, semilla * soporte)
    mascara *= np.clip((0.8 - piel) / 0.4, 0, 1)
    mascara = np.clip((mascara - 0.08) / 0.84, 0, 1)
    # El campo UV sigue la anchura real por filas: conserva el borde de la camiseta.
    yy, xx = np.indices((h, w), dtype=np.float32)
    perfiles = []
    for fila in mascara > 0.5:
        xs = np.flatnonzero(fila)
        perfiles.append((xs[0], xs[-1]) if len(xs) else (izquierda, derecha))
    perfiles = np.asarray(perfiles, np.float32)
    ys = np.flatnonzero((mascara > 0.5).any(axis=1))
    if len(ys) < (abajo - arriba) * 0.5:
        raise ValueError("Máscara de camiseta insuficiente")
    v = np.clip((yy - ys[0]) / max(1, ys[-1] - ys[0]), 0, 1)
    # Las mangas NO amplían el campo UV del pecho: evita saltos y estampado roto.
    tronco = perfiles[
        round(arriba + 0.4 * (abajo - arriba)) : round(arriba + 0.8 * (abajo - arriba))
    ]
    bordes = np.median(tronco, axis=0)
    u = np.clip((xx - bordes[0]) / max(1, bordes[1] - bordes[0]), 0, 1)
    th, tw = textura.shape[:2]
    # Interior del torso de la foto aislada; excluye transparencia, cuello y mangas.
    tx = (0.27 + 0.46 * u) * (tw - 1)
    ty = (0.20 + 0.64 * v) * (th - 1)
    tela = cv2.remap(
        textura[:, :, :3].astype(np.float32) / 255,
        tx.astype(np.float32),
        ty.astype(np.float32),
        cv2.INTER_LINEAR,
    )
    alfa = cv2.remap(
        textura[:, :, 3].astype(np.float32) / 255,
        tx.astype(np.float32),
        ty.astype(np.float32),
        cv2.INTER_LINEAR,
    )
    if (alfa[mascara > 0.8] < 0.95).mean() > 0.01:
        raise ValueError(
            "Textura de torso insuficiente; no rellenar transparencia inventando producto"
        )
    # Descomposición limitada de la fotografía del producto para evitar doble luz.
    tela = cv2.GaussianBlur(tela, (0, 0), 0.8)
    luminancia = tela @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    iluminacion = cv2.GaussianBlur(luminancia, (0, 0), 12)
    fondo = float(np.median(luminancia[mascara > 0.8]))
    detalle = luminancia - iluminacion
    luz_material = fondo + detalle * 0.45
    tinta = np.clip((fondo - cv2.GaussianBlur(luminancia, (0, 0), 3) - 0.4) / 0.1, 0, 1)
    luz_material = luz_material * (1 - tinta) + luminancia * tinta
    color_base = np.median(tela[mascara > 0.8], axis=0)
    c = tela / np.maximum(luminancia[:, :, None], 0.05)
    cbase = color_base / max(
        float(color_base @ np.array([0.2126, 0.7152, 0.0722])), 0.05
    )
    estampado = np.clip((np.max(np.abs(c - cbase), axis=2) - 0.06) / 0.12, 0, 1)
    c = cbase + (c - cbase) * (0.25 + 0.75 * estampado[:, :, None])
    luz_material = luz_material * (1 - estampado) + luminancia * estampado
    tela = np.clip(c * luz_material[:, :, None], 0, 1)
    distancia = np.maximum(bordes[0] - xx, xx - bordes[1])
    transicion = np.clip(distancia / max(1, 0.08 * (bordes[1] - bordes[0])), 0, 1)
    color_tela = np.median(tela[mascara > 0.8], axis=0)
    tela = tela * (1 - transicion[:, :, None]) + color_tela * transicion[:, :, None]
    # Multiplicación en espacio lineal: sombras y pliegues vienen de la foto base.
    lineal = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    srgb = lambda c: np.where(
        c <= 0.0031308, c * 12.92, 1.055 * np.maximum(c, 0) ** (1 / 2.4) - 0.055
    )
    base_luz = np.median(luz[mascara > 0.9])
    sombra = np.clip(lineal(luz) / lineal(base_luz), 0.15, 1.35)
    material = np.clip(srgb(lineal(tela) * sombra[:, :, None]), 0, 1)
    resultado = rgb * (1 - mascara[:, :, None]) + material * mascara[:, :, None]
    return np.rint(resultado * 255).clip(0, 255).astype(np.uint8), mascara


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--textura", type=Path, required=True)
    args = parser.parse_args()
    p = Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
    foto = np.asarray(Image.open(p / "persona-entrada.png").convert("RGB"))
    textura = np.asarray(Image.open(args.textura).convert("RGBA"))
    resultado, mascara = componer(
        foto,
        textura,
        np.fromfile(p / "probabilidades.f32", np.float32).reshape(256, 256, 6),
        json.loads((p / "pose.json").read_text()),
    )
    Image.fromarray(resultado).save(p / "resultado-material.png")
    Image.fromarray(np.uint8(mascara * 255)).save(p / "mascara-material.png")
