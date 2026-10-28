"""Inferencia de foto REAL con LiteRT; tensores RGB preparados sin red."""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from comun import leer_modelo

raiz = Path(__file__).resolve().parents[2]
argumentos = argparse.ArgumentParser()
argumentos.add_argument("--carpeta", type=Path, default=raiz / "temporales/laboratorio-realismo")
p = argumentos.parse_args().carpeta.resolve()
if not p.is_relative_to(raiz / "temporales"):
    raise ValueError("Los datos personales deben permanecer en temporales")
config = json.loads((p / "preprocesamiento.json").read_text(encoding="utf-8"))
assert config == {"media": [127.5], "desviacion": [127.5], "activacion": "SOFTMAX"}
entrada = np.fromfile(p / "foto-rgb.u8", dtype=np.uint8).reshape(1, 256, 256, 3)
entrada = (entrada.astype(np.float32) - 127.5) / 127.5
entrada.tofile(p / "entrada.f32")
modelo = Interpreter(model_content=leer_modelo(raiz / "temporales/laboratorio-realismo"), num_threads=2)
modelo.allocate_tensors()
inicio = time.perf_counter()
modelo.set_tensor(modelo.get_input_details()[0]["index"], entrada)
modelo.invoke()
salida = modelo.get_tensor(modelo.get_output_details()[0]["index"])
salida.tofile(p / "salida-litert.f32")
exp = np.exp(salida - salida.max(axis=-1, keepdims=True))
(exp / exp.sum(axis=-1, keepdims=True)).astype(np.float32).tofile(
    p / "probabilidades.f32"
)
segundos = time.perf_counter() - inicio
# Misma pose MoveNet local; entradas preparadas con el relleno existente del cliente.
pose = Interpreter(
    model_path=str(
        Path(__file__).resolve().parents[2]
        / "aplicaciones/android/assets/modelos/movenet-lightning-4.tflite"
    ),
    num_threads=2,
)
pose.allocate_tensors()
pose.set_tensor(
    pose.get_input_details()[0]["index"],
    np.fromfile(p / "pose-rgb.u8", dtype=np.uint8).reshape(1, 192, 192, 3),
)
pose.invoke()
(p / "pose.json").write_text(
    json.dumps(
        pose.get_tensor(pose.get_output_details()[0]["index"]).reshape(17, 3).tolist()
    ),
    encoding="utf-8",
)
print(json.dumps({"foto_real": True, "segundos_segmentacion": segundos}))
