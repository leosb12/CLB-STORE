"""Inferencia real con el worker caliente aislado de toda red; restaura su enlace en finally."""
import json
import runpy
import subprocess
import time
from pathlib import Path

import httpx

raiz = Path(__file__).resolve().parents[2]
demo = runpy.run_path(str(raiz / "infraestructura/demostraciones/demo-gestion-ia.py"))
token = demo["token"]("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
contenedor = "clb_worker_vton"
inspeccion = json.loads(subprocess.check_output(["docker", "inspect", contenedor], text=True))[0]
redes = inspeccion["NetworkSettings"]["Networks"]
if len(redes) != 1:
    raise RuntimeError("Revisar las redes del worker antes del ensayo aislado.")
red, configuracion = next(iter(redes.items()))
cabeceras = {"Authorization": "Bearer " + token}
with httpx.Client(base_url="http://127.0.0.1:18000", headers=cabeceras, timeout=60) as cliente:
    version = cliente.get("/salud/probador").json()["version_motor"]
    respuesta = cliente.post("/api/v1/probador/trabajos", data={"identificador": "qa-offline-" + str(time.time_ns()), "categoria": "Poleras"},
                             files={"persona": ("publica.jpg", (raiz / "investigacion/probador-realismo/fixtures/persona-base.jpg").read_bytes(), "image/jpeg"),
                                    "prenda": ("polera.png", (raiz / "compartido/prendas/originales/polera-roja.png").read_bytes(), "image/png")})
    respuesta.raise_for_status()
    clave = respuesta.json()["identificador"]
    desconectado = False
    try:
        subprocess.run(["docker", "network", "disconnect", red, contenedor], check=True, capture_output=True)
        desconectado = True
        inicio = time.monotonic()
        programa = '''import hashlib,json,socket,sys,time,urllib.request
d=json.load(sys.stdin)
def consultar(ruta):
 return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8000'+ruta,headers={'Authorization':'Bearer '+d['token']}),timeout=20).read()
interfaces=[n for _,n in socket.if_nameindex()]
assert interfaces==['lo'], interfaces
for _ in range(300):
 j=json.loads(consultar('/api/v1/probador/trabajos/'+d['clave']))
 if j['estado']=='ERROR': raise RuntimeError(j)
 if j['estado']=='LISTO': break
 time.sleep(2)
else: raise TimeoutError('La inferencia sin red no terminó')
imagen=consultar('/api/v1/probador/trabajos/'+d['clave']+'/imagen')
assert imagen.startswith(bytes([137,80,78,71,13,10,26,10]))
print(json.dumps({'interfaces':interfaces,'estado':j['estado'],'bytes_png':len(imagen),'sha256':hashlib.sha256(imagen).hexdigest()}))
'''
        resultado = subprocess.run(["docker", "exec", "-i", contenedor, "python", "-c", programa], input=json.dumps({"token": token, "clave": clave}), text=True, capture_output=True, check=True)
        evidencia = {**json.loads(resultado.stdout), "version_motor": version, "segundos_aislado": round(time.monotonic() - inicio, 2)}
        salida = raiz / "investigacion/probador-vton/temporales/offline-caliente.json"
        salida.parent.mkdir(parents=True, exist_ok=True)
        salida.write_text(json.dumps(evidencia, indent=2) + "\n", "utf-8")
        print(json.dumps(evidencia))
    finally:
        if desconectado:
            orden = ["docker", "network", "connect"]
            for alias in configuracion.get("Aliases") or []:
                orden.extend(["--alias", alias])
            subprocess.run([*orden, red, contenedor], check=True, capture_output=True)
        # La pasarela renueva DNS cada diez segundos después de cambiar el endpoint.
        for _ in range(15):
            try:
                if cliente.delete("/api/v1/probador/trabajos/" + clave).status_code == 204:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(2)
