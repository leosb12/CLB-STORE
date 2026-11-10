"""Comprueba el worker VTON publicado por el túnel o en loopback: salud, 401 sin token y una inferencia real con JWT.

Uso local:   python infraestructura/tunel-gpu/comprobar.py
Por túnel:   python infraestructura/tunel-gpu/comprobar.py --base https://clb-vton.<dominio> --access
             (--access lee CLB_CF_ACCESS_ID y CLB_CF_ACCESS_SECRETO del entorno; nunca se imprimen)
El token es de cliente.demo del Keycloak local; con el Keycloak del compañero use su propio usuario de prueba.
"""
import argparse
import hashlib
import os
from pathlib import Path
import runpy
import time

import httpx

raiz = Path(__file__).resolve().parents[2]
argumentos = argparse.ArgumentParser(description=__doc__)
argumentos.add_argument("--base", default="http://127.0.0.1:18081")
argumentos.add_argument("--access", action="store_true")
opciones = argumentos.parse_args()

cabeceras = {}
if opciones.access:
    cabeceras = {"CF-Access-Client-Id": os.environ["CLB_CF_ACCESS_ID"], "CF-Access-Client-Secret": os.environ["CLB_CF_ACCESS_SECRETO"]}
acceso = runpy.run_path(str(raiz / "infraestructura/demostraciones/demo-gestion-ia.py"))["token"]("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
persona = (raiz / "investigacion/probador-realismo/fixtures/persona-base.jpg").read_bytes()
prenda = (raiz / "compartido/prendas/originales/polera-roja.png").read_bytes()

with httpx.Client(base_url=opciones.base, headers=cabeceras, timeout=30) as cliente:
    salud = cliente.get("/salud")
    assert salud.status_code == 200 and salud.json()["estado"] == "ACTIVO", salud.text
    assert cliente.post("/api/v1/probador/trabajos").status_code == 401
    assert cliente.get("/api/v1/probador/trabajos/" + "0" * 64, headers={"Authorization": "Bearer x.y.z"}).status_code == 401
    usuario = {"Authorization": "Bearer " + acceso}
    inicio = time.perf_counter()
    trabajo = cliente.post("/api/v1/probador/trabajos", headers=usuario, data={"identificador": "tunel-gpu", "categoria": "Poleras", "force_regenerate": "true"},
                           files={"persona": ("persona.jpg", persona, "image/jpeg"), "prenda": ("prenda.png", prenda, "image/png")})
    assert trabajo.status_code == 202, trabajo.text
    clave = trabajo.json()["identificador"]
    while (estado := cliente.get(f"/api/v1/probador/trabajos/{clave}", headers=usuario).json())["estado"] not in ("LISTO", "ERROR"):
        assert time.perf_counter() - inicio < 660, "La inferencia superó el plazo de 600 s."
        time.sleep(2)
    assert estado["estado"] == "LISTO", estado
    segundos = round(time.perf_counter() - inicio, 1)
    imagen = cliente.get(f"/api/v1/probador/trabajos/{clave}/imagen", headers=usuario)
    assert imagen.status_code == 200 and imagen.headers["X-Contenido-SHA256"] == hashlib.sha256(imagen.content).hexdigest()
print(f"VTON {opciones.base}: salud ACTIVO, sin token 401, token inválido 401, inferencia LISTO en {segundos} s, PNG {len(imagen.content)} bytes con SHA-256 verificado.")
