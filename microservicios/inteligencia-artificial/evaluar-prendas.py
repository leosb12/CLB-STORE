"""Evalúa fixtures conocidos con ONNX real; no entrena ni modifica umbrales al evaluar."""

import argparse
import io
import json
import time
from pathlib import Path

import numpy as np
from fuente.dominio.prendas import PrendaNoPreparada
from fuente.infraestructura.prendas_onnx import PreparadorU2Net
from PIL import Image

argumentos = argparse.ArgumentParser()
argumentos.add_argument("--fixtures", default="../../compartido/prendas/validacion")
argumentos.add_argument("--modelo", default="modelos-prendas/u2net.onnx")
argumentos.add_argument("--salida", default="../../docs/planes/resultado-cv-sintetico.json")
args = argumentos.parse_args()
raiz = Path(args.fixtures)
manifiesto = json.loads((raiz / "manifiesto.json").read_text(encoding="utf-8"))
modelo = PreparadorU2Net(args.modelo, "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491")
resultados = []
for caso in manifiesto["casos"]:
    inicio = time.perf_counter()
    fila = {"id": caso["id"], "valida": caso["valida"]}
    try:
        salida = modelo.preparar((raiz / caso["archivo"]).read_bytes())
        fila["estado"] = "LISTO"
        if caso["valida"]:
            referencia = np.asarray(Image.open(raiz / caso["mascara"]).convert("L")) >= 128
            reconstruida = np.zeros(referencia.shape, dtype=bool)
            x0, y0, x1, y1 = salida.evidencia["recorte_pixeles"]
            alfa = Image.open(io.BytesIO(salida.maestro)).getchannel("A").resize((x1 - x0, y1 - y0))
            reconstruida[y0:y1, x0:x1] = np.asarray(alfa) >= 128
            fila["iou"] = float(
                np.logical_and(referencia, reconstruida).sum() / max(1, np.logical_or(referencia, reconstruida).sum())
            )
            a = salida.metadatos["anclas"]
            esperadas = caso["anclas_pixeles"]
            # Error por dimensión de la textura final, conforme al contrato normalizado.
            errores = [
                abs(a["izquierda"] - (esperadas["hombro_izquierdo"][0] - x0) / (x1 - x0)),
                abs(a["derecha"] - (esperadas["hombro_derecho"][0] - x0) / (x1 - x0)),
                abs(a["arriba"] - (esperadas["hombro_izquierdo"][1] - y0) / (y1 - y0)),
                abs(a["abajo"] - (esperadas["borde_inferior"] - y0) / (y1 - y0)),
            ]
            fila["error_anclas_maximo"] = max(errores)
            fila["cumple"] = fila["iou"] >= 0.9 and max(errores) <= 0.05
        else:
            fila["cumple"] = False
    except PrendaNoPreparada as error:
        fila.update(estado="REQUIERE_REVISION", motivo=str(error), cumple=not caso["valida"])
    fila["segundos"] = round(time.perf_counter() - inicio, 4)
    resultados.append(fila)
validas = sum(r["valida"] and r["cumple"] for r in resultados)
invalidas = sum(not r["valida"] and r["cumple"] for r in resultados)
informe = {
    "origen": manifiesto["origen"],
    "modelo_sha256": modelo.sha256,
    "validas_aprobadas": validas,
    "invalidas_rechazadas": invalidas,
    "p95_segundos": float(np.percentile([r["segundos"] for r in resultados], 95)),
    "cumple_conjunto_sintetico": validas >= 10 and invalidas == 4,
    "generalizacion_fotografica_demostrada": False,
    "resultados": resultados,
}
Path(args.salida).write_text(json.dumps(informe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(informe, ensure_ascii=False))
