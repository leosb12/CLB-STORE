"""Exporta un laboratorio de operadores/constantes; NO se integra al producto."""

import json
import sys
from pathlib import Path

import numpy as np
import tflite
from comun import leer_modelo

p = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
)
m = tflite.Model.GetRootAsModel(leer_modelo(p), 0)
g = m.Subgraphs(0)
nombres = {v: k for k, v in vars(tflite.BuiltinOperator).items() if isinstance(v, int)}
pesos = bytearray()
tensores = {}
ops = []
for i in range(g.TensorsLength()):
    t = g.Tensors(i)
    b = m.Buffers(t.Buffer())
    d = {"forma": t.ShapeAsNumpy().tolist(), "tipo": int(t.Type())}
    if b.DataLength():
        v = np.frombuffer(
            b.DataAsNumpy().tobytes(),
            dtype={0: np.float32, 1: np.float16, 2: np.int32}[t.Type()],
        )
        v = v.astype(np.int32 if t.Type() == 2 else np.float32)
        d.update(
            dtype="int32" if t.Type() == 2 else "float32",
            offset=len(pesos),
            bytes=v.nbytes,
        )
        pesos.extend(v.tobytes())
    tensores[str(i)] = d
for i in range(g.OperatorsLength()):
    o = g.Operators(i)
    nombre = nombres[m.OperatorCodes(o.OpcodeIndex()).BuiltinCode()]
    a = {}
    clase = {
        "CONV_2D": "Conv2DOptions",
        "DEPTHWISE_CONV_2D": "DepthwiseConv2DOptions",
        "ADD": "AddOptions",
        "MUL": "MulOptions",
        "RESHAPE": "ReshapeOptions",
        "SOFTMAX": "SoftmaxOptions",
        "SUM": "ReducerOptions",
        "RESIZE_BILINEAR": "ResizeBilinearOptions",
        "RESIZE_NEAREST_NEIGHBOR": "ResizeNearestNeighborOptions",
        "TRANSPOSE_CONV": "TransposeConvOptions",
    }.get(nombre)
    if clase and o.BuiltinOptions():
        v = getattr(tflite, clase)()
        v.Init(o.BuiltinOptions().Bytes, o.BuiltinOptions().Pos)
        for campo in [
            "Padding",
            "StrideH",
            "StrideW",
            "DilationHFactor",
            "DilationWFactor",
            "DepthMultiplier",
            "FusedActivationFunction",
            "Beta",
            "KeepDims",
            "AlignCorners",
            "HalfPixelCenters",
        ]:
            if hasattr(v, campo):
                a[campo] = getattr(v, campo)()
    ops.append(
        {
            "tipo": nombre,
            "entradas": o.InputsAsNumpy().tolist(),
            "salidas": o.OutputsAsNumpy().tolist(),
            "opciones": a,
        }
    )
(p / "operadores.json").write_text(
    json.dumps(
        {
            "tensores": tensores,
            "ops": ops,
            "entrada": int(g.Inputs(0)),
            "salida": int(g.Outputs(0)),
        }
    ),
    encoding="utf-8",
)
(p / "pesos.bin").write_bytes(pesos)
print(json.dumps({"operadores": len(ops), "constantes_bytes": len(pesos)}))
