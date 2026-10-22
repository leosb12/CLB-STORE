# Catálogo web de CLB Store

Angular 21.2, TypeScript estricto y PWA. Requiere Node 22.12 o posterior de la rama 22 (esta estación usa 22.15). Dependencias fijadas en `package-lock.json`.

Desde `aplicaciones/web/`:

```powershell
npx --yes npm@11.6.2 ci
npm start
```

Desarrollo: `http://127.0.0.1:4200`. El proxy remite `/api` a Inventario en `127.0.0.1:18080`.

Para instalar y comprobar la PWA se necesita la compilación de producción:

```powershell
npm run build
npm run previsualizar
```

Abrir `http://127.0.0.1:14200/catalogo`. Esperar «Catálogo actualizado» y la activación del Service Worker antes de desconectar. Chrome muestra la opción «Instalar aplicación» cuando cumple sus requisitos. Las actualizaciones se ofrecen mediante un aviso y se aplican al recargar; no fuerzan recargas durante el uso.

`public/configuracion.json` determina la URL REST, sin credenciales. El servidor local de producción acepta `CLB_WEB_PUERTO` y `CLB_INVENTARIO_URL`. Para un despliegue posterior, configurar HTTPS y el proxy de `/api` en el servidor elegido. No se ha desplegado en cloud.

Los productos y la última descarga se guardan en IndexedDB (`clb_catalogo`). La descarga completa reemplaza el catálogo en una transacción; una caída o descarga incompleta conserva los datos anteriores. Búsqueda, filtros, paginación y detalle de prendas descargadas funcionan offline. Los favoritos se guardan junto con una operación, atómicamente. Son propios del navegador y del origen: cambiar de puerto cambia el almacenamiento.

No hay procesador remoto para `CAMBIAR_FAVORITO`: sus operaciones siguen `PENDIENTE`, sin envíos ni confirmaciones ficticias. Los procesadores futuros deben tener endpoint real, respetar `AbortSignal` y enviar la misma clave de idempotencia en cada intento. La deduplicación remota deberá implementarse en el servicio responsable. El motor limita el envío a diez segundos, reclama operaciones transaccionalmente y recupera arrendamientos vencidos después de una interrupción. Tras ocho intentos fallidos, exige revisión.

Pruebas:

```powershell
npm test
# Con Inventario y MongoDB funcionando y los datos de demostración cargados:
npm run build
npm run pruebas:pwa
```

Las pruebas PWA usan Chrome instalado y sirven la compilación real en 14200. Validan REST, IndexedDB, requisitos de instalación, Service Worker, cierre y reapertura del navegador offline y reconexión. Usan un perfil temporal aislado; no modifican el perfil personal. Capturas y trazas quedan localmente en `test-results/`, excluido del versionado. Las pruebas unitarias de repositorio usan `fake-indexeddb`; la persistencia real se comprueba además en Chrome.

## Administración local de productos

Abrir `/administracion/productos`. Permite registrar, editar, activar y desactivar con confirmación previa, ver productos inactivos y revisar operaciones. El formulario valida textos, SKU y precio exacto sin convertir dinero a float. **NO APTA PARA PRODUCCIÓN**: la aplicación no autentica usuarios y el backend exige modo local explícito; Keycloak/OIDC y el rol ADMIN siguen pendientes.

IndexedDB versión 2 añade `productosAdministracion` y conserva los almacenes de la fase 3, incluida la única cola. Guardar crea una propuesta persistente con UUID, clave de idempotencia y versión esperada. No cambia el producto confirmado hasta recibir una respuesta válida. Las altas y modificaciones se envían al recuperar disponibilidad REST real, con backoff y la misma clave. Los favoritos continúan pendientes localmente: no se creó ningún endpoint para ellos.

También se pueden preparar ediciones offline a partir de productos ya descargados en el catálogo público, aunque el panel no se hubiera abierto online. Se usa la versión confirmada más reciente que conserve el dispositivo; el servidor detectará si quedó desactualizada. Los inactivos necesitan haberse descargado mediante administración.

La vista de operaciones muestra propuestas, estado, intentos y respuesta de conflicto. Ante 409, 403 o 422 no se sobrescribe el servidor ni se reintenta automáticamente: se exige revisión. «Preparar corrección» carga la versión actual (requiere conexión para ediciones), conserva la propuesta y permite enviar una operación nueva; la anterior queda como antecedente. No se cambia la clave de una operación ya enviada para reintentarla.

Si los ocho reintentos temporales se agotan, la confirmación es incierta. «Reintentar misma operación» consulta de nuevo el resultado con el mismo UUID, clave y datos; no ofrece cambiar de clave ni preparar otra propuesta para ese producto mientras su resultado sea incierto.

La confirmación y su resultado se guardan juntos localmente. Después se relee el catálogo vigente, porque la respuesta de una clave repetida puede corresponder a una versión anterior. Una descarga fallida no vacía los datos existentes. La limitación técnica de historial es 256 operaciones por producto en este entorno local; no se eliminan comprobantes para saltarla.

Pruebas administrativas reales, con MongoDB disponible y compilación de producción ya generada:

```powershell
npm test
npm run build
npx playwright test --config playwright.administracion.config.ts
```

La suite inicia temporalmente Laravel en `127.0.0.1:18081` y la PWA de producción en `127.0.0.1:14201`. Requiere PHP local/ext-mongodb mediante el ejecutor de Inventario, además de Chrome. Usa una colección aleatoria `clb_prueba_web_*` y la limpia al finalizar, sin tocar productos reales. Perfiles temporales aislados para comprobar cierre/reapertura offline, respuesta perdida tras escritura y resolución de conflicto. Capturas/trazas en `test-results-administracion/`. Las cinco pruebas originales de PWA se siguen ejecutando con `npm run pruebas:pwa` en 14200.


## Variantes, stock y carrito

En `/administracion/productos`, abrir «Variantes y stock» del producto. Registrar talla/color/SKU, gestionar entradas/salidas/ajustes con motivo, configurar mínimo y descargar historial. Las existencias de la tabla son confirmadas; las propuestas y conflictos se muestran aparte. Una variante con movimientos o reservas conserva su identidad para auditoría. Los comandos siguen restringidos al entorno local.

Las variantes pueden prepararse offline y «Preparar stock dependiente» permite encolar su entrada antes de que exista en el servidor. Conservan un UUID estable y se envían en orden causal. La hija espera la confirmación de su antecedente y usa su versión devuelta. Una respuesta perdida reintenta la misma clave; un 409/403/422 exige revisión explícita. Los datos propuestos no sustituyen saldos confirmados. La confirmación incierta se consulta con la misma operación.

El detalle público ofrece únicamente combinaciones de talla/color registradas y muestra disponibilidad real de referencia. Las variantes consultadas se guardan para offline; se advierte que el stock puede cambiar. Las imágenes continúan siendo locales. `/carrito` agrega variantes por UUID/SKU, permite editar cantidad, eliminar y vaciar, y conserva la selección al cerrar completamente Chrome. Precio guardado en centavos; totales con bigint. Precio y stock son estimados hasta futura confirmación del servidor. El carrito no reserva ni genera pedidos o pagos.

IndexedDB pasa de versión 2 a 3 sin borrar productos, favoritos, propuestas o metadatos. Se añaden variantes públicas/administrativas, historial descargado y carrito. Se conserva la única cola `operaciones`. Datos privados administrativos y resultados históricos de idempotencia no se publican como disponibilidad actual. Favoritos continúan sin procesador remoto.

Los comandos de prueba anteriores ejecutan también las nuevas pruebas unitarias y cinco recorridos de navegador de variantes, stock, carrito, cierre/reapertura offline, sincronización causal, respuesta perdida y conflicto. Todos los datos de navegador se crean en la colección temporal aislada, nunca en los ocho productos originales.
