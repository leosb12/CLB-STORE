"""Después de verificar-interfaz.mjs --generar: comprueba el resultado real ya generado, sin repetir difusión."""
import base64
import hashlib
import json
from pathlib import Path
import runpy
import sys
import time

import httpx

raiz = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(raiz / "microservicios/inteligencia-artificial"))
from fuente.aplicacion.probador import VERSION_MOTOR, clave_resultado

apis = runpy.run_path(str(raiz / "infraestructura/demostraciones/demo-gestion-ia.py"))
acceso = apis["token"]("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
# Solo para calcular la clave de la prueba; el servidor valida firma/emisor/audiencia del JWT.
titular = json.loads(base64.urlsafe_b64decode(acceso.split(".")[1] + "==="))["sub"]
persona = (raiz / "investigacion/probador-realismo/fixtures/persona-base.jpg").read_bytes()
prenda = (raiz / "compartido/prendas/originales/polera-roja.png").read_bytes()
clave = clave_resultado(titular, persona, prenda, "qa", "upper")
with httpx.Client(base_url="http://127.0.0.1:18000", headers={"Authorization": "Bearer " + acceso}, timeout=30) as cliente:
    previo = cliente.get("/api/v1/probador/trabajos/" + clave)
    assert previo.status_code == 200 and previo.json()["estado"] == "LISTO", "Primero completa la prueba real de interfaz con la versión actual."
    inicio = time.perf_counter()
    respuesta = cliente.post("/api/v1/probador/trabajos", data={"identificador": "qa", "categoria": "Poleras"},
        files={"persona": ("persona.jpg", persona, "image/jpeg"), "prenda": ("prenda.png", prenda, "image/png")})
    milisegundos = round((time.perf_counter() - inicio) * 1000, 2)
    assert respuesta.status_code == 202 and respuesta.json()["estado"] == "LISTO", respuesta.text
    assert respuesta.json()["identificador"] == clave
    imagen = cliente.get("/api/v1/probador/trabajos/" + clave + "/imagen")
    assert imagen.status_code == 200 and imagen.headers["content-type"].startswith("image/png")
salida = raiz / "investigacion/probador-vton/temporales"
(salida / "resultado-moderno.png").write_bytes(imagen.content)
evidencia = {"version_motor": VERSION_MOTOR, "cache_servidor_ms": milisegundos, "estado_repeticion": "LISTO",
             "inferencia_repetida": False, "resultado_sha256": hashlib.sha256(imagen.content).hexdigest()}
(salida / "cache-servidor.json").write_text(json.dumps(evidencia, indent=2) + "\n", "utf-8")
print(json.dumps(evidencia, ensure_ascii=False))
