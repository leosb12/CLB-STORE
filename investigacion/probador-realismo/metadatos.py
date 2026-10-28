"""Lee los campos concretos del esquema oficial; no requiere TensorFlow."""

import json
import struct
from pathlib import Path

import tflite
from comun import leer_modelo
from flatbuffers.table import Table


def tablas(tabla, campo):
    offset = tabla.Offset(4 + 2 * campo)
    return (
        [
            Table(tabla.Bytes, tabla.Indirect(tabla.Vector(offset) + i * 4))
            for i in range(tabla.VectorLen(offset))
        ]
        if offset
        else []
    )


def texto(tabla, campo):
    offset = tabla.Offset(4 + 2 * campo)
    return tabla.String(offset + tabla.Pos).decode() if offset else ""


def flotantes(tabla, campo):
    offset = tabla.Offset(4 + 2 * campo)
    return (
        list(
            struct.unpack_from(
                "<" + "f" * tabla.VectorLen(offset), tabla.Bytes, tabla.Vector(offset)
            )
        )
        if offset
        else []
    )


def inspeccionar(carpeta):
    modelo = tflite.Model.GetRootAsModel(leer_modelo(carpeta), 0)
    informe = {}
    for i in range(modelo.MetadataLength()):
        md = modelo.Metadata(i)
        if md.Name() != b"TFLITE_METADATA":
            continue
        datos = modelo.Buffers(md.Buffer()).DataAsNumpy().tobytes()
        raiz = Table(datos, struct.unpack_from("<I", datos)[0])
        subgrafo = tablas(raiz, 3)[0]
        entrada = tablas(subgrafo, 2)[0]
        unidad = tablas(entrada, 4)[0]
        tipo = unidad.Bytes[unidad.Pos + unidad.Offset(4)]
        if tipo != 1:
            raise ValueError("No es NormalizationOptions del esquema oficial")
        opciones = Table(datos, unidad.Indirect(unidad.Pos + unidad.Offset(6)))
        informe.update(media=flotantes(opciones, 0), desviacion=flotantes(opciones, 1))
        for custom in tablas(subgrafo, 9):
            if texto(custom, 0) != "SEGMENTER_METADATA":
                continue
            offset = custom.Offset(6)
            inicio = custom.Vector(offset)
            contenido = bytes(custom.Bytes[inicio : inicio + custom.VectorLen(offset)])
            opciones = Table(contenido, struct.unpack_from("<I", contenido)[0])
            offset = opciones.Offset(4)
            activacion = contenido[opciones.Pos + offset] if offset else 0
            informe["activacion"] = {0: "NONE", 1: "SIGMOID", 2: "SOFTMAX"}[activacion]
    return informe


if __name__ == "__main__":
    carpeta = Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"
    resultado = inspeccionar(carpeta)
    (carpeta / "preprocesamiento.json").write_text(
        json.dumps(resultado, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(resultado))
