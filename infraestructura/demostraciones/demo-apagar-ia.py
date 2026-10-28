"""Demostración reproducible: apagar Inteligencia Artificial no afecta al catálogo ni a las ventas.

IA es un servicio periférico. Su modelo de lectura (`clb_analitica`) se alimenta por eventos con cursor, así que con IA
detenida la tienda sigue: catálogo, compra SAGA (Ventas → Inventario → Clientes) y SSO. Solo la gestión empresarial
responde «no disponible» de forma controlada. Al volver, la ingesta retoma desde su cursor y la venta hecha sin IA aparece
en GraphQL.

Uso (stack de Compose levantado y `preparar-identidad.py` ejecutado):
    python demo-apagar-ia.py
Crea una prenda [DEMO] con SKU único; detiene y vuelve a iniciar `clb_backend_ia`.
"""
import importlib.util
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

_saga = importlib.util.spec_from_file_location("demo_saga", pathlib.Path(__file__).with_name("demo-compra-saga.py"))
saga = importlib.util.module_from_spec(_saga)
_saga.loader.exec_module(saga)
PASARELA, TOKENS, llamar, exigir, token, variante = saga.PASARELA, saga.TOKENS, saga.llamar, saga.exigir, saga.token, saga.variante


def esperar(condición, segundos, cada=3):
    límite = time.monotonic() + segundos
    while time.monotonic() < límite:
        if resultado := condición():
            return resultado
        time.sleep(cada)
    return None


def estado_de(ruta):
    """Solo el código HTTP: con IA detenida la pasarela responde una página de error, no JSON."""
    solicitud = urllib.request.Request(f"{PASARELA}{ruta}", headers={"Authorization": f"Bearer {TOKENS['admin']}"})
    try:
        with urllib.request.urlopen(solicitud, timeout=20) as respuesta:
            return respuesta.status
    except urllib.error.HTTPError as error:
        return error.code
    except OSError:
        return None


def ia_sana():
    return estado_de("/salud/ia") == 200


def unidades_de_hoy():
    """Unidades vendidas hoy según el modelo de lectura de IA (GraphQL de la gestión)."""
    estado, cuerpo = llamar("POST", f"{PASARELA}/api/v1/graphql", {"query": "{ resumenVentas(periodo: HOY) { unidades } }"})
    return cuerpo["data"]["resumenVentas"]["unidades"] if estado == 200 and cuerpo.get("data") else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sufijo = uuid.uuid4().hex[:6].upper()
    print("== 0. Sesiones y estado inicial")
    TOKENS["cliente"] = token("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
    TOKENS["admin"] = token("admin.demo", "CLB_IDENTIDAD_CLAVE_ADMIN_DEMO")
    exigir(esperar(ia_sana, 120), "IA responde en /salud/ia")
    antes = unidades_de_hoy()
    exigir(antes is not None, f"GraphQL: {antes} unidades vendidas hoy antes de apagar IA")

    print("== 1. Prenda de demostración con stock")
    nombre = f"[DEMO] Polera sin IA {sufijo}"
    estado, cuerpo = llamar("POST", f"{PASARELA}/api/v1/productos", {"sku": f"CLB-SINIA-{sufijo}", "nombre": nombre,
        "descripción": "Prenda de demostración: la tienda funciona con IA apagada.", "categoría": "Poleras", "precio": "120.00",
        "activo": True}, str(uuid.uuid4()))
    exigir(estado == 201, f"Producto {nombre}")
    producto = cuerpo["producto"]["identificador"]
    id_variante = str(uuid.uuid4())
    llamar("POST", f"{PASARELA}/api/v1/productos/{producto}/variantes",
           {"identificador": id_variante, "sku": f"CLB-SINIA-{sufijo}-M", "talla": "M", "color": "Blanco", "activo": True}, str(uuid.uuid4()))
    estado, _ = llamar("POST", f"{PASARELA}/api/v1/variantes/{id_variante}/movimientos",
                       {"tipo": "ENTRADA", "cantidad": 5, "motivo": "Recepción de demostración", "versión_esperada": 1}, str(uuid.uuid4()))
    exigir(estado == 201 and variante(id_variante)["disponible"] == 5, "Variante M con 5 unidades")

    print("== 2. IA detenida")
    subprocess.run(["docker", "stop", "clb_backend_ia"], check=True, capture_output=True)
    try:
        exigir(not ia_sana(), "clb_backend_ia detenido: /salud/ia ya no responde 200")
        estado, cuerpo = llamar("GET", f"{PASARELA}/api/v1/productos?l%C3%ADmite=100")
        exigir(estado == 200 and any(p["identificador"] == producto for p in cuerpo["productos"]), "El catálogo responde y muestra la prenda nueva")
        _, estado, cuerpo = saga.comprar(None, id_variante, 2)
        pedido = cuerpo["pedido"]
        exigir(estado in (200, 201) and pedido["estado"] == "CONFIRMADO",
               f"Compra SAGA CONFIRMADA sin IA (Ventas → Inventario → Clientes): pedido {pedido['identificador'][:8]}")
        exigir(variante(id_variante)["disponible"] == 3, "Inventario descontó 2 unidades")
        inicio = time.monotonic()
        estado = estado_de("/api/v1/reportes?limite=1")
        exigir(estado in (502, 503, 504) and time.monotonic() - inicio < 15,
               f"La gestión responde {estado} de inmediato (no disponible), sin colgar la tienda")
    finally:
        subprocess.run(["docker", "start", "clb_backend_ia"], check=True, capture_output=True)

    print("== 3. IA vuelve y retoma su cursor")
    exigir(esperar(ia_sana, 180), "IA volvió")
    inicio = time.monotonic()
    exigir(esperar(lambda: (unidades_de_hoy() or 0) >= antes + 2, 120),
           f"La venta hecha sin IA llegó a clb_analitica por eventos en {time.monotonic() - inicio:.0f} s (GraphQL: +2 unidades hoy)")
    print("\nDemostración «apagar IA» completada.")


if __name__ == "__main__":
    main()
