"""Comprueba rembg real bajo el filesystem de solo lectura del worker desplegado."""
from pathlib import Path
import subprocess

raiz = Path(__file__).resolve().parents[2]
codigo = '''
import sys, io
from PIL import Image
from rembg import new_session, remove
sesion = new_session("u2net", providers=["CPUExecutionProvider"])
imagen = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")
resultado = remove(imagen, session=sesion)
assert resultado.mode == "RGBA" and resultado.getchannel("A").getbbox() is not None
print("rembg real en contenedor de solo lectura: fondo separado correctamente.")
'''
subprocess.run(["docker", "compose", "-f", str(raiz / "infraestructura/bases-de-datos/compose.yaml"),
    "exec", "-T", "ia-vton", "python", "-c", codigo],
    input=(raiz / "compartido/prendas/originales/polera-roja.png").read_bytes(), check=True)
