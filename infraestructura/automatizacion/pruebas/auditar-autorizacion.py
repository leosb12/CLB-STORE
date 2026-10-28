"""Prueba sin escrituras: tokens reales y solicitudes inválidas a las tres APIs internas desde la red Docker.

El token de servicio debe superar autorización y llegar a validación (422); los demás deben detenerse en 401/403.
Nunca imprime tokens ni claves. Ejecutar con el stack local ya iniciado.
"""
import base64
import json
import pathlib
import subprocess
import urllib.parse
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parents[3]


def ejecutar():
    env = dict(l.split("=", 1) for l in (RAIZ / "infraestructura/bases-de-datos/.env").read_text(encoding="utf-8").splitlines()
               if "=" in l and not l.startswith("#"))
    url = "http://127.0.0.1:18000/identidad/realms/clb/protocol/openid-connect/token"

    def token(datos):
        solicitud = urllib.request.Request(url, data=urllib.parse.urlencode(datos).encode())
        with urllib.request.urlopen(solicitud, timeout=15) as respuesta:
            return json.load(respuesta)["access_token"]

    servicio = token({"grant_type": "client_credentials", "client_id": "clb-n8n", "client_secret": env["CLB_IDENTIDAD_SECRETO_N8N"]})
    cliente = token({"grant_type": "password", "client_id": "clb-demostracion", "username": "cliente.demo",
                     "password": env["CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO"]})
    partes = cliente.split(".")
    carga = json.loads(base64.urlsafe_b64decode(partes[1] + "=" * (-len(partes[1]) % 4)))
    carga["realm_access"] = {"roles": ["servicio"]}
    partes[1] = base64.urlsafe_b64encode(json.dumps(carga).encode()).decode().rstrip("=")
    tokens = {"sin_token": None, "cliente": cliente, "firma_alterada": ".".join(partes), "servicio": servicio}
    codigo = '''
import json, sys, urllib.request, urllib.error
tokens = json.load(sys.stdin)
destinos = [("Ventas", "http://ventas:8080/api/v1/interno/pedidos/no-es-uuid/comprobante", b"PK\\x03\\x04", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
 ("Clientes", "http://clientes:3000/api/v1/interno/fidelizacion/clientes/no-es-uuid", None, None),
 ("IA", "http://ia:8000/api/v1/interno/notificaciones", b"{}", "application/json")]
for nombre, url, datos, tipo in destinos:
    for caso, token in tokens.items():
        cabeceras = {"Authorization": "Bearer " + token} if token else {}
        if tipo: cabeceras["Content-Type"] = tipo
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=datos, headers=cabeceras), timeout=15) as r:
                estado = r.status
        except urllib.error.HTTPError as error:
            estado = error.code
        esperado = 422 if caso == "servicio" else 403 if caso == "cliente" else 401
        assert estado == esperado, f"{nombre}/{caso}: {estado}, se esperaba {esperado}"
        print(f"PASS {nombre}/{caso}: {estado}")
'''
    resultado = subprocess.run(["docker", "exec", "-i", "clb_backend_ia", "python", "-c", codigo],
                               input=json.dumps(tokens), text=True, capture_output=True, timeout=120)
    if resultado.returncode:
        raise RuntimeError("Falló la matriz de autorización:\n" + resultado.stdout + resultado.stderr)
    print(resultado.stdout, end="")


if __name__ == "__main__":
    ejecutar()
