# Clientes — CLB Store

Microservicio de fidelización: NestJS 12 (ESM), TypeScript 5.9 y DynamoDB, con **arquitectura clásica en capas**.
Participa en la SAGA de compra: acredita puntos y los revierte como compensación.

El despliegue AWS, tablas reales, permisos, archivos privados, costos y actualización/recuperación están en [infraestructura/aws/LEEME.md](../../infraestructura/aws/LEEME.md). El módulo opcional `fuente/archivos/` conserva la dirección presentación → negocio → datos y no cambia las reglas de fidelización.

## Capas (`fuente/fidelizacion/`)
- `presentacion/`: controlador REST y validación de solicitudes (class-validator).
- `negocio/`: regla de puntos (1 punto por cada 10 Bs completos) e idempotencia por clave y por pedido.
- `datos/`: contrato del repositorio + implementación DynamoDB con `TransactWriteItems` condicionales.

Cada capa depende solo de la inferior. `fuente/comun/` tiene el filtro de errores en español y la restricción interna local.

## Contrato
| Método y ruta | Contrato |
| --- | --- |
| POST `/api/v1/interno/fidelizacion/acreditaciones` (rol `servicio`) | `Idempotency-Key` UUID v4. `{identificador_pedido, identificador_cliente, total_centavos}`. 201 `{movimiento}`. Repetir devuelve el original. Clave con otra solicitud → 409 `CONFLICTO_IDEMPOTENCIA`. Pedido ya revertido → 409 `PEDIDO_REVERTIDO` |
| POST `/api/v1/interno/fidelizacion/reversas` (rol `servicio`) | `Idempotency-Key`. `{identificador_pedido, identificador_cliente}`. Revierte la acreditación; si aún no llegó, deja una marca que la bloquea para siempre |
| GET `/api/v1/fidelizacion/clientes/{id}` (titular o `admin`) | `{identificador_cliente, saldo, movimientos}` |
| GET `/salud` (sin prefijo) | `{estado, servicio, dependencias:{dynamodb}}`; 200 ACTIVO o 503 DEGRADADO |

Errores: `{mensaje, código}`; validación → 422 `{mensaje, errores}`.

## DynamoDB
Tabla `clb_fidelizacion` (configurable con `CLB_CLIENTES_TABLA`), con PK `pk` y SK `sk`:
- `PEDIDO#id` + `ACREDITACION|REVERSA`: movimientos, únicos por pedido en todo el sistema; el índice `clb_por_cliente` los lista por cliente.
- `CLIENTE#id` + `SALDO`: saldo acumulado.
- `CLAVE#uuid` + `CLAVE`: huella y resultado de cada Idempotency-Key.
- `PERFIL#sub` + `PERFIL`: perfil del cliente con versión optimista (módulo `perfiles`).

Cada escritura incluye movimiento, saldo y clave en una sola transacción condicional. En local, la tabla se crea al arrancar.

## Configuración
`CLB_CLIENTES_PUERTO_INTERNO` (3000), `CLB_ENTORNO` (`local`), `CLB_DYNAMODB_ENDPOINT`, `CLB_DYNAMODB_REGION`,
`CLB_DYNAMODB_IDENTIFICADOR`/`CLB_DYNAMODB_CLAVE` (ficticias, solo DynamoDB Local), `CLB_CLIENTES_TABLA`,
`CLB_IDENTIDAD_EMISOR` y `CLB_IDENTIDAD_JWKS`.

En EC2: `CLB_ENTORNO=produccion`, `CLB_DYNAMODB_REGION=us-east-2`, sin endpoint local ni credenciales explícitas. `CLB_CLIENTES_HOST=127.0.0.1` deja Node detrás de Caddy; en Compose el valor predeterminado sigue siendo `0.0.0.0`. `CLB_S3_BUCKET` activa la API `/api/v1/archivos`, con registro en `CLB_ARCHIVOS_TABLA` (por defecto `clb_archivos`). Si no se define bucket, las rutas de archivos no se montan. `CLB_CORS_ORIGENES` admite orígenes exactos separados por comas, sin comodines.

Desde la fase 7, el guard `AutenticacionJwt` valida firma, emisor y audiencia `clb-api` de los tokens de Keycloak. Las rutas
`/api/v1/interno/*` exigen el rol `servicio` y la pasarela las responde con 404 desde afuera. Sin puerto publicado: se llega por
la pasarela (127.0.0.1:18000).

Lo anterior describe la pasarela **local**. En AWS, Caddy publica esos contratos por HTTPS para Ventas/IA/n8n entre nubes, conservando el guard JWT y rol `servicio` en cada controlador. El grupo de seguridad no publica el puerto de Node. Keycloak puede no estar disponible al arrancar: `/salud` consulta DynamoDB, y las rutas privadas rechazan tokens que no puedan verificar. Se exigen firma RS256, expiración, emisor, sujeto y audiencia `clb-api`; no se reemplaza el SSO por tokens de prueba.

## Pruebas
`npm run probar`: compila y ejecuta `node:test`. Incluye negocio y HTTP con un repositorio en memoria, e integración real
con DynamoDB Local (tabla temporal `clb_prueba_*` que se elimina al terminar). Requiere `clb_dynamodb` levantado.
