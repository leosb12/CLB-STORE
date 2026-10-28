"""Exportación local a safetensors fp16 para evitar picos de RAM al cargar .bin FP32.

Ejecutar con la imagen VTON, sin red y con /weights escribible. Conserva los originales
verificados; nunca modifica los checkpoints descargados ni usa pesos de otra procedencia.
"""
import gc
import hashlib
import json
import os
from pathlib import Path

import torch
from safetensors.torch import save_file

from fuente.infraestructura.modelos_vton import verificar_pesos


def ejecutar():
    raiz = Path(os.environ.get("CLB_VTON_PESOS", "/weights"))
    manifiesto = verificar_pesos(raiz)
    for carpeta, origen, destino in (("unet", "diffusion_pytorch_model.bin", "diffusion_pytorch_model.safetensors"),):
        ruta = raiz / manifiesto["rutas"]["base"] / carpeta
        salida = ruta / destino
        if salida.relative_to(raiz).as_posix() not in manifiesto["archivos"]:
            print("Exportando", carpeta, "a safetensors fp16", flush=True)
            original = torch.load(ruta / origen, map_location="cpu", mmap=True, weights_only=True)
            reducido = {nombre: valor.to(dtype=torch.float16).contiguous() if valor.is_floating_point() else valor.contiguous()
                        for nombre, valor in original.items()}
            temporal = salida.with_suffix(".tmp")
            save_file(reducido, str(temporal), metadata={"format": "pt"})
            temporal.replace(salida)
            del reducido, original
            gc.collect()
        with salida.open("rb") as entrada:
            manifiesto["archivos"][salida.relative_to(raiz).as_posix()] = hashlib.file_digest(entrada, "sha256").hexdigest()
    manifiesto["exportacion_fp16"] = True
    temporal = raiz / "manifiesto.tmp"
    temporal.write_text(json.dumps(manifiesto, indent=2) + "\n", "utf-8")
    temporal.replace(raiz / "manifiesto.json")
    print("Exportación fp16 completada y registrada en el manifiesto.", flush=True)


if __name__ == "__main__":
    ejecutar()
