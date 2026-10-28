"""Regresión PWA con catálogo de demostración aislado; no modifica productos reales."""

import os
import socket
import subprocess
import uuid
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parents[2]
nombre = "clb_prueba_pwa_" + uuid.uuid4().hex[:12]
with socket.socket() as reserva:
    reserva.bind(("127.0.0.1", 0))
    puerto = reserva.getsockname()[1]
with socket.socket() as reserva:
    reserva.bind(("127.0.0.1", 0))
    puerto_web = reserva.getsockname()[1]
creado = False
try:
    subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(RAIZ / "infraestructura/bases-de-datos/compose.yaml"),
            "run",
            "-d",
            "--no-deps",
            "--name",
            nombre,
            "-p",
            f"127.0.0.1:{puerto}:8000",
            "-e",
            f"CLB_MONGO_COLECCION={nombre}",
            "-e",
            "APP_ENV=local",
            "inventario",
        ],
        cwd=RAIZ,
        check=True,
    )
    creado = True
    import time

    with httpx.Client(timeout=5) as http:
        for _ in range(60):
            try:
                if http.get(f"http://127.0.0.1:{puerto}/salud").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError("Inventario aislado no inició")
    subprocess.run(["docker", "exec", nombre, "php", "artisan", "clb:catalogo-demostracion"], check=True)
    resultado = subprocess.run(
        ["cmd", "/c", "npm", "run", "pruebas:pwa"],
        cwd=RAIZ / "aplicaciones/web",
        env={
            **os.environ,
            "CLB_INVENTARIO_URL": f"http://127.0.0.1:{puerto}",
            "CI": "1",
            "CLB_WEB_PUERTO": str(puerto_web),
            "CLB_PWA_BASEURL": f"http://127.0.0.1:{puerto_web}",
        },
        check=False,
    )
    if resultado.returncode:
        raise RuntimeError("Falló la regresión PWA aislada")
finally:
    if creado:
        limpieza = "require 'vendor/autoload.php'; $a=require 'bootstrap/app.php'; $a->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $n=config('inventario.colección'); if(!str_starts_with($n,'clb_prueba_pwa_')) exit(2); Illuminate\\Support\\Facades\\DB::connection('mongodb')->getCollection($n)->drop();"
        try:
            subprocess.run(["docker", "exec", nombre, "php", "-r", limpieza], check=True)
        finally:
            subprocess.run(["docker", "rm", "-f", nombre], check=True)
