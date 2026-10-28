"""Prueba de la pasarela, JWT real y validaciones, sin consumir una inferencia GPU."""
import io
from pathlib import Path
import runpy

import httpx
from PIL import Image

raiz = Path(__file__).resolve().parents[2]
apis = runpy.run_path(str(raiz / "infraestructura/demostraciones/demo-gestion-ia.py"))
acceso = apis["token"]("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
base = "http://127.0.0.1:18000"
salida = io.BytesIO()
Image.new("RGB", (256, 256), "white").save(salida, "PNG")
with httpx.Client(base_url=base, timeout=20) as cliente:
    assert cliente.get("/salud/probador").json()["servicio"] == "ia-vton"
    assert cliente.post("/api/v1/probador/trabajos").status_code == 401
    cabeceras = {"Authorization": "Bearer " + acceso}
    respuesta = cliente.post("/api/v1/probador/trabajos", headers=cabeceras,
        files={"persona": ("invalida.png", b"no es imagen", "image/png"), "prenda": ("prenda.png", salida.getvalue(), "image/png")},
        data={"identificador": "prueba-validacion", "categoria": "Poleras"})
    assert respuesta.status_code == 422, respuesta.text
    assert respuesta.json()["código"] == "IMAGEN_INVALIDA", respuesta.text
    assert cliente.get("/api/v1/probador/trabajos/" + "0" * 64, headers=cabeceras).status_code == 404
print("Pasarela + Keycloak real: salud 200, anónimo 401, foto inválida 422 y trabajo inexistente 404. No se encoló inferencia.")
