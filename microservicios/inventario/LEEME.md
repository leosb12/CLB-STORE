# Inventario de CLB Store

Requiere PHP 8.4 o posterior, Composer, ext-mongodb 2.5 y MongoDB local de la fase 1.

1. Ejecutar `composer install` con la extensión habilitada.
2. Copiar `.env.example` a `.env` y configurar el usuario limitado a `clb_inventario`.
3. Ejecutar `php artisan key:generate` y `php artisan serve --host=127.0.0.1 --port=18080`.
4. Ejecutar `php vendor/bin/phpunit`. Las pruebas usan colecciones temporales `clb_prueba_*` dentro de Inventario y las eliminan al terminar.

En esta estación Windows con PHP 8.4: `./preparar-php.ps1` obtiene la extensión oficial; `./ejecutar-php.ps1` permite ejecutar los comandos PHP anteriores sin cambiar la instalación global. Ejemplo: `./ejecutar-php.ps1 vendor/bin/phpunit`.

Registro: `POST /api/v1/productos`, con `Content-Type: application/json`.

```json
{"sku":"CLB-CAMISA-1","nombre":"Camisa","descripción":"Diseño boliviano","categoría":"Camisas","precio":"129.90","activo":true}
```

`precio` es texto decimal en BOB; se guarda como centavos enteros. `activo` es booleano JSON, predeterminado `true`; `descripción` es opcional. El SKU se normaliza a mayúsculas y se protege con un índice único. Respuestas: 201 al registrar, 409 por SKU existente y 422 por datos inválidos.

Consultas de la fase 3:

- `GET /api/v1/productos`: productos activos; parámetros opcionales `página` (1–1000000), `límite` (1–100, predeterminado 24), `búsqueda` (nombre, literal, sin distinguir mayúsculas) y `categoría` (coincidencia exacta). Codificar parámetros con UTF-8/URLSearchParams. Orden estable por nombre y después identificador. Devuelve `productos`, `paginación` y `orden`.
- `GET /api/v1/productos/{identificador}`: devuelve `producto` o 404 si no existe/no está activo.

Ambas consultas conservan el precio como texto y exponen `fecha_actualización` y `versión_sincronización`; no exponen BSON ni centavos internos. Para documentos anteriores, la fecha de actualización equivale a la creación y la versión es 1, sin reescribir datos.

Datos locales de demostración, repetibles y sin modificar productos existentes:

```powershell
./ejecutar-php.ps1 artisan clb:catalogo-demostracion
./ejecutar-php.ps1 artisan serve --host=127.0.0.1 --port=18080
```

La carga utiliza `PuertoRegistrarProducto` y el índice único de SKU. Las pruebas continúan usando exclusivamente colecciones temporales `clb_prueba_*`; no eliminan productos reales.

## Administración local de la fase 4

- `POST /api/v1/productos`: registro existente, ahora protegido y con `Idempotency-Key` UUID v4 obligatorio.
- `PUT /api/v1/productos/{identificador}`: edición completa de `sku`, `nombre`, `descripción` (puede ser vacía), `categoría`, `precio` textual, `activo` booleano y `versión_esperada` entero JSON. Requiere `Idempotency-Key`. Cambiar `activo` desactiva/reactiva lógicamente; no existe eliminación física.
- `GET /api/v1/productos/administracion`: lista activos e inactivos, paginada con `página` y `límite` (hasta 100).
- `GET /api/v1/productos/administracion/{identificador}`: consulta administrativa, incluidos inactivos.

Las dos lecturas administrativas y las escrituras requieren habilitar explícitamente `CLB_ADMINISTRACION_LOCAL_HABILITADA=true` en local. En esta estación ya está habilitada en los archivos `.env` locales. El adaptador verifica entorno local/testing, dirección de origen permitida y restricciones de origen del navegador. En producción responde 403 aunque se habilite la bandera. **No autentica usuarios: NO APTO PARA PRODUCCIÓN**. El contrato `AccesoAdministrativo` queda preparado para validación OIDC y rol ADMIN con Keycloak; no se ha implementado SSO.

Cada escritura administrativa conserva su resultado en el propio documento, junto con la huella de solicitud. El índice único `clb_operacion_unica` impide reutilizar una clave en otro producto. El filtro de modificación combina versión esperada y ausencia de esa clave; los cambios y el comprobante se escriben atómicamente y con journal. Se aprovecha la [atomicidad por documento de MongoDB](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), sin convertir las bases locales en replica set. No se confía en un registro de idempotencia separado que pueda quedar confirmado sin el producto o viceversa.

Un reintento idéntico devuelve la misma instantánea y versión originales. Una clave usada con otros datos responde 409; una versión atrasada responde 409 con `código: CONFLICTO_VERSION` y `producto_actual`. La respuesta de un reintento puede ser histórica; consultar otra vez el producto para conocer su versión vigente. Los comprobantes son internos y no se exponen por REST.

El historial local admite 256 operaciones por producto, incluido el registro idempotente. Al llegar al límite se rechazan nuevas modificaciones con 422, conservando todos los comprobantes y los datos. Requiere revisión técnica; no borrar historiales ni aplicar TTL para continuar, porque se perdería la deduplicación de solicitudes anteriores.


## Variantes, stock y reservas locales

Después de reconstruir, ejecutar `docker compose exec inventario php artisan clb:migrar-variantes` desde la carpeta Compose. Puede repetirse: conserva el SKU comercial y todos los productos sin asignar atributos o existencias ficticias. Las variantes se registran explícitamente, inicialmente con saldo cero. Las pruebas crean datos solo en colecciones temporales.

Todas las escrituras nuevas requieren `Idempotency-Key` UUID v4. Ejemplo de creación de variante: `{"identificador":"UUID-v4-estable","sku":"CLB-CAM-NEG-M","talla":"M","color":"Negro","activo":true}`. El precio sigue siendo el del producto.

| Método y ruta (prefijo `/api/v1`) | Contrato y acceso |
| --- | --- |
| POST `/productos/{id}/variantes` | Crear variante; administrativo local |
| GET `/productos/{id}/variantes` | Variantes activas de producto activo, público |
| GET `/variantes/{id}` o `/variantes/{id}/existencias` | Variante pública con física, reservada, disponible, mínimo, versión y fechas |
| PUT `/variantes/{id}` | SKU/talla/color/activo y `versión_esperada`; administrativo local |
| GET `/administracion/productos/{id}/variantes` | Incluye variantes inactivas; administrativo local |
| GET `/administracion/variantes/{id}` | Estado actual administrativo |
| POST `/variantes/{id}/movimientos` | `tipo`, `cantidad` entera positiva, `motivo`, `versión_esperada`; AJUSTE además requiere `sentido`: INCREMENTO o DISMINUCION |
| GET `/variantes/{id}/movimientos` | Historial auditado; administrativo local |
| PUT `/variantes/{id}/minimo` | `mínimo` entero no negativo y `versión_esperada`; administrativo local |
| POST `/interno/reservas` | `identificador` UUID, `identificador_pedido` externo y `líneas`: arreglo de `{identificador_variante,cantidad}`. Sin versión esperada: basta la disponibilidad; el CAS del agregado impide sobrevender |
| GET `/interno/reservas/{id}` | Estado actual de reserva; interno local |
| POST `/interno/reservas/{id}/consumir` | Cuerpo vacío; consume una vez, interno local |
| POST `/interno/reservas/{id}/liberar` | Cuerpo vacío; compensa una vez, interno local |
| GET `/interno/eventos?desde=N&límite=M` | Eventos `stock_bajo` desde la posición N (predeterminado 0; límite 1–100, predeterminado 100) y `siguiente`. Registro solo creciente: cada consumidor guarda su cursor. `desde` mayor que el total → 409 (reiniciar desde 0); interno local |
| GET `/salud` (sin prefijo `/api`) | `{estado, servicio, dependencias:{mongodb}}`; 200 ACTIVO o 503 DEGRADADO |

Cada reserva admite de una a cincuenta variantes distintas. Si alguna carece de disponibilidad o tiene otra versión, no se reserva ninguna. Una salida no consume unidades reservadas. Consumir resta física y reservada juntas y registra SALIDA por cada variante; liberar solo reduce reservada. Una reserva consumida no puede liberarse. Una terminación repetida, incluso con otra clave, no repite efectos. Usar la misma clave con otra solicitud da 409. Los conflictos de existencias devuelven `variante_actual` cuando procede; no sobrescribirlos automáticamente.

El agregado local `clb_existencias` permite atomicidad de todas las líneas en una sola escritura durable, compatible con MongoDB standalone. Comparte colección e índice de claves con los productos; se excluye de su listado. Se conservan los comprobantes originales y eventos sin TTL. Límite de 256 operaciones por variante y 8 MiB BSON del agregado, con margen para terminar reservas activas. Al agotarse, requiere partición técnica conservando historial; este adaptador acota el desarrollo local y no promete escala de producción. No hay SAGA distribuida ni consumidor n8n.

`php vendor/bin/phpunit` incluye ahora una prueba operacional que reinicia `clb_mongo` para verificar persistencia real, sin borrar volúmenes. Ejecutarla con Docker disponible y sin otra suite MongoDB concurrente. Todas las escrituras de prueba continúan en colecciones `clb_prueba_*`, eliminadas individualmente al terminar.
