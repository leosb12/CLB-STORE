# CLB Store para Android (Flutter)

App móvil de la tienda: catálogo y carrito sin conexión (SQLite), compra por una cola de sincronización idempotente,
probador con TensorFlow Lite en el teléfono y la misma cuenta que la web (Keycloak por AppAuth). Especificación vigente en [ICONIX](../../docs/iconix/LEEME.md).

## Arquitectura (Presentation / Domain / Data)
- `lib/dominio/` — Dart puro: entidades y reglas (`modelos.dart`: dinero en centavos, cola y su máquina de estados),
  `tallas.dart` y `pose.dart` (port 1:1 del probador web), `contratos.dart` (interfaces) y `casos_de_uso.dart`.
- `lib/datos/` — adaptadores: `almacen_sqlite.dart` (sqflite), `rest.dart` (pasarela), `sesion_keycloak.dart`
  (flutter_appauth + Keystore), `detector_movenet.dart` (tflite_flutter / LiteRT).
- `lib/presentacion/` — pantallas Material 3 y `EstadoTienda` (`ChangeNotifier`); solo conoce el dominio.
- `lib/main.dart` — raíz de composición.

## Ejecutar

Versión actual: **1.0.9+10** (RA 3D por WebView desde el 27-oct; ejecutar antes `preparar-probador.ps1`, que `preparar-movil.ps1` ya llama). Preparación completa del teléfono, desde esta carpeta en PowerShell:

```powershell
./preparar-movil.ps1 -Dispositivo ID_DEL_DISPOSITIVO
```

Comprueba la API local, compila explícitamente `lib/main.dart`, instala sin borrar datos, restaura `adb reverse` después de instalar y verifica que el SHA-256 de la APK instalada coincida. Abre la aplicación normal. Sin `-Dispositivo` selecciona el único teléfono autorizado conectado. No reutiliza la APK que pudiera haber dejado `integration_test`.

La app confirma disponibilidad mediante la sincronización real, sin confundir Wi-Fi con acceso al servidor. Si la sincronización falló, vuelve a intentarla cada 30 segundos mientras la app está activa, incluso sin evento de red (caso USB). Al desconectar/reconectar USB, reiniciar ADB o revocar depuración puede perderse el túnel: restablecerlo con `adb reverse tcp:18000 tcp:18000`; no hace falta reinstalar. Para sincronizar en esta configuración local se conserva el cable; la copia descargada sigue disponible sin él.

Requisitos: Flutter 3.41, Android SDK 36, el stack Docker levantado (pasarela en `127.0.0.1:18000`).
```bash
adb reverse tcp:18000 tcp:18000        # el teléfono (o emulador) ve la pasarela de la laptop como 127.0.0.1:18000
flutter run                            # o: flutter build apk --debug && adb install -r build/app/outputs/flutter-apk/app-debug.apk
```
La pasarela no se publica en la red Wi-Fi: el túnel de adb mantiene el mismo emisor de tokens que la web
(`http://127.0.0.1:18000/identidad/realms/clb`). Para otro despliegue: `--dart-define=CLB_PASARELA=https://...`.
HTTP en claro solo hacia `127.0.0.1`, `localhost` y `10.0.2.2` (`android/app/src/main/res/xml/network_security_config.xml`).

### APK para el despliegue en nube

`configuracion-nube.json` contiene únicamente URLs públicas. El catálogo, los recursos y CatVTON pasan por
`https://api.leonardoserrate.xyz`; los pedidos, gestión GraphQL, reportes, voz y tallas también pasan por esa
pasarela. Azure permite el acceso desde GCP; sus dominios directos son upstreams del servidor, no bases móviles.
Los perfiles y avisos de pedido usan
`https://clientes.leonardoserrate.xyz`. Keycloak usa el emisor
`https://auth.leonardoserrate.xyz/identidad/realms/clb`, cliente público `clb-android`, PKCE y redirección
`bo.clb.store:/oauth2redirect`. Las cabeceras privadas de Cloudflare Access se añaden en la pasarela.

Con Flutter 3.41.9 (Dart 3.11.5), Java 17 y Android SDK 36, desde esta carpeta:

```powershell
./preparar-probador.ps1
flutter build apk --release --target lib/main.dart --dart-define-from-file=configuracion-nube.json --build-name=1.0.10 --build-number=11
```

Para seleccionar un NDK ya instalado, añadir `--android-project-arg=clbNdkVersion=27.0.12077973`; la selección se
aplica también a los plugins nativos. Si Android Studio ofrece otro JDK, Gradle puede fijarse a Java 17 mediante
`GRADLE_OPTS=-Dorg.gradle.java.home="RUTA_DEL_JDK_17"` en el proceso de compilación.

Salida: `build/app/outputs/flutter-apk/app-release.apk`. La compilación local conserva su configuración predeterminada
cuando no se pasan estas variables. La firma de publicación se lee de `android/key.properties` (ignorado por Git),
con `storeFile`, `storePassword`, `keyAlias` y `keyPassword`; conservar este archivo y su JKS para futuras actualizaciones.
Si no existe, la configuración histórica de desarrollo sigue usando la firma debug. Los tokens y secretos de servicios
no forman parte de la configuración de la APK.

Usuario: `cliente.demo` (clave en `infraestructura/bases-de-datos/.env`, igual que en la web). En un emulador nuevo, Chrome
muestra su bienvenida la primera vez: «Use without an account».

## Pruebas
```bash
flutter analyze
flutter test                                        # 90 aprobadas + 3 omitidas en host (ejecutado 9-nov-2026)
CLB_INTEGRACION=1 flutter test test/integracion     # contra el stack real: catálogo, SAGA y misma Idempotency-Key
flutter test integration_test -d <dispositivo>      # en Android: MoveNet con TFLite real y SQLite del sistema
```
La prueba contra el stack crea un pedido real de 1 unidad con `cliente.demo` (como las demostraciones).

## Notificaciones locales (carrito y pedido)

`flutter_local_notifications` funciona sin Internet ni Firebase. Después de guardar el carrito muestra «Producto
agregado» / «Tu prenda se agregó correctamente al carrito.». Un pedido aceptado por Ventas muestra «Pedido registrado» /
«Tu pedido fue registrado correctamente.»; si queda en la cola existente, muestra «Pedido pendiente» /
«Tu pedido fue guardado y se enviará cuando vuelva la conexión.». Un rechazo definitivo/cancelación no anuncia éxito.
Los reintentos, la recuperación de la cola y el refresco no repiten avisos locales. Dos ID/tag propios actualizan los
avisos sin acumular copias, en el canal `clb_operaciones_locales`. El permiso denegado o un error del sistema no
invalidan operaciones ya guardadas. Android 13+ solicita el permiso al abrir la app.

Demo sin red:
1. Descargar el catálogo e iniciar sesión una vez con conexión; aceptar el permiso de notificaciones.
2. Activar modo avión (retirar también `adb reverse` si se usaba la pasarela local).
3. Agregar una prenda: aparece «Producto agregado».
4. Confirmar el pedido: aparece «Pedido pendiente» y se conserva en SQLite.
5. Reconectar: se sincroniza con la cola/idempotencia existente sin repetir el aviso local. Una compra nueva
   aceptada con conexión muestra «Pedido registrado».

No se crean alarmas, colas ni tareas de segundo plano. La implementación FCM existente no cambia.

### Validación de la APK de nube (10-nov-2026)

Release `1.0.12+13`, paquete `bo.clb.store`, instalada con `adb install -r` en Samsung SM-S918U1,
sin desinstalar ni borrar SQLite. Flutter 3.41.9, Java 17, Android SDK 36; si se utiliza el NDK 27 instalado:

```powershell
flutter build apk --release --target lib/main.dart --dart-define-from-file=configuracion-nube.json --build-name=1.0.12 --build-number=13 --android-project-arg=clbNdkVersion=27.0.12077973
```

Ventas e IA se consumen mediante `https://api.leonardoserrate.xyz`: sus hosts directos de Azure están restringidos
al egreso de la pasarela. Keycloak usa `auth.leonardoserrate.xyz/identidad/realms/clb`; Clientes conserva su host
HTTPS propio. No se necesita `adb reverse` ni un backend en la laptop. El loopback del probador RA es un servidor
interno de la propia aplicación que entrega los modelos empaquetados, no un servidor externo.

Comprobado en esa release:
- Recuperación del pedido original pendiente, conservando UUID y clave; confirmado en Ventas. Repetir la misma
  solicitud devuelve el mismo pedido, con las mismas fechas y SAGA, y una sola entrada en el historial.
- Compra nueva de una prenda `[PRUEBA MÓVIL]` y aviso local «Pedido registrado».
- Modo avión con Wi-Fi apagado y sin `adb reverse`: carrito, «Producto agregado», pedido en SQLite y «Pedido pendiente».
  Backend 404 antes de reconectar; después, confirmado con el mismo UUID/clave. Reenvío desde la interfaz sin duplicar.
  Stock de la variante aislada: 10 → 8 por las dos compras, incluso tras reenvíos.
- Login, logout y nuevo login del comprador; login admin; indicadores, productos, saldos, alertas y propuestas.
  Generación de reporte de ventas interpretado por el modelo del servidor y presentado con datos reales.
- RA empaquetada y cámara abiertas en modo avión; no se evaluó exactitud ni calce físico.
- `flutter test --dart-define-from-file=configuracion-nube.json`: 137 aprobadas, 4 omitidas.
  Análisis de los nueve archivos involucrados: sin errores ni advertencias; 12 observaciones de estilo preexistentes.

CatVTON: inicialmente devolvía 503. Se corrigió el generador Nginx de GCP para incluir Host y las credenciales
privadas de Cloudflare Access también en la ruta de trabajos (su `if OPTIONS` impedía el reemplazo genérico).
Configuración validada con `nginx -t` y recargada conservando respaldo privado. Después, `/salud/probador` respondió
200 y una foto de prueba del repositorio llegó a LISTO; la imagen se mostró en el Samsung y permaneció visible
en modo avión. Túnel directo sin Access y trabajos sin JWT: ambos 401. No se publican credenciales en la APK.

Límite comprobado:
El código FCM se conserva y sus pruebas pasan; esta APK muestra push no disponible por falta de configuración local
Firebase, por lo que no se verificó recepción push real en esta instalación. Las notificaciones locales sí se
observaron en NotificationManager de Android, con permiso concedido y los dos ID/tag propios.

## Notificaciones push (Firebase)
`android/app/google-services.json` es configuración local y no se versiona. Obtenerlo en Firebase Console → Configuración
del proyecto → app Android `bo.clb.store` → descargar `google-services.json`, y copiarlo en `android/app/`. Sin ese
archivo el plugin `google-services` no se aplica: la app compila y funciona igual, sin push. Para probar ese camino
aunque el archivo exista: `flutter build apk --debug --android-project-arg=clbSinFirebase=true`.

Firebase se inicializa en segundo plano después de `runApp`. Un fallo (sin configuración, sin Play Services o sin red,
con límite de 10 s) deja el push no disponible y no retrasa el arranque ni el uso offline. No se usa FirebaseMessaging
antes de que Firebase esté listo y el token no se escribe en logs. El permiso solicitado al abrir corresponde a las
notificaciones locales; FCM conserva su flujo de registro del dispositivo y preferencias en Clientes.

## Guion de la demo
### Cola de fotografías (1.0.8+9)

Con sesión iniciada y la prenda descargada, retira el enlace con
`adb -s ID_DEL_DISPOSITIVO reverse --remove tcp:18000`. En el modo fotográfico elige
una foto y pulsa «Generar imagen»: aparece en «Solicitudes de esta prenda»,
guardada en el teléfono. Restaura `adb -s ID_DEL_DISPOSITIVO reverse tcp:18000 tcp:18000`.
Con la app abierta, se reintenta automáticamente con espera exponencial y *jitter* (1–60 s) sin otro clic.
Sin red, con la sesión vencida o con el servidor caído/ocupado no hay tope; un fallo de la generación en el servidor
se reintenta hasta 5 veces y luego pide «Reintentar». Fotos y resultados viven en archivos privados (`clb_vton/`), no
como BLOB en SQLite; cerrar sesión los borra.
Al finalizar, el resultado queda disponible en esa lista y sin conexión.

La nueva base SQLite privada `clb_vton_cola.db` conserva, por cuenta, hasta cuatro
solicitudes pendientes o rechazadas y veinte resultados. Deduplica por titular,
foto, prenda, categoría y versión del motor; los reenvíos recuperan el mismo
trabajo determinista del servidor. Las fotos originales se retiran de la cola
al finalizar; las pendientes pueden eliminarse desde la lista. Al cerrar Android,
el proceso se suspende: no se promete ejecución en segundo plano. Al abrir de nuevo,
se recuperan los trabajos interrumpidos. Los 4xx definitivos quedan para revisión;
errores de red, 401, 429 y 5xx reintentan. «Borrar imágenes locales» elimina resultados,
sin descartar solicitudes pendientes. Cada cuenta ve y envía solo sus solicitudes.

### Catálogo y pedidos

1. Con red: Cuenta → Iniciar sesión (`cliente.demo`). La franja verde dice «Catálogo actualizado · fecha».
2. Modo avión **y** `adb reverse --remove tcp:18000` (el túnel de adb no pasa por la red del teléfono: sin quitarlo, la app
   seguiría llegando a la laptop). La franja pasa a «Sin conexión · catálogo del …».
3. Catálogo → prenda → talla y color → Agregar al carrito → Carrito → Confirmar pedido: queda «En el teléfono, por enviar»
   (insignia cobre en Pedidos). Nunca se muestra como compra hecha.
4. Probar virtualmente → Galería o Cámara: MoveNet corre en el teléfono y la prenda se ajusta; cuatro medidas → talla con
   sus probabilidades (las mismas que el servicio de IA). Pie: «La foto y tus medidas no salen del teléfono».
5. Quitar el modo avión y `adb reverse tcp:18000 tcp:18000`: en segundos el pedido pasa a Confirmado con los pasos de la
   SAGA; luego «Comprobante de venta disponible» (n8n). «Reenviar con la misma clave» devuelve el mismo pedido.
6. En la web, con `admin.demo`, el panel `/gestion` refleja la venta; en PostgreSQL hay un solo pedido para esa clave.

## Decisiones
Decisiones en [docs/decisiones.md](../../docs/decisiones.md). Modelo: MoveNet SinglePose Lightning v4, TFLite float16 (Kaggle
`google/movenet`, Apache 2.0), SHA-256 `0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab` (lo verifica una
prueba). Tipografía de títulos: Gelasio (SIL OFL 1.1, `assets/fuentes/OFL-Gelasio.txt`), compatible en métrica con Georgia.

## RA 3D, administración y gestión (27-oct-2026)
- **RA 3D:** el microfrontend React del probador en una WebView, servido desde `127.0.0.1` por `ServidorProbador`.
  `preparar-probador.ps1` copia el build y BlazePose a `assets/probador/` y verifica los hashes; `preparar-movil.ps1` ya
  lo llama. Sin ese paso `flutter build` falla porque faltan las carpetas de assets.
- **Pestaña «Gestión»** (solo rol admin): `pantalla_gestion.dart`, `pantalla_existencias.dart`, `pantalla_foto_prenda.dart`
  y `microfono.dart`. Datos: `datos/administracion_rest.dart` (GraphQL de gestión para consultas, acciones y procesadores de la cola; REST solo para audio, foto, Excel y previsualización).
  Dominio: `dominio/administracion.dart` (operaciones de existencias y `resolverVersion`).
- **Cola única:** pedidos y cambios de administración (`operaciones`, JSON compatible con las filas anteriores).
- **Pruebas:**
  - `test/dominio/cola_administracion_test.dart` (7) y `test/datos/servidor_probador_test.dart` (4);
  - `test/presentacion/pantalla_probador_test.dart` (+1: vista rápida y modo inicial);
  - contra el stack: `CLB_INTEGRACION=1 flutter test test/integracion/administracion_stack_test.dart`.
