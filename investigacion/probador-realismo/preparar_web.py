"""Copia recursos del laboratorio a Vite, nunca al build ni public/ del producto."""

import shutil
from pathlib import Path

origen = Path(__file__).resolve().parent
raiz = origen.parents[1]
destino = raiz / "aplicaciones/probador-virtual/temporales/realismo"
destino.mkdir(parents=True, exist_ok=True)
for nombre in ["operadores.json", "pesos.bin", "entrada.f32", "salida-litert.f32"]:
    shutil.copyfile(raiz / "temporales/laboratorio-realismo" / nombre, destino / nombre)
for nombre in ["navegador.js", "red-semantica.mjs", "huellas-exportacion.json"]:
    shutil.copyfile(origen / nombre, destino / nombre)
(destino / "index.html").write_text(
    '<!doctype html><html lang="es"><meta charset="utf-8">'
    "<title>CLB: laboratorio semántico</title><body>"
    '<h1>Laboratorio semántico local</h1><pre id="estado">Verificando la red…</pre>'
    '<script type="module" src="./navegador.js"></script></body></html>',
    encoding="utf-8",
)
