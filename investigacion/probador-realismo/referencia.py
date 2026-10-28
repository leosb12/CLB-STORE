"""Referencia numérica real LiteRT CPU, aislada de dependencias de producción."""

import json
import sys
import time
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter
from comun import leer_modelo

carpeta = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
)
interprete = Interpreter(model_content=leer_modelo(carpeta), num_threads=2)
interprete.allocate_tensors()
rng = np.random.default_rng(20261023)
entrada = rng.random((1, 256, 256, 3), dtype=np.float32)
entrada.tofile(carpeta / "entrada.f32")
inicio = time.perf_counter()
interprete.set_tensor(interprete.get_input_details()[0]["index"], entrada)
interprete.invoke()
salida = interprete.get_tensor(interprete.get_output_details()[0]["index"])
salida.tofile(carpeta / "salida-litert.f32")
informe = {
    "runtime": "ai-edge-litert 2.3.0 CPU Windows",
    "forma": list(salida.shape),
    "minimo": float(salida.min()),
    "maximo": float(salida.max()),
    "segundos": time.perf_counter() - inicio,
    "fotorealismo_evaluado": False,
}
(carpeta / "referencia.json").write_text(
    json.dumps(informe, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(informe))
