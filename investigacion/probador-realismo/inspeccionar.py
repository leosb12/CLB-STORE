"""Inspección de formato, sin inferencia ni fotos personales; entorno aislado uv."""

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import tflite
from comun import leer_modelo

carpeta = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
)
datos = leer_modelo(carpeta)
modelo = tflite.Model.GetRootAsModel(datos, 0)
g = modelo.Subgraphs(0)
nombres = {v: k for k, v in vars(tflite.BuiltinOperator).items() if isinstance(v, int)}
ops = Counter(
    nombres.get(
        modelo.OperatorCodes(g.Operators(i).OpcodeIndex()).BuiltinCode(), "DESCONOCIDO"
    )
    for i in range(g.OperatorsLength())
)


def tensor(i):
    t = g.Tensors(i)
    return {
        "nombre": t.Name().decode(),
        "forma": t.ShapeAsNumpy().tolist(),
        "tipo": int(t.Type()),
    }


informe = {
    "procedencia": "Google MediaPipe SelfieMulticlass float32 version 1",
    "sha256": hashlib.sha256(datos).hexdigest(),
    "bytes": len(datos),
    "subgrafos": modelo.SubgraphsLength(),
    "entradas": [tensor(int(i)) for i in g.InputsAsNumpy()],
    "salidas": [tensor(int(i)) for i in g.OutputsAsNumpy()],
    "operadores": dict(ops),
    "inferencia_ejecutada": False,
    "compatibilidad_TFJS_demostrada": False,
    "calidad_fotografica_demostrada": False,
}
(carpeta / "inspeccion.json").write_text(
    json.dumps(informe, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(informe, indent=2))
