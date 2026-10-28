"""Genera los flujos de n8n de CLB Store (fase 10) en `flujos/*.json`. Repetible: mismos identificadores siempre.

Los JSON son el artefacto que n8n importa al arrancar (`iniciar-n8n.sh`). Se generan con este script para que el código de
los nodos Code y las URL estén revisados como código; también se pueden editar en el editor de n8n y exportar.

Flujo A — `stock_bajo` → alerta: Inventario (eventos, variante, producto) → IA (notificación accionable en el panel).
Flujo B — `pedido_confirmado` → comprobante: Ventas (outbox) → Clientes (puntos) → Inventario (productos) → xlsx → Ventas.

Cada flujo lee su fuente con un cursor guardado en los datos estáticos de n8n y solo lo avanza cuando terminó todo. Si n8n
cae, los eventos siguen en el emisor y se procesan al volver; cada escritura es idempotente (evento o pedido).
"""
import json
import sys
import pathlib

SALIDA = pathlib.Path(__file__).parent / "flujos"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
AUTORIZACION = {"name": "Authorization", "value": "=Bearer {{ $('Token de servicio').first().json.access_token }}"}
RESPUESTA_COMPLETA = {"response": {"response": {"fullResponse": True, "neverError": True}}, "timeout": 10000}

# Registro durable de rechazados definitivos (M03): queda en los datos estáticos del flujo (sobrevive a reinicios), acotado
# a los últimos 100 y sin duplicar un mismo evento. Para reprocesarlos se reinicia el cursor (CLB_N8N_REIMPORTAR): es idempotente.
RECHAZADOS = """const registrarRechazo = (r) => {
  const datosRechazos = $getWorkflowStaticData('global');
  datosRechazos.rechazados = [{ ...r, fecha: new Date().toISOString() },
    ...(datosRechazos.rechazados ?? []).filter((x) => x.evento !== r.evento)].slice(0, 100);
};
"""

# 4xx definitivos (datos que el destino nunca aceptará) se registran y se saltan para no bloquear la cola; el resto
# (red, 5xx, identidad, límite de solicitudes) detiene la ejecución y el siguiente ciclo reintenta desde el mismo cursor.
VERIFICAR = RECHAZADOS + """const definitivos = [];
for (const [i, r] of $input.all().entries()) {
  const estado = r.json.statusCode;
  if (estado >= 500 || [401, 403, 408, 425, 429].includes(estado)) throw new Error(`{destino} respondió ${estado}: se reintentará.`);
  if (estado >= 400) {
    definitivos.push({ indice: i, estado });
    registrarRechazo({ evento: {evento}, destino: '{destino}', estado,
      motivo: String(r.json.body?.mensaje ?? r.json.body?.detail ?? '').slice(0, 200) });
  }
}
return [{ json: { procesados: $input.all().length, rechazados_definitivos: definitivos } }];"""


def nodo(identificador, nombre, tipo, version, posicion, parametros, **extra):
    return {"id": identificador, "name": nombre, "type": tipo, "typeVersion": version, "position": posicion,
            "parameters": parametros, **extra}


def programado(posicion):
    return nodo("a0000000-0000-4000-8000-000000000001", "Cada 20 segundos", "n8n-nodes-base.scheduleTrigger", 1.2, posicion,
                {"rule": {"interval": [{"field": "seconds", "secondsInterval": 20}]}})


def codigo(identificador, nombre, posicion, js):
    return nodo(identificador, nombre, "n8n-nodes-base.code", 2, posicion, {"mode": "runOnceForAllItems", "jsCode": js})


def token(posicion):
    return nodo("a0000000-0000-4000-8000-000000000003", "Token de servicio", "n8n-nodes-base.httpRequest", 4.2, posicion, {
        "method": "POST", "url": "={{ $env.CLB_IDENTIDAD_TOKEN_URL }}", "sendBody": True, "contentType": "form-urlencoded",
        "specifyBody": "keypair", "bodyParameters": {"parameters": [
            {"name": "grant_type", "value": "client_credentials"}, {"name": "client_id", "value": "clb-n8n"},
            {"name": "client_secret", "value": "={{ $env.CLB_N8N_SECRETO }}"}]},
        "options": {"timeout": 10000}})


def http(identificador, nombre, posicion, url, metodo="GET", consulta=None, completa=False, **cuerpo):
    p = {"method": metodo, "url": url, "sendHeaders": True, "specifyHeaders": "keypair",
         "headerParameters": {"parameters": [AUTORIZACION, *cuerpo.pop("cabeceras", [])]},
         "options": RESPUESTA_COMPLETA if completa else {"timeout": 10000}}
    if consulta:
        p |= {"sendQuery": True, "specifyQuery": "keypair",
              "queryParameters": {"parameters": [{"name": k, "value": v} for k, v in consulta.items()]}}
    p |= cuerpo
    return nodo(identificador, nombre, "n8n-nodes-base.httpRequest", 4.2, posicion, p)


def conexiones(*pares):
    resultado = {}
    for origen, destino, *salida in pares:
        indice = salida[0] if salida else 0
        principal = resultado.setdefault(origen, {"main": []})["main"]
        while len(principal) <= indice:
            principal.append([])
        principal[indice].append({"node": destino, "type": "main", "index": 0})
    return resultado


def flujo(identificador, nombre, nodos, enlaces, descripcion):
    return {"id": identificador, "name": nombre, "active": False, "nodes": nodos, "connections": conexiones(*enlaces),
            "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all",
                         "saveManualExecutions": False,
                         "timezone": "America/La_Paz"},
            "pinData": {}, "meta": {"descripcion": descripcion}}


def flujo_stock_bajo():
    nodos = [
        programado([0, 0]),
        codigo("a0000000-0000-4000-8000-000000000002", "Cursor de Inventario", [220, 0],
               "const datos = $getWorkflowStaticData('global');\nreturn [{ json: { desde: datos.cursorInventario ?? 0 } }];"),
        token([440, 0]),
        http("a1000000-0000-4000-8000-000000000004", "Eventos de Inventario", [660, 0],
             "={{ $env.CLB_INVENTARIO_URL }}/api/v1/interno/eventos", completa=True,
             consulta={"desde": "={{ $('Cursor de Inventario').first().json.desde }}", "límite": "50"}),
        codigo("a1000000-0000-4000-8000-000000000005", "Solo stock_bajo", [880, 0], """const datos = $getWorkflowStaticData('global');
const r = $input.first().json;
// 409: Inventario tiene menos eventos que el cursor (registro reiniciado): se vuelve a leer desde el principio.
if (r.statusCode === 409) { datos.cursorInventario = 0; return []; }
if (r.statusCode !== 200) throw new Error(`Inventario respondió ${r.statusCode}: se reintentará.`);
const { eventos, siguiente } = r.body;
const stockBajo = eventos.filter((e) => e.tipo === 'stock_bajo');
if (!stockBajo.length) { datos.cursorInventario = siguiente; return []; }
return stockBajo.map((e) => ({ json: { ...e, siguiente } }));"""),
        http("a1000000-0000-4000-8000-000000000006", "Variante", [1100, 0],
             "={{ $env.CLB_INVENTARIO_URL }}/api/v1/variantes/{{ $json.identificador_variante }}", completa=True),
        http("a1000000-0000-4000-8000-000000000007", "Producto", [1320, 0],
             "={{ $env.CLB_INVENTARIO_URL }}/api/v1/productos/{{ $('Solo stock_bajo').item.json.identificador_producto }}",
             completa=True),
        codigo("a1000000-0000-4000-8000-000000000008", "Armar alerta", [1540, 0], RECHAZADOS + """const eventos = $('Solo stock_bajo').all();
const variantes = $('Variante').all();
const temporal = (estado) => estado >= 500 || [401, 403, 408, 425, 429].includes(estado);
const alertas = [];
for (const [i, r] of $input.all().entries()) {
  const e = eventos[i].json;
  const rv = variantes[i].json;
  // Misma regla que VERIFICAR: un 4xx definitivo (404 variante desactivada, 400/422 dato inválido) se registra y se salta
  // sin detener el lote; 5xx y 401/403/408/425/429 se reintentan.
  if (temporal(rv.statusCode)) throw new Error(`Inventario respondió ${rv.statusCode} al leer la variante: se reintentará.`);
  if (rv.statusCode >= 400) { registrarRechazo({ evento: e.identificador, destino: 'Inventario', estado: rv.statusCode, motivo: rv.statusCode === 404 ? 'Variante inexistente o desactivada.' : 'Inventario rechazó la variante del evento.' }); continue; }
  // Un producto desactivado (404) deja la alerta útil con el SKU; cualquier otro error se reintenta, no se adivina.
  if (r.json.statusCode !== 200 && r.json.statusCode !== 404) throw new Error(`Inventario respondió ${r.json.statusCode} al leer el producto: se reintentará.`);
  const v = rv.body.variante;
  const producto = r.json.statusCode === 200 ? r.json.body.producto.nombre : v.sku;
  alertas.push({ json: { evento: e.identificador, tipo: 'stock_bajo', variante: e.identificador_variante, producto, sku: v.sku,
    talla: v.talla, color: v.color, disponible: e.disponible, minimo: e['mínimo'], fecha_evento: e.fecha } });
}
// Si todo el lote se rechazó, el cursor avanza aquí: los nodos siguientes no se ejecutan sin elementos.
if (!alertas.length) { $getWorkflowStaticData('global').cursorInventario = eventos[0].json.siguiente; }
return alertas;"""),
        http("a1000000-0000-4000-8000-000000000009", "Registrar alerta en IA", [1760, 0],
             "={{ $env.CLB_IA_URL }}/api/v1/interno/notificaciones", metodo="POST", completa=True,
             sendBody=True, contentType="json", specifyBody="json", jsonBody="={{ JSON.stringify($json) }}"),
        codigo("a1000000-0000-4000-8000-000000000010", "Verificar respuesta de IA", [1980, 0], VERIFICAR.replace("{destino}", "IA").replace("{evento}", "$('Armar alerta').all()[i].json.evento")),
        codigo("a1000000-0000-4000-8000-000000000011", "Avanzar cursor", [2200, 0], """const datos = $getWorkflowStaticData('global');
datos.cursorInventario = $('Solo stock_bajo').first().json.siguiente;
return [{ json: { cursor: datos.cursorInventario, ...$input.first().json } }];"""),
    ]
    orden = [n["name"] for n in nodos]
    return flujo("clbStockBajo0001", "CLB · Stock bajo → alerta en gestión", nodos, list(zip(orden, orden[1:])),
                 "Flujo A (fase 10): eventos stock_bajo de Inventario → variante y producto → notificación en IA.")


def flujo_comprobante():
    nodos = [
        programado([0, 0]),
        codigo("a0000000-0000-4000-8000-000000000002", "Cursor de Ventas", [220, 0],
               "const datos = $getWorkflowStaticData('global');\nreturn [{ json: { desde: datos.cursorVentas ?? 0 } }];"),
        token([440, 0]),
        http("a2000000-0000-4000-8000-000000000004", "Eventos de Ventas", [660, 0],
             "={{ $env.CLB_VENTAS_URL }}/api/v1/interno/eventos",
             consulta={"desde": "={{ $('Cursor de Ventas').first().json.desde }}", "límite": "20"}),
        codigo("a2000000-0000-4000-8000-000000000005", "Solo pedidos confirmados", [880, 0], """const datos = $getWorkflowStaticData('global');
const { eventos, siguiente } = $input.first().json;
const confirmados = eventos.filter((e) => e.tipo === 'pedido_confirmado');
if (!confirmados.length) { datos.cursorVentas = siguiente; return []; }
return confirmados.map((e) => ({ json: { pedido: e.datos, siguiente } }));"""),
        nodo("a2000000-0000-4000-8000-000000000006", "Un pedido a la vez", "n8n-nodes-base.splitInBatches", 3, [1100, 0],
             {"batchSize": 1, "options": {}}),
        http("a2000000-0000-4000-8000-000000000007", "Puntos del cliente", [1320, 120],
             "={{ $env.CLB_CLIENTES_URL }}/api/v1/interno/fidelizacion/clientes/{{ $json.pedido.identificador_cliente }}",
             consulta={"pedido": "={{ $json.pedido.identificador }}"}),
        http("a2000000-0000-4000-8000-000000000008", "Productos de Inventario", [1540, 120],
             "={{ $env.CLB_INVENTARIO_URL }}/api/v1/productos", consulta={"límite": "100"}),
        codigo("a2000000-0000-4000-8000-000000000009", "Filas del comprobante", [1760, 120], RECHAZADOS + """const { pedido } = $('Un pedido a la vez').first().json;
const puntos = $('Puntos del cliente').first().json;
const catálogo = new Map(($('Productos de Inventario').first().json.productos ?? []).map((p) => [p.identificador, p]));
// Lectura consistente por pedido (M05). Un pedido confirmado siempre fue acreditado antes (SAGA): si falta, se reintenta
// en el siguiente ciclo en vez de emitir un comprobante incompleto que Ventas conservaría para siempre.
const acreditación = puntos.pedido?.['acreditación'];
// Tras 10 min sin acreditación (anomalía de datos, p. ej. Clientes restaurado) no se bloquea la cola: el comprobante
// dice «no disponible» y el pedido queda en la lista de rechazados para revisarlo.
const vencido = Date.now() - new Date(pedido['fecha_creación']).getTime() > 10 * 60 * 1000;
if (!acreditación && !vencido) throw new Error(`Clientes todavía no muestra la acreditación del pedido ${pedido.identificador}: se reintentará.`);
if (!acreditación) registrarRechazo({ evento: `pedido#${pedido.identificador}`, destino: 'Clientes', estado: 0, motivo: 'Pedido confirmado sin acreditación visible.' });
const fila = (concepto, detalle = '', cantidad = '', precio = '', subtotal = '') =>
  ({ json: { Concepto: concepto, Detalle: detalle, Cantidad: cantidad, 'Precio (Bs)': precio, 'Subtotal (Bs)': subtotal } });
return [
  fila('Comprobante de venta', 'CLB Store · comprobante, no es factura fiscal'),
  fila('Pedido', pedido.identificador),
  fila('Fecha', new Date(pedido['fecha_creación']).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })),
  fila('Cliente', pedido.identificador_cliente),
  ...pedido['líneas'].map((l) => fila(l.nombre,
    [l.sku, `talla ${l.talla}`, l.color, catálogo.get(l.identificador_producto)?.['descripción']].filter(Boolean).join(' · '),
    l.cantidad, Number(l.precio), Number(l.subtotal))),
  fila('Total', pedido.moneda, '', '', Number(pedido.total)),
  fila('Puntos ganados', acreditación ? String(acreditación.puntos) : 'No disponible (en revisión)'),
  fila('Saldo de puntos', String(puntos.saldo ?? 0)),
];"""),
        nodo("a2000000-0000-4000-8000-000000000010", "Comprobante xlsx", "n8n-nodes-base.convertToFile", 1.1, [1980, 120],
             {"operation": "xlsx", "binaryPropertyName": "data", "options": {
                 "fileName": "={{ 'comprobante-' + $('Un pedido a la vez').first().json.pedido.identificador + '.xlsx' }}",
                 "sheetName": "Comprobante"}}),
        http("a2000000-0000-4000-8000-000000000011", "Registrar en Ventas", [2200, 120],
             "={{ $env.CLB_VENTAS_URL }}/api/v1/interno/pedidos/{{ $('Un pedido a la vez').first().json.pedido.identificador }}/comprobante",
             metodo="POST", completa=True, sendBody=True, contentType="binaryData", inputDataFieldName="data",
             cabeceras=[{"name": "Content-Type", "value": XLSX},
                        {"name": "X-Nombre-Archivo", "value": "={{ 'comprobante-' + $('Un pedido a la vez').first().json.pedido.identificador + '.xlsx' }}"}]),
        codigo("a2000000-0000-4000-8000-000000000012", "Verificar respuesta de Ventas", [2420, 120], VERIFICAR.replace("{destino}", "Ventas").replace("{evento}", "`pedido#${$('Un pedido a la vez').first().json.pedido.identificador}`")),
        codigo("a2000000-0000-4000-8000-000000000013", "Avanzar cursor", [1320, -120], """const datos = $getWorkflowStaticData('global');
datos.cursorVentas = $('Solo pedidos confirmados').first().json.siguiente;
return [{ json: { cursor: datos.cursorVentas } }];"""),
    ]
    enlaces = [("Cada 20 segundos", "Cursor de Ventas"), ("Cursor de Ventas", "Token de servicio"), ("Token de servicio", "Eventos de Ventas"),
               ("Eventos de Ventas", "Solo pedidos confirmados"), ("Solo pedidos confirmados", "Un pedido a la vez"),
               ("Un pedido a la vez", "Avanzar cursor", 0), ("Un pedido a la vez", "Puntos del cliente", 1),
               ("Puntos del cliente", "Productos de Inventario"), ("Productos de Inventario", "Filas del comprobante"),
               ("Filas del comprobante", "Comprobante xlsx"), ("Comprobante xlsx", "Registrar en Ventas"),
               ("Registrar en Ventas", "Verificar respuesta de Ventas"), ("Verificar respuesta de Ventas", "Un pedido a la vez")]
    return flujo("clbComprobante01", "CLB · Pedido confirmado → comprobante de venta", nodos, enlaces,
                 "Flujo B (fase 10): pedido_confirmado de Ventas → puntos (Clientes) → productos (Inventario) → xlsx → Ventas.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    SALIDA.mkdir(exist_ok=True)
    for f in (flujo_stock_bajo(), flujo_comprobante()):
        (SALIDA / f"{f['id']}.json").write_text(json.dumps(f, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("✓", f["name"])
