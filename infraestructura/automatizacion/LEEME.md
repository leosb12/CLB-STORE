# Automatización con n8n (fase 10)

n8n local (`clb_automatizacion`, imagen `n8nio/n8n:2.43.8`) encadena los servicios de CLB Store sin que se conozcan entre sí.
Funciona sin Internet: sin telemetría, plantillas ni nodos comunitarios.

## Flujos
| Flujo | Disparo | Pasos | Resultado |
|---|---|---|---|
| A · `clbStockBajo0001` | cada 20 s | Inventario `/api/v1/interno/eventos` (solo `stock_bajo`) → variante → producto → IA `POST /api/v1/interno/notificaciones` | Alerta accionable en `/gestion` → Monitoreo («Marcar atendida») |
| B · `clbComprobante01` | cada 20 s | Ventas `/api/v1/interno/eventos` (solo `pedido_confirmado`) → por pedido: puntos en Clientes → productos en Inventario → filas → **Convert to File (xlsx)** → Ventas `POST /api/v1/interno/pedidos/{id}/comprobante` | Comprobante de venta descargable en `/pedidos` |

- **Cursor:** cada flujo guarda en sus datos estáticos hasta dónde leyó y solo avanza cuando terminó todo. Si n8n cae, los
  eventos siguen en el emisor y se procesan al volver.
- **Idempotencia:** la notificación es única por evento (UUID de Inventario) y el comprobante, único por pedido (el primero
  gana). Un reintento o un reproceso no duplica nada.
- **Errores:** red, 5xx, 401/403/408/425/429 detienen la ejecución y se reintenta en el siguiente ciclo; un 4xx definitivo se
  registra en la ejecución y se salta para no bloquear la cola.
- **Identidad:** cliente Keycloak `clb-n8n` (client credentials, rol `servicio`); el secreto llega como variable de entorno.

## Operación
- Generar los JSON tras cambiar el diseño: `python generar-flujos.py` (repetible, mismos identificadores).
- `iniciar-n8n.sh` importa y publica los flujos solo si faltan. Para reimportar: `CLB_N8N_REIMPORTAR=true docker compose up -d
  --force-recreate automatizacion` y luego recrear sin la variable (reimportar reinicia los cursores; el reproceso es idempotente).
- Editor: <http://127.0.0.1:15678> (solo local). La primera vez pide crear la cuenta de propietario.
- Demo: `python ../demostraciones/demo-automatizacion.py` (alerta, comprobante y n8n detenido → reentrega sin duplicados).

## Hallazgos de auditoría M03–M06 y B01 (cerrados el 27-oct)
- **M03 — rechazados durables.** Una variante desactivada (404) ya no detiene el lote. Se guarda en
  `$getWorkflowStaticData('global').rechazados`, que conserva los últimos 100 sin duplicar el evento, y el cursor avanza.
  Un 4xx definitivo de IA o de Ventas también queda registrado ahí. Los errores temporales de Variante o de Producto
  (5xx, 401/403/408/425/429, red) detienen la ejecución y se reintentan con el mismo cursor. Antes, cualquier respuesta de
  Producto distinta de 200 se tomaba como «sin producto». Para reprocesar los rechazados se reinicia el cursor con
  `CLB_N8N_REIMPORTAR=true` (idempotente).
- **M04 — tokens fuera de las ejecuciones.** Los flujos usan `saveDataSuccessExecution: none` y
  `saveManualExecutions: false`: n8n marca cada ejecución exitosa como borrada al terminarla y sin datos. Solo las
  fallidas guardan datos, para diagnosticar, y Compose las poda a las 24 h (`EXECUTIONS_DATA_PRUNE`,
  `EXECUTIONS_DATA_MAX_AGE=24`). Se verificó en la base de n8n: ninguna ejecución posterior al cambio contiene `access_token`.
  **Residual aceptado:** una ejecución fallida puede contener un token vigente (15 min) durante 24 h. Solo lo ve quien
  edita en n8n (127.0.0.1), y esa persona ya puede leer el secreto del cliente por `$env`.
- **M05 — puntos con lectura consistente.** El flujo B pide `GET /interno/fidelizacion/clientes/{c}?pedido={p}`.
  Clientes lee `PEDIDO#p` con `ConsistentRead` (no el índice eventual por cliente) y solo si el pedido es de ese cliente.
  Si falta la acreditación de un pedido confirmado, el comprobante no se emite y se reintenta: ya no existe «En proceso».
- **M06 — archivo validado antes de guardarlo.** Ventas rechaza por `Content-Length` o con lectura acotada (2 MB + 1)
  sin cargar el cuerpo completo. Exige que el xlsx sea un ZIP con `[Content_Types].xml` y `xl/workbook.xml`: lee solo el
  directorio central, sin descomprimir, con un tope de 2000 entradas. El PDF debe empezar con `%PDF-` y terminar con `%%EOF`.
- **B01 — solo la automatización registra comprobantes.** Regla específica
  `POST /api/v1/interno/pedidos/*/comprobante` → rol `servicio`; un admin recibe 403.
- Pruebas: `node --test infraestructura/automatizacion/pruebas/flujos.test.mjs` (8 + 1 en el contenedor), Ventas 42,
  Clientes 21 y `demo-automatizacion.py` completa.
- **Ajustes de la revisión del 27-oct:**
  - en «Armar alerta», un 4xx definitivo de Variante (404, 400, 422) se registra y se salta, con la misma regla que
    VERIFICAR; antes, un 422 bloqueaba el cursor;
  - los rechazados se identifican por evento o pedido real (no por la hora), así que la deduplicación funciona;
  - en el flujo B, un pedido confirmado sin acreditación visible tras 10 min ya no bloquea la cola: el comprobante dice
    «No disponible (en revisión)» y el pedido queda en los rechazados.
