"""Preparación explícita CON Internet; no se importa desde el servicio ni desde el worker."""

import hashlib
import json
import urllib.request
from pathlib import Path

raiz = Path(__file__).resolve().parent / "modelos-prendas"
raiz.mkdir(exist_ok=True)
destino = raiz / "u2net.onnx"
url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
if not destino.exists():
    temporal = raiz / "u2net.tmp"
    urllib.request.urlretrieve(url, temporal)
    if hashlib.md5(temporal.read_bytes()).hexdigest() != "60024c5c889badc19c04ad937298a77b":
        raise SystemExit("El modelo no coincide con la suma publicada por rembg.")
    temporal.replace(destino)
datos = destino.read_bytes()
if hashlib.sha256(datos).hexdigest() != "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491":
    raise SystemExit("SHA-256 del modelo no aprobado.")
if hashlib.md5(datos).hexdigest() != "60024c5c889badc19c04ad937298a77b":
    raise SystemExit("El archivo existente no corresponde al modelo aprobado.")
manifiesto = {
    "modelo": "U²-Net",
    "archivo": destino.name,
    "sha256": hashlib.sha256(datos).hexdigest(),
    "bytes": len(datos),
    "fuente": url,
    "licencia": "Apache-2.0",
    "repositorio_original": "https://github.com/xuebinqin/U-2-Net",
}
(raiz / "manifiesto.json").write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifiesto, ensure_ascii=False))
