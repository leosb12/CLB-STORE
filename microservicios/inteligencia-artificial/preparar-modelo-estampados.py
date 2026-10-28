"""Preparación explícita con Internet: extrae SOLO el detector verificado, sin instalar OCR.

El worker nunca ejecuta este script ni descarga pesos al arrancar.
"""

import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path

URL = "https://files.pythonhosted.org/packages/ba/12/1e5497183bdbe782dbb91bad1d0d2297dba4d2831b2652657f7517bfc6df/rapidocr_onnxruntime-1.4.4-py3-none-any.whl"
SHA_PAQUETE = "971d7d5f223a7a808662229df1ef69893809d8457d834e6373d3854bc1782cbf"
SHA_MODELO = "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"


def preparar():
    carpeta = Path(__file__).resolve().parent / "modelos-prendas"
    carpeta.mkdir(exist_ok=True)
    destino = carpeta / "texto-prenda.onnx"
    if not destino.is_file() or hashlib.sha256(destino.read_bytes()).hexdigest() != SHA_MODELO:
        with urllib.request.urlopen(URL, timeout=60) as respuesta:
            paquete = respuesta.read(30 * 1024 * 1024 + 1)
        if hashlib.sha256(paquete).hexdigest() != SHA_PAQUETE:
            raise RuntimeError("El paquete de preparación no coincide con la versión fijada.")
        with zipfile.ZipFile(io.BytesIO(paquete)) as archivo:
            modelo = archivo.read("rapidocr_onnxruntime/models/ch_PP-OCRv4_det_infer.onnx")
        if hashlib.sha256(modelo).hexdigest() != SHA_MODELO:
            raise RuntimeError("El detector de texto no coincide con su huella.")
        temporal = destino.with_suffix(".tmp")
        temporal.write_bytes(modelo)
        temporal.replace(destino)
    manifiesto = {
        "nombre": "PP-OCRv4, detector de texto convertido por RapidAI",
        "uso": "Solo preparación local de prendas; no reconocimiento ni generación de texto",
        "archivo": destino.name,
        "bytes": destino.stat().st_size,
        "sha256": SHA_MODELO,
        "fuente_paquete": URL,
        "paquete_sha256": SHA_PAQUETE,
        "licencia": "Apache-2.0",
        "procedencia_licencia": "https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/",
    }
    (carpeta / "manifiesto-estampados.json").write_text(json.dumps(manifiesto, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("Detector local de estampados preparado y verificado.")


if __name__ == "__main__":
    preparar()
