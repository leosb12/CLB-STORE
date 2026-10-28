"""Semilla de datos para la gestión empresarial (fase 8), creada SOLO con las APIs reales y por la pasarela.

Crea un catálogo de 8 prendas con variantes y stock, 12 clientes de demostración en Keycloak con sus medidas en Clientes
y unos 35 pedidos que pasan por la SAGA real (Ventas → Inventario → Clientes). Así los reportes, los agentes y K-Means
trabajan con datos que existen en las tres bases, y algunas variantes cruzan su mínimo y emiten `stock_bajo`.

Es repetible: cada operación usa un identificador y una Idempotency-Key deterministas, así que volver a ejecutarla
devuelve los mismos resultados en vez de duplicar productos o pedidos.

Uso (stack levantado, `CLB_IDENTIDAD_DEMOSTRACION=true` y `python ../identidad/preparar-identidad.py` ejecutado):
    python sembrar-gestion.py
"""
import json
import pathlib
import random
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

PASARELA = "http://127.0.0.1:18000"
ENV = pathlib.Path(__file__).resolve().parent.parent / "bases-de-datos" / ".env"
ESPACIO = uuid.UUID("6f1c9d52-3c1e-4c55-9a64-0ab5e3d1c2f0")
TALLAS = ("XS", "S", "M", "L", "XL")

CATALOGO = [
    ("CLB-SEM-POL-BAS", "Polera básica de algodón", "Poleras", "89.00", ("Blanco", "Negro")),
    ("CLB-SEM-POL-OVR", "Polera oversize estampada", "Poleras", "129.00", ("Negro", "Verde")),
    ("CLB-SEM-CAM-LIN", "Camisa de lino", "Camisas", "219.00", ("Blanco", "Celeste")),
    ("CLB-SEM-JEA-REC", "Jean recto", "Pantalones", "249.00", ("Azul",)),
    ("CLB-SEM-PAN-CAR", "Pantalón cargo", "Pantalones", "229.00", ("Beige", "Negro")),
    ("CLB-SEM-CHO-ALP", "Chompa de alpaca", "Abrigos", "389.00", ("Gris", "Café")),
    ("CLB-SEM-CHA-ROM", "Chaqueta rompevientos", "Abrigos", "319.00", ("Negro",)),
    ("CLB-SEM-VES-MID", "Vestido midi", "Vestidos", "279.00", ("Terracota",)),
]
# (nombre, talla habitual, pedidos, prendas por pedido, categorías preferidas)
CLIENTES = [
    ("Valeria", "S", 6, 3, ("Abrigos", "Camisas", "Vestidos")), ("Mateo", "L", 7, 2, ("Abrigos", "Pantalones")),
    ("Camila", "M", 5, 3, ("Camisas", "Vestidos", "Poleras")), ("Diego", "M", 3, 2, ("Pantalones", "Poleras")),
    ("Lucía", "XS", 3, 1, ("Vestidos", "Poleras")), ("Sebastián", "XL", 3, 2, ("Poleras", "Abrigos")),
    ("Andrea", "M", 1, 1, ("Poleras",)), ("Joaquín", "L", 1, 1, ("Poleras",)), ("Gabriela", "S", 2, 1, ("Poleras",)),
    ("Rodrigo", "M", 1, 1, ("Pantalones",)), ("Daniela", "M", 2, 1, ("Poleras",)), ("Nicolás", "XL", 1, 1, ("Poleras",)),
]
MEDIDAS = {"XS": (156, 49, 82, 66), "S": (164, 58, 90, 74), "M": (171, 68, 98, 82), "L": (176, 80, 106, 91), "XL": (182, 95, 115, 102)}


def uuid4_de(*partes) -> str:
    """UUID v4 válido pero determinista: misma operación → mismo identificador e Idempotency-Key."""
    return str(uuid.UUID(bytes=uuid.uuid5(ESPACIO, "|".join(map(str, partes))).bytes, version=4))


def leer_env() -> dict:
    return dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))


def token(usuario: str, clave: str) -> str:
    datos = urllib.parse.urlencode({"grant_type": "password", "client_id": "clb-demostracion", "username": usuario,
                                    "password": clave, "scope": "openid"}).encode()
    return json.load(urllib.request.urlopen(f"{PASARELA}/identidad/realms/clb/protocol/openid-connect/token", data=datos, timeout=15))["access_token"]


def llamar(método, ruta, cuerpo=None, clave=None, token_=None):
    cabeceras = {"Content-Type": "application/json"}
    if token_:
        cabeceras["Authorization"] = f"Bearer {token_}"
    if clave:
        cabeceras["Idempotency-Key"] = clave
    solicitud = urllib.request.Request(PASARELA + ruta, json.dumps(cuerpo).encode() if cuerpo is not None else None, cabeceras, method=método)
    try:
        with urllib.request.urlopen(solicitud, timeout=90) as respuesta:
            return respuesta.status, json.loads(respuesta.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def kcadm(*argumentos):
    resultado = subprocess.run(["docker", "exec", "clb_identidad", "/opt/keycloak/bin/kcadm.sh", *argumentos],
                               capture_output=True, text=True, encoding="utf-8")
    if resultado.returncode != 0:
        raise SystemExit(f"kcadm falló ({argumentos[0]}): {resultado.stderr.strip()[:200]}")
    return resultado.stdout


def preparar_clientes(env) -> dict[str, str]:
    """Crea o actualiza los clientes de demostración y les asigna una clave nueva que solo vive en esta ejecución."""
    kcadm("config", "credentials", "--server", "http://127.0.0.1:8080/identidad", "--realm", "master",
          "--user", env["CLB_IDENTIDAD_ADMINISTRADOR"], "--password", env["CLB_IDENTIDAD_CLAVE_ADMINISTRADOR"])
    claves = {}
    try:
        for indice, (nombre, *_resto) in enumerate(CLIENTES, 1):
            usuario = f"cliente.semilla.{indice:02d}"
            if not json.loads(kcadm("get", "users", "-r", "clb", "-q", f"username={usuario}", "-q", "exact=true", "--fields", "id") or "[]"):
                kcadm("create", "users", "-r", "clb", "-s", f"username={usuario}", "-s", "enabled=true",
                      "-s", f"email={usuario}@clb.local", "-s", "emailVerified=true", "-s", f"firstName={nombre}", "-s", "lastName=Semilla")
            claves[usuario] = secrets.token_urlsafe(18)
            kcadm("set-password", "-r", "clb", "--username", usuario, "--new-password", claves[usuario])
    finally:
        subprocess.run(["docker", "exec", "clb_identidad", "rm", "-f", "/opt/keycloak/.keycloak/kcadm.config"], capture_output=True)
    return claves


def preparar_catalogo(admin: str) -> dict[tuple[str, str, str], str]:
    """Productos, variantes, stock inicial y mínimos. Devuelve {(categoría, talla, sku_producto): variante}."""
    variantes = {}
    for sku, nombre, categoria, precio, colores in CATALOGO:
        estado, cuerpo = llamar("POST", "/api/v1/productos", {"sku": sku, "nombre": nombre, "descripción": f"{nombre} de la colección CLB.",
                                "categoría": categoria, "precio": precio, "activo": True}, uuid4_de("producto", sku), admin)
        if estado not in (200, 201):
            raise SystemExit(f"No se pudo crear {sku}: {estado} {cuerpo}")
        producto = cuerpo["producto"]["identificador"]
        for color in colores:
            for talla in TALLAS:
                id_variante = uuid4_de("variante", sku, talla, color)
                sku_variante = f"{sku}-{talla}-{color[:3].upper()}"
                estado, _ = llamar("POST", f"/api/v1/productos/{producto}/variantes", {"identificador": id_variante, "sku": sku_variante,
                                   "talla": talla, "color": color, "activo": True}, uuid4_de("crear", id_variante), admin)
                if estado not in (200, 201):
                    raise SystemExit(f"No se pudo crear la variante {sku_variante}: {estado}")
                # Las M de la oversize arrancan justas para que la venta cruce el mínimo y emita stock_bajo.
                stock = 7 if (sku == "CLB-SEM-POL-OVR" and talla == "M") else (24 if talla in ("M", "L") else 14)
                llamar("POST", f"/api/v1/variantes/{id_variante}/movimientos", {"tipo": "ENTRADA", "cantidad": stock,
                       "motivo": "Stock inicial de la colección", "versión_esperada": 1}, uuid4_de("entrada", id_variante), admin)
                llamar("PUT", f"/api/v1/variantes/{id_variante}/minimo", {"mínimo": 5, "versión_esperada": 2},
                       uuid4_de("minimo", id_variante), admin)
                variantes[(categoria, talla, f"{sku}|{color}")] = id_variante
        print(f"  ✓ {nombre}: {len(colores) * len(TALLAS)} variantes")
    return variantes


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    env = leer_env()
    admin = token("admin.demo", env["CLB_IDENTIDAD_CLAVE_ADMIN_DEMO"])
    print("== Catálogo (Inventario → MongoDB)")
    variantes = preparar_catalogo(admin)
    print("== Clientes de demostración (Keycloak) y sus medidas (Clientes → DynamoDB)")
    claves = preparar_clientes(env)
    azar = random.Random(2026)
    confirmados = cancelados = 0
    print("== Pedidos por la SAGA real (Ventas → Inventario → Clientes)")
    for indice, (nombre, talla, pedidos, por_pedido, categorias) in enumerate(CLIENTES, 1):
        usuario = f"cliente.semilla.{indice:02d}"
        acceso = token(usuario, claves[usuario])
        altura, peso, pecho, cintura = MEDIDAS[talla]
        estado, actual = llamar("GET", "/api/v1/perfiles/yo", token_=acceso)
        llamar("PUT", "/api/v1/perfiles/yo", {"nombre": f"{nombre} Semilla", "medidas": {"altura_cm": altura, "peso_kg": peso,
               "pecho_cm": pecho, "cintura_cm": cintura}, "versión_esperada": actual["perfil"]["versión"]}, token_=acceso)
        for numero in range(pedidos):
            opciones = [v for (categoria, t, _), v in variantes.items() if categoria in categorias and t == talla]
            elegidas = azar.sample(opciones, min(por_pedido, len(opciones)))
            identificador = uuid4_de("pedido", usuario, numero)
            estado, cuerpo = llamar("POST", "/api/v1/pedidos", {"identificador": identificador, "líneas": [
                {"identificador_variante": v, "cantidad": azar.choice((1, 1, 2))} for v in elegidas]},
                uuid4_de("clave-pedido", usuario, numero), acceso)
            if estado in (200, 201) and cuerpo["pedido"]["estado"] == "CONFIRMADO":
                confirmados += 1
            else:
                cancelados += 1
        print(f"  ✓ {usuario} ({nombre}, talla {talla}): {pedidos} pedidos")
    print(f"== Listo: {confirmados} pedidos confirmados, {cancelados} cancelados. La IA los ingiere en ≤ 20 s.")


if __name__ == "__main__":
    main()
