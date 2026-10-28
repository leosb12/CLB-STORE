"""Detecta zonas de texto sin transcribirlas. Pesos PP-OCRv4 locales y fijados.

La detección solo protege píxeles originales del producto. No genera letras,
no altera el nombre comercial y no recibe fotografías de personas.
"""

import hashlib
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

SHA256_TEXTO = "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"


class DetectorEstampadosLocal:
    def __init__(self, ruta: str):
        archivo = Path(ruta)
        if not archivo.is_file() or hashlib.sha256(archivo.read_bytes()).hexdigest() != SHA256_TEXTO:
            raise RuntimeError("MODELO_ESTAMPADOS_NO_DISPONIBLE: precarga el detector local verificado.")
        ort.disable_telemetry_events()
        opciones = ort.SessionOptions()
        opciones.intra_op_num_threads = 2
        opciones.inter_op_num_threads = 1
        self.sesion = ort.InferenceSession(str(archivo), sess_options=opciones, providers=["CPUExecutionProvider"])
        self.entrada = self.sesion.get_inputs()[0].name

    def detectar(self, imagen: Image.Image, anclas: dict) -> list[list[float]]:
        # Entrada publicada de PP-OCRv4: BGR, [-1, 1], dimensiones múltiplos de 32.
        rgb = np.asarray(imagen.convert("RGBA"))
        color = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
        color[rgb[:, :, 3] < 128] = 255
        alto, ancho = color.shape[:2]
        escala = max(1.0, 736 / min(alto, ancho))
        escala = min(escala, 1536 / max(alto, ancho))
        h = max(32, round(alto * escala / 32) * 32)
        w = max(32, round(ancho * escala / 32) * 32)
        entrada = cv2.resize(color, (w, h)).astype(np.float32) / 127.5 - 1
        mapa = self.sesion.run(None, {self.entrada: entrada.transpose(2, 0, 1)[None]})[0][0, 0]
        if not np.isfinite(mapa).all():
            raise RuntimeError("El detector de estampados devolvió valores inválidos.")
        mascara = cv2.dilate((mapa > .2).astype(np.uint8), np.ones((2, 2), np.uint8))
        contornos, _ = cv2.findContours(mascara, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        candidatos = []
        for contorno in sorted(contornos, key=cv2.contourArea, reverse=True)[:256]:
            if cv2.contourArea(contorno) < 12:
                continue
            x, y, bw, bh = cv2.boundingRect(contorno)
            if bw < 4 or bh < 3:
                continue
            interior = np.zeros((bh, bw), np.uint8)
            cv2.drawContours(interior, [contorno - [x, y]], -1, 1, -1)
            puntuacion = float(cv2.mean(mapa[y:y + bh, x:x + bw], interior)[0])
            if puntuacion < .3:
                continue
            # Margen para contornos de bordado y subtítulos; coordenadas finales normalizadas.
            margen = max(2.0, min(bw, bh) * .8)
            x0, x1 = max(0., (x - margen) / mapa.shape[1]), min(1., (x + bw + margen) / mapa.shape[1])
            y0, y1 = max(0., (y - margen) / mapa.shape[0]), min(1., (y + bh + margen) / mapa.shape[0])
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            # Etiqueta del cuello y texto ajeno al torso no se trasladan como estampado.
            if not anclas["izquierda"] < cx < anclas["derecha"]:
                continue
            if not anclas["arriba"] + .04 * (anclas["abajo"] - anclas["arriba"]) < cy < anclas["abajo"]:
                continue
            candidatos.append([float(x0), float(y0), float(x1), float(y1)])
        return candidatos[:16]
