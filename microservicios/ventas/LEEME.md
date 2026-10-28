# Ventas — CLB Store

Microservicio de pedidos con **DDD**: Java 21, Spring Boot 4.1 y PostgreSQL (`clb_ventas`). Además orquesta la **SAGA de
compra** entre Ventas, Inventario y Clientes.

## Capas (`src/main/java/clb/ventas/`)
- `dominio/`: agregado `Pedido` (raíz) con `LineaPedido` y los objetos de valor `Dinero` (centavos BOB), `Cantidad` y `CopiaProducto` (copia de la prenda al comprar), además de `EstadoPedido`.
  - Reglas: 1–50 líneas, sin variantes repetidas, total exacto y transiciones solo desde un pedido abierto.
  - No depende de Spring.
- `aplicacion/`:
  - Casos de uso: `ConfirmarPedido` (CU03.4) y `OrquestadorSagaCompra` (CU03.5–CU03.6).
  - `SagaCompra`: el estado persistido del proceso.
  - `puertos/`: `RepositorioPedidos`, `CatalogoInventario`, `ReservasInventario` y `FidelizacionClientes`.
  - No depende de Spring.
- `infraestructura/`: JDBC + Flyway (`persistencia/`), clientes REST (`clientes/`), controladores y errores (`http/`), y la composición de beans más el reanudador (`ConfiguracionVentas`).

## SAGA de compra (orquestación)
`RESERVAR` (Inventario) → `ACREDITAR` (Clientes) → `CONSUMIR` (Inventario) → pedido `CONFIRMADO`.
- Stock insuficiente → `CANCELADO` (`STOCK_INSUFICIENTE`), sin compensaciones.
- Clientes no responde o rechaza → `CANCELADO`, luego `COMPENSAR_RESERVA` (liberar) y `COMPENSAR_PUNTOS` (reversa). La reversa se ejecuta siempre, porque la acreditación pudo aplicarse aunque su respuesta se perdiera.
- Inventario no responde → `EN_REVISION`. El **reanudador** (`@Scheduled`, cada 5 s) retoma desde el último paso con espera exponencial (máximo 60 s).
- Cada paso usa una Idempotency-Key fija generada al iniciar, así un reintento nunca duplica reservas, puntos ni consumos. Cada paso se persiste antes de seguir, y un arrendamiento (`reclamada_hasta`) impide dos avances simultáneos.
- No hay rollback global: solo compensaciones.

## Contrato
| Método y ruta | Contrato |
| --- | --- |
| POST `/api/v1/pedidos` | `Idempotency-Key` UUID v4. `{identificador, identificador_cliente, líneas:[{identificador_variante, cantidad}]}`. 201 `{pedido}` con estado, total, líneas (copia de la prenda) y `saga.historial`. La misma clave o el mismo pedido devuelven el pedido existente; otra solicitud → 409 `CONFLICTO_IDEMPOTENCIA` |
| GET `/api/v1/pedidos/{id}` | Estado actual y pasos de la SAGA |
| GET `/api/v1/interno/eventos?desde=N&límite=M` | Outbox `pedido_confirmado` / `pedido_cancelado`. `siguiente` es el cursor del consumidor; interno local |
| GET `/salud` | `{estado, servicio, dependencias:{postgresql}}`; 200 o 503 |

El **precio lo fija el servidor** con la copia actual de Inventario; el carrito no decide el precio.
`identificador_cliente` va en el cuerpo **solo hasta la fase 7**; después sale del token de Keycloak.
Errores: `{mensaje, código}` (422 `DATOS_INVALIDOS` / `VARIANTE_NO_DISPONIBLE`, 409, 404, 503 `SERVICIO_NO_DISPONIBLE`).

## Outbox
`eventos` se escribe en la misma transacción que el cambio de estado. Las inserciones se serializan con
`pg_advisory_xact_lock` para que el orden de los identificadores coincida con el de confirmación: así un consumidor con
cursor nunca se salta un evento.

## Pruebas
`mvn test` corre:
- Dominio sin Spring.
- SAGA con dobles: compra completa, stock insuficiente, falla de Clientes con compensación, respuesta perdida, idempotencia, Inventario caído al consumir con reanudación, y variante inexistente.
- Integración real con PostgreSQL: esquema temporal `clb_prueba_*` que se elimina al terminar. Toma las claves del `.env` de Compose o de variables de entorno, y requiere `clb_postgres` levantado.

Demostración de punta a punta con fallas reales: `python infraestructura/demostraciones/demo-compra-saga.py`.
