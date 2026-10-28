"""Demostración reproducible de las fases 6 y 7: compra SAGA entre Ventas, Inventario y Clientes con SSO.

Requisitos del docente que evidencia: transacción transversal en 3 microservicios con SAGA y compensación,
idempotencia (pedido repetido sin duplicados), datos reales en PostgreSQL, MongoDB y DynamoDB, y entrada única con
una sola cuenta (Keycloak) por la pasarela.

Uso (con el stack de Compose levantado y `python ../identidad/preparar-identidad.py` ejecutado una vez):
    python demo-compra-saga.py
Obtiene tokens reales de Keycloak para cliente.demo y admin.demo con el cliente local clb-demostracion.
Crea una prenda de demostración marcada [DEMO] con SKU único; no modifica productos existentes.
Para la falla real detiene y vuelve a iniciar el contenedor clb_backend_clientes.
"""
import base64
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

# Todo entra por la pasarela (punto único), incluida la salud de cada servicio.
PASARELA = "http://127.0.0.1:18000"
INVENTARIO = VENTAS = CLIENTES = PASARELA
SALUD = {nombre: f"{PASARELA}/salud/{nombre.lower()}" for nombre in ("Inventario", "Ventas", "Clientes")}
ENV = pathlib.Path(__file__).resolve().parent.parent / "bases-de-datos" / ".env"
TOKENS = {}


def token(usuario, clave_env):
    env = dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
    datos = urllib.parse.urlencode({"grant_type": "password", "client_id": "clb-demostracion", "username": usuario,
                                    "password": env[clave_env], "scope": "openid"}).encode()
    respuesta = urllib.request.urlopen(f"{PASARELA}/identidad/realms/clb/protocol/openid-connect/token", data=datos, timeout=15)
    return json.load(respuesta)["access_token"]


def sub(acceso):
    carga = acceso.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4)))["sub"]


def llamar(método, url, cuerpo=None, clave=None, como="admin"):
    cabeceras = {"Content-Type": "application/json", "Accept": "application/json"}
    if como:
        cabeceras["Authorization"] = f"Bearer {TOKENS[como]}"
    if clave:
        cabeceras["Idempotency-Key"] = clave
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    solicitud = urllib.request.Request(url, data=datos, headers=cabeceras, method=método)
    try:
        with urllib.request.urlopen(solicitud, timeout=30) as respuesta:
            return respuesta.status, json.loads(respuesta.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def exigir(condición, mensaje):
    if not condición:
        print(f"  ✗ FALLÓ: {mensaje}")
        sys.exit(1)
    print(f"  ✓ {mensaje}")


def variante(identificador):
    return llamar("GET", f"{INVENTARIO}/api/v1/variantes/{identificador}")[1]["variante"]


def saldo(cliente):
    return llamar("GET", f"{CLIENTES}/api/v1/fidelizacion/clientes/{cliente}", como="cliente")[1]["saldo"]


def comprar(cliente, id_variante, cantidad, clave=None, identificador=None):
    # El cliente del pedido es el titular del token (cliente.demo); ya no viaja en el cuerpo.
    cuerpo = {"identificador": identificador or str(uuid.uuid4()),
              "líneas": [{"identificador_variante": id_variante, "cantidad": cantidad}]}
    return cuerpo, *llamar("POST", f"{VENTAS}/api/v1/pedidos", cuerpo, clave or str(uuid.uuid4()), como="cliente")


def pasos(pedido):
    return " → ".join(f"{p['paso']}:{p['resultado']}" for p in pedido["saga"]["historial"])


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # La consola de Windows no usa UTF-8 por defecto.
    sufijo = uuid.uuid4().hex[:6].upper()
    print("== 0. Salud de los tres microservicios")
    for nombre, base in SALUD.items():
        estado, cuerpo = llamar("GET", base, como=None)
        exigir(estado == 200, f"{nombre}: {cuerpo['estado']} {cuerpo['dependencias']}")

    print("== SSO. Una sola cuenta por la pasarela (Keycloak)")
    TOKENS["cliente"] = token("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
    TOKENS["admin"] = token("admin.demo", "CLB_IDENTIDAD_CLAVE_ADMIN_DEMO")
    exigir(True, "Tokens de cliente.demo y admin.demo emitidos por el realm clb")
    estado, _ = llamar("POST", f"{INVENTARIO}/api/v1/productos", {}, str(uuid.uuid4()), como=None)
    exigir(estado == 401, "Sin token: Inventario responde 401")
    estado, _ = llamar("POST", f"{INVENTARIO}/api/v1/productos", {}, str(uuid.uuid4()), como="cliente")
    exigir(estado == 403, "Un cliente no puede administrar el catálogo: 403")
    estado, _ = llamar("GET", f"{PASARELA}/api/v1/interno/eventos", como="admin")
    exigir(estado == 404, "La API interna no se expone por la pasarela")

    print("== 1. Alta de prenda, variante talla M / color Negro y entrada de 10 unidades (Inventario → MongoDB)")
    estado, cuerpo = llamar("POST", f"{INVENTARIO}/api/v1/productos", {"sku": f"CLB-DEMO-{sufijo}", "nombre": f"[DEMO] Polera oversize {sufijo}",
        "descripción": "Prenda de demostración de la SAGA de compra.", "categoría": "Poleras", "precio": "120.00", "activo": True}, str(uuid.uuid4()))
    exigir(estado == 201, f"Producto creado: {cuerpo['producto']['nombre']} a {cuerpo['producto']['precio']} Bs")
    producto = cuerpo["producto"]["identificador"]
    id_variante = str(uuid.uuid4())
    estado, _ = llamar("POST", f"{INVENTARIO}/api/v1/productos/{producto}/variantes",
                       {"identificador": id_variante, "sku": f"CLB-DEMO-{sufijo}-M-NEG", "talla": "M", "color": "Negro", "activo": True}, str(uuid.uuid4()))
    exigir(estado == 201, "Variante M/Negro creada")
    estado, _ = llamar("POST", f"{INVENTARIO}/api/v1/variantes/{id_variante}/movimientos",
                       {"tipo": "ENTRADA", "cantidad": 10, "motivo": "Recepción de demostración", "versión_esperada": 1}, str(uuid.uuid4()))
    exigir(estado == 201 and variante(id_variante)["disponible"] == 10, "Stock disponible: 10")

    cliente = sub(TOKENS["cliente"])
    saldo_inicial = saldo(cliente)
    print("== 2. Compra completa: Ventas (PostgreSQL) → reserva en Inventario → puntos en Clientes (DynamoDB) → confirmación")
    clave = str(uuid.uuid4())
    solicitud, estado, cuerpo = comprar(cliente, id_variante, 2, clave)
    pedido = cuerpo["pedido"]
    exigir(estado == 201 and pedido["estado"] == "CONFIRMADO", f"Pedido {pedido['identificador'][:8]} CONFIRMADO por {pedido['total']} Bs")
    print(f"     SAGA: {pasos(pedido)}")
    exigir(variante(id_variante)["física"] == 8, "Inventario descontó 2 unidades físicas")
    exigir(saldo(cliente) == saldo_inicial + 24, "Clientes acreditó 24 puntos (1 por cada 10 Bs) al titular del token")
    estado, _ = llamar("GET", f"{VENTAS}/api/v1/pedidos/{pedido['identificador']}", como=None)
    exigir(estado == 401, "Consultar un pedido sin sesión: 401")

    print("== 3. Idempotencia: el mismo pedido enviado dos veces no se duplica")
    _, estado, repetido = comprar(cliente, id_variante, 2, clave, solicitud["identificador"])
    exigir(repetido["pedido"]["identificador"] == pedido["identificador"], "Misma Idempotency-Key → mismo pedido")
    exigir(variante(id_variante)["física"] == 8 and saldo(cliente) == saldo_inicial + 24, "Sin nueva reserva ni nuevos puntos")

    print("== 4. Stock insuficiente: la SAGA cancela sin tocar Clientes")
    _, estado, cuerpo = comprar(cliente, id_variante, 100)
    exigir(cuerpo["pedido"]["estado"] == "CANCELADO" and cuerpo["pedido"]["motivo"] == "STOCK_INSUFICIENTE", "Pedido CANCELADO por STOCK_INSUFICIENTE")

    print("== 5. Falla REAL de Clientes: se detiene el contenedor y la SAGA compensa")
    subprocess.run(["docker", "stop", "clb_backend_clientes"], check=True, capture_output=True)
    try:
        _, estado, cuerpo = comprar(cliente, id_variante, 3)
        pedido = cuerpo["pedido"]
        exigir(pedido["estado"] == "CANCELADO" and pedido["motivo"] == "CLIENTES_NO_DISPONIBLE", "Pedido CANCELADO por CLIENTES_NO_DISPONIBLE")
        print(f"     SAGA: {pasos(pedido)}")
        exigir(variante(id_variante)["disponible"] == 8 and variante(id_variante)["reservada"] == 0, "Compensación: reserva liberada, stock intacto")
        exigir(pedido["saga"]["paso"] == "COMPENSAR_PUNTOS", "Reversa de puntos pendiente mientras Clientes siga caído")
    finally:
        subprocess.run(["docker", "start", "clb_backend_clientes"], check=True, capture_output=True)
    print("     Clientes reiniciado; el reanudador de Ventas completa la compensación…")
    for _ in range(40):
        time.sleep(3)
        actual = llamar("GET", f"{VENTAS}/api/v1/pedidos/{pedido['identificador']}", como="cliente")[1]["pedido"]
        if actual["saga"]["paso"] == "TERMINADA":
            break
    exigir(actual["saga"]["paso"] == "TERMINADA", f"SAGA terminada: {pasos(actual)}")
    exigir(saldo(cliente) == saldo_inicial + 24, "Saldo de puntos consistente (sin puntos del pedido cancelado)")
    print("\nDemostración completa: SSO, SAGA, compensación, idempotencia y 3 bases con datos reales.")


if __name__ == "__main__":
    main()
