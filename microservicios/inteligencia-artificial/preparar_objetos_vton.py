"""Aprovisionamiento explícito del detector oficial Torchvision. Nunca se ejecuta en inferencia."""
import hashlib
import json
import urllib.request
from pathlib import Path

SHA256 = "fb6a3cc702b1df54c18a44b26708cd083614211062d0c36d2ca7bf9270df3533"


def preparar(raiz: Path):
    ruta = raiz / "objetos/fasterrcnn.pth"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    if not ruta.exists():
        temporal = ruta.with_suffix(".tmp")
        urllib.request.urlretrieve("https://download.pytorch.org/models/fasterrcnn_mobilenet_v3_large_fpn-fb6a3cc7.pth", temporal)
        ruta_temporal = temporal
    else:
        ruta_temporal = ruta
    with ruta_temporal.open("rb") as entrada:
        if hashlib.file_digest(entrada, "sha256").hexdigest() != SHA256:
            raise ValueError("El detector no coincide con el checkpoint oficial fijado.")
    if ruta_temporal != ruta:
        ruta_temporal.replace(ruta)
    manifiesto_ruta = raiz / "manifiesto.json"
    manifiesto = json.loads(manifiesto_ruta.read_text("utf-8"))
    manifiesto["archivos"].pop("objetos/ssdlite320.pth", None)
    manifiesto["archivos"]["objetos/fasterrcnn.pth"] = SHA256
    temporal = manifiesto_ruta.with_suffix(".tmp")
    temporal.write_text(json.dumps(manifiesto, indent=2) + "\n", "utf-8")
    temporal.replace(manifiesto_ruta)


if __name__ == "__main__":
    preparar(Path(__file__).parent / "weights")
