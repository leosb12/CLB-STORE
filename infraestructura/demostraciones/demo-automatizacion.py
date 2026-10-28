"""Demostración reproducible de la fase 10: automatización 100 % entre servicios con n8n local.

Flujo A: Inventario emite `stock_bajo` → n8n busca la variante y el producto → alerta accionable en la gestión (IA).
Flujo B: Ventas confirma un pedido → n8n reúne puntos (Clientes) y productos (Inventario) → comprobante xlsx → Ventas.
Tolerancia a fallas: con n8n detenido los eventos quedan en sus emisores; al volver se procesan una sola vez.

Uso (stack de Compose levantado, incluido `clb_automatizacion`, y `preparar-identidad.py` ejecutado):
    python demo-automatizacion.py
Crea una prenda [DEMO] con SKU único y dos variantes; detiene y vuelve a iniciar el contenedor de n8n.
"""
import importlib.util
import io
import pathlib
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile

_saga = importlib.util.spec_from_file_location("demo_saga", pathlib.Path(__file__).with_name("demo-compra-saga.py"))
saga = importlib.util.module_from_spec(_saga)
_saga.loader.exec_module(saga)
PASARELA, TOKENS, llamar, exigir, token, variante = saga.PASARELA, saga.TOKENS, saga.llamar, saga.exigir, saga.token, saga.variante
N8N = "http://127.0.0.1:15678"


def esperar(condición, segundos, cada=3):
    límite = time.monotonic() + segundos
    while time.monotonic() < límite:
        resultado = condición()
        if resultado:
            return resultado
        time.sleep(cada)
    return None


def n8n_sano():
    try:
        return urllib.request.urlopen(f"{N8N}/healthz", timeout=3).status == 200
    except OSError:
        return False


def alertas(sku):
    _, cuerpo = llamar("GET", f"{PASARELA}/api/v1/notificaciones?estado=NUEVA")
    return [n for n in cuerpo.get("notificaciones", []) if n["sku"] == sku]


def comprobante_listo(pedido):
    _, cuerpo = llamar("GET", f"{PASARELA}/api/v1/pedidos/{pedido}", como="cliente")
    return cuerpo.get("pedido", {}).get("comprobante_disponible")


def descargar_comprobante(pedido):
    solicitud = urllib.request.Request(f"{PASARELA}/api/v1/pedidos/{pedido}/comprobante",
                                       headers={"Authorization": f"Bearer {TOKENS['cliente']}"})
    with urllib.request.urlopen(solicitud, timeout=15) as respuesta:
        return respuesta.headers.get("Content-Type"), respuesta.read()


def variante_con_minimo(producto, sku, talla):
    """Variante con 10 unidades y mínimo 3 (versión 3 tras alta, entrada y mínimo)."""
    identificador = str(uuid.uuid4())
    llamar("POST", f"{PASARELA}/api/v1/productos/{producto}/variantes",
           {"identificador": identificador, "sku": sku, "talla": talla, "color": "Negro", "activo": True}, str(uuid.uuid4()))
    llamar("POST", f"{PASARELA}/api/v1/variantes/{identificador}/movimientos",
           {"tipo": "ENTRADA", "cantidad": 10, "motivo": "Recepción de demostración", "versión_esperada": 1}, str(uuid.uuid4()))
    estado, _ = llamar("PUT", f"{PASARELA}/api/v1/variantes/{identificador}/minimo", {"mínimo": 3, "versión_esperada": 2}, str(uuid.uuid4()))
    exigir(estado == 200 and variante(identificador)["mínimo"] == 3, f"Variante {sku}: 10 unidades, mínimo 3")
    return identificador


def bajar_bajo_el_minimo(identificador, cantidad):
    estado, _ = llamar("POST", f"{PASARELA}/api/v1/variantes/{identificador}/movimientos",
                       {"tipo": "SALIDA", "cantidad": cantidad, "motivo": "Venta en tienda física (demostración)", "versión_esperada": 3},
                       str(uuid.uuid4()))
    exigir(estado == 201 and variante(identificador)["stock_bajo"], f"Salida de {cantidad}: disponible {variante(identificador)['disponible']} ≤ mínimo → stock_bajo")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sufijo = uuid.uuid4().hex[:6].upper()
    print("== 0. n8n local y sesiones")
    exigir(esperar(n8n_sano, 120), f"n8n responde en {N8N} (editor local, sin Internet)")
    TOKENS["cliente"] = token("cliente.demo", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO")
    TOKENS["admin"] = token("admin.demo", "CLB_IDENTIDAD_CLAVE_ADMIN_DEMO")
    estado, _ = llamar("GET", f"{PASARELA}/api/v1/interno/notificaciones")
    exigir(estado == 404, "La entrada interna de n8n hacia IA no se expone por la pasarela")

    print("== 1. Prenda de demostración con dos variantes")
    estado, cuerpo = llamar("POST", f"{PASARELA}/api/v1/productos", {"sku": f"CLB-AUTO-{sufijo}", "nombre": f"[DEMO] Camisa automatizada {sufijo}",
        "descripción": "Prenda de demostración de la automatización n8n.", "categoría": "Camisas", "precio": "150.00", "activo": True}, str(uuid.uuid4()))
    exigir(estado == 201, f"Producto {cuerpo['producto']['nombre']}")
    producto = cuerpo["producto"]["identificador"]
    sku_a, sku_b = f"CLB-AUTO-{sufijo}-M", f"CLB-AUTO-{sufijo}-L"
    var_a = variante_con_minimo(producto, sku_a, "M")
    var_b = variante_con_minimo(producto, sku_b, "L")

    print("== 2. Flujo A: stock bajo → alerta en la gestión, sin intervención")
    bajar_bajo_el_minimo(var_a, 8)
    inicio = time.monotonic()
    encontradas = esperar(lambda: alertas(sku_a), 60)
    exigir(bool(encontradas), f"n8n creó la alerta en {time.monotonic() - inicio:.0f} s: «{encontradas[0]['mensaje'] if encontradas else ''}»")
    estado, cuerpo = llamar("POST", f"{PASARELA}/api/v1/notificaciones/{encontradas[0]['evento']}/atender")
    exigir(estado == 200 and cuerpo["notificacion"]["estado"] == "ATENDIDA", "El administrador la marca como atendida")

    print("== 3. Flujo B: compra confirmada → comprobante xlsx con datos de Ventas, Clientes e Inventario")
    _, estado, cuerpo = saga.comprar(None, var_a, 1)
    pedido = cuerpo["pedido"]["identificador"]
    exigir(cuerpo["pedido"]["estado"] == "CONFIRMADO", f"Pedido {pedido[:8]} CONFIRMADO por la SAGA")
    inicio = time.monotonic()
    exigir(esperar(lambda: comprobante_listo(pedido), 60), f"n8n registró el comprobante en Ventas en {time.monotonic() - inicio:.0f} s")
    tipo, contenido = descargar_comprobante(pedido)
    hoja = zipfile.ZipFile(io.BytesIO(contenido))
    texto = "".join(hoja.read(n).decode("utf-8", "ignore") for n in hoja.namelist() if n.endswith(".xml"))
    exigir("spreadsheetml" in tipo and pedido in texto and "automatización n8n" in texto and "Puntos ganados" in texto,
           "El cliente descarga el xlsx: pedido (Ventas), descripción (Inventario) y puntos (Clientes)")

    print("== 4. n8n caído: los eventos esperan en sus emisores y se procesan una sola vez al volver")
    subprocess.run(["docker", "stop", "clb_automatizacion"], check=True, capture_output=True)
    exigir(not n8n_sano(), "clb_automatizacion detenido")
    bajar_bajo_el_minimo(var_b, 7)
    _, estado, cuerpo = saga.comprar(None, var_b, 1)
    segundo = cuerpo["pedido"]["identificador"]
    exigir(cuerpo["pedido"]["estado"] == "CONFIRMADO", "La compra no depende de n8n: CONFIRMADO igual")
    time.sleep(25)
    exigir(not alertas(sku_b) and not comprobante_listo(segundo), "Sin n8n no hay alerta ni comprobante (nada se pierde: quedan en el outbox)")
    subprocess.run(["docker", "start", "clb_automatizacion"], check=True, capture_output=True)
    exigir(esperar(n8n_sano, 180), "n8n volvió")
    exigir(esperar(lambda: alertas(sku_b), 90) and esperar(lambda: comprobante_listo(segundo), 90),
           "Al volver, n8n retomó desde su cursor: alerta y comprobante pendientes procesados")
    time.sleep(25)  # un ciclo más: un reproceso no debe duplicar nada
    exigir(len(alertas(sku_b)) == 1, "Una sola alerta por evento (idempotencia por identificador de evento)")
    print("\nDemostración de la fase 10 completada.")


if __name__ == "__main__":
    main()
