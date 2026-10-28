"""E2E aislado: Laravel/MongoDB real + worker ONNX + Angular/React + Chrome.

No modifica catálogo principal: colección temporal propia y contenedores de prueba.
Usa tokens reales sin imprimirlos. El test contiene diez minutos de cámara offline.
"""

import os
import runpy
import socket
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parents[2]
COMPOSE = RAIZ / "infraestructura/bases-de-datos/compose.yaml"
apis = runpy.run_path(str(Path(__file__).with_name("sembrar-gestion.py")))


def ejecutar(argumentos, **opciones):
    return subprocess.check_output(argumentos, cwd=RAIZ, text=True, encoding="utf-8", **opciones).strip()


def puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    sufijo = uuid.uuid4().hex[:10]
    inventario = "clb_prueba_ingesta_" + sufijo
    worker = "clb_prueba_worker_" + sufijo
    web = "clb_prueba_web_" + sufijo
    probador = "clb_prueba_probador_" + sufijo
    coleccion = "clb_prueba_ingesta_" + sufijo
    puerto_api, puerto_web = puerto_libre(), puerto_libre()
    creados = []
    raiz_temporal = RAIZ / "temporales"
    raiz_temporal.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="clb_ingesta_", dir=raiz_temporal) as temporal:
        carpeta = Path(temporal).resolve()
        assert carpeta.is_relative_to(raiz_temporal.resolve())
        try:
            ejecutar(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(COMPOSE),
                    "run",
                    "-d",
                    "--no-deps",
                    "--name",
                    inventario,
                    "-p",
                    f"127.0.0.1:{puerto_api}:8000",
                    "-e",
                    "CLB_RECURSOS_PROBADOR=true",
                    "-e",
                    f"CLB_MONGO_COLECCION={coleccion}",
                    "inventario",
                ]
            )
            creados.append(inventario)
            base = f"http://127.0.0.1:{puerto_api}"
            with httpx.Client(timeout=20) as http:
                for _ in range(60):
                    try:
                        if http.get(base + "/salud").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(1)
                else:
                    raise RuntimeError("Inventario aislado no inició")
                env = apis["leer_env"]()
                token = apis["token"]("admin.demo", env["CLB_IDENTIDAD_CLAVE_ADMIN_DEMO"])
                cabeceras = {"Authorization": "Bearer " + token}

                def post(ruta, datos):
                    respuesta = http.post(
                        base + "/api/v1" + ruta, json=datos, headers={**cabeceras, "Idempotency-Key": str(uuid.uuid4())}
                    )
                    respuesta.raise_for_status()
                    return respuesta.json()

                producto = post(
                    "/productos",
                    {
                        "sku": "CLB-PRUEBA-INGESTA",
                        "nombre": "Polera de prueba de ingesta",
                        "descripción": "Fixture sintético: no fotografía comercial.",
                        "categoría": "Poleras",
                        "precio": "99.00",
                        "activo": True,
                    },
                )["producto"]
                for color in [os.environ.get("CLB_E2E_COLOR", "Rojo"), "Azul"]:
                    variante = str(uuid.uuid4())
                    post(
                        f"/productos/{producto['identificador']}/variantes",
                        {
                            "identificador": variante,
                            "sku": "CLB-PRUEBA-" + color.upper(),
                            "talla": "M",
                            "color": color,
                            "activo": True,
                        },
                    )
                    post(
                        f"/variantes/{variante}/movimientos",
                        {"tipo": "ENTRADA", "cantidad": 5, "motivo": "Prueba aislada", "versión_esperada": 1},
                    )
            ejecutar(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(COMPOSE),
                    "--profile",
                    "prendas",
                    "run",
                    "-d",
                    "--no-deps",
                    "--name",
                    worker,
                    "-e",
                    f"CLB_INVENTARIO_URL=http://{inventario}:8000",
                    "ia-prendas",
                ]
            )
            creados.append(worker)
            ejecutar(["docker", "run", "-d", "--name", probador, "--network", "clb_aplicaciones", "clb_probador:local"])
            creados.append(probador)
            nginx = (RAIZ / "aplicaciones/web/infraestructura/nginx.conf").read_text(encoding="utf-8")
            nginx = nginx.replace("http://probador:8080", f"http://{probador}:8080")
            nginx = nginx.replace(
                "set $pasarela http://pasarela:8080;",
                f"set $pasarela http://{inventario}:8000;\n        set $gateway http://pasarela:8080;",
            )
            nginx = nginx.replace(
                "        location ^~ /api/ {",
                "        location ^~ /api/v1/tallas/ { proxy_pass $gateway$uri; }\n        location ^~ /api/ {",
            )
            configuracion = carpeta / "nginx.conf"
            configuracion.write_text(nginx, encoding="utf-8")
            ejecutar(
                [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    web,
                    "--network",
                    "clb_aplicaciones",
                    "-p",
                    f"127.0.0.1:{puerto_web}:8080",
                    "-v",
                    f"{configuracion}:/etc/nginx/nginx.conf:ro",
                    "clb_web:local",
                ]
            )
            creados.append(web)
            entorno = {
                **os.environ,
                "CLB_E2E_BASEURL": f"http://127.0.0.1:{puerto_web}",
                "CLB_E2E_PRODUCTO": producto["identificador"],
                "CLB_E2E_TOKEN": token,
            }
            print("E2E aislado iniciado; colección temporal propia. No se imprimen credenciales.", flush=True)
            resultado = subprocess.run(
                ["cmd", "/c", "npx", "playwright", "test", "--config", "playwright.recursos.config.ts"],
                cwd=RAIZ / "aplicaciones/web",
                env=entorno,
                check=False,
            )
            if resultado.returncode:
                raise RuntimeError("Falló la prueba E2E; consultar trace local ignorado por Git")
        finally:
            if worker in creados:
                subprocess.run(["docker", "rm", "-f", worker], capture_output=True, check=False)
                creados.remove(worker)
            if inventario in creados:
                limpieza = "require 'vendor/autoload.php'; $a=require 'bootstrap/app.php'; $a->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); $n=config('inventario.colección'); if(!str_starts_with($n,'clb_prueba_ingesta_')) exit(2); Illuminate\\Support\\Facades\\DB::connection('mongodb')->getCollection($n)->drop();"
                limpiar = subprocess.run(
                    ["docker", "exec", inventario, "php", "-r", limpieza], capture_output=True, check=False
                )
                if limpiar.returncode:
                    print("ATENCIÓN: no se pudo limpiar la colección temporal " + coleccion, flush=True)
            for nombre in reversed(creados):
                assert nombre in {inventario, web, probador} and nombre.startswith("clb_prueba_")
                subprocess.run(["docker", "rm", "-f", nombre], capture_output=True, check=False)
            print("Contenedores temporales retirados; volúmenes principales conservados.", flush=True)


if __name__ == "__main__":
    main()
