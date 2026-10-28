"""Prueba real sin red de carga, parsing, máscara e inferencia. No genera evidencia ficticia.

Dentro de la imagen VTON:
  python comprobar_vton_gpu.py --persona /entrada/persona.jpg --prenda /entrada/polera.png --salida /salida/resultado.png
La salida y métricas deben revisarse visualmente antes de declarar calidad aceptable.
"""
import argparse
import hashlib
import json
import logging
import os
import socket
import time
from pathlib import Path


def ejecutar():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--persona", required=True)
    parser.add_argument("--prenda", required=True)
    parser.add_argument("--categoria", default="upper", choices=["upper", "lower", "overall"])
    parser.add_argument("--salida", required=True)
    argumentos = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    print("Cargando pesos locales para prueba real de GPU sin red…", flush=True)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    from fuente.infraestructura.catvton import MotorCatVTON
    inicio = time.monotonic()
    motor = MotorCatVTON(os.environ.get("CLB_VTON_PESOS", "/weights"))
    carga = time.monotonic() - inicio
    persona = Path(argumentos.persona).read_bytes()
    prenda = Path(argumentos.prenda).read_bytes()
    tiempos = []
    for _ in range(2):
        inicio = time.monotonic()
        resultado = motor.generar(persona, prenda, argumentos.categoria, 42)
        motor.torch.cuda.synchronize()
        tiempos.append(round(time.monotonic() - inicio, 2))
    destino = Path(argumentos.salida)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(resultado)
    metricas = {"motor": "CatVTON", "categoria": argumentos.categoria, "carga_segundos": round(carga, 2),
                "inferencia_segundos": tiempos, "cuda": motor.torch.cuda.get_device_name(),
                "vram_pico_mib": round(motor.torch.cuda.max_memory_allocated() / 1024**2, 2),
                "vram_reservada_pico_mib": round(motor.torch.cuda.max_memory_reserved() / 1024**2, 2),
                "resultado_sha256": hashlib.sha256(resultado).hexdigest(), "offline": all(nombre == "lo" for _, nombre in socket.if_nameindex()),
                "pasos": 24, "safety_checker": motor.pipeline.safety_checker is not None,
                "dispositivos": {nombre: str(next(modulo.parameters()).device) for nombre, modulo in {
                    "unet": motor.pipeline.unet, "vae": motor.pipeline.vae,
                    "densepose": motor.mascarador.densepose_processor.predictor.model,
                    "schp_atr": motor.mascarador.schp_processor_atr.model,
                    "schp_lip": motor.mascarador.schp_processor_lip.model,
                    "objetos": motor.oclusiones.modelo}.items()}}
    destino.with_suffix(".json").write_text(json.dumps(metricas, indent=2) + "\n", "utf-8")
    print(json.dumps(metricas, indent=2))


if __name__ == "__main__":
    ejecutar()
