# Estado de entrega y revisión

Actualizado: 9 de noviembre de 2026. Alcance académico: requisitos [R1–R21](requisitos-docente.md), implementación y [trazabilidad](iconix/trazabilidad.md). Las cuentas y datos de ejecución no se versionan. El catálogo limpio está en [datos-equipo](../infraestructura/datos-equipo/LEEME.md). Plan de pulido en curso (temporal): [plan-pulido-final.md](plan-pulido-final.md).

## Implementado

Web/PWA, Android, cuatro microservicios, SAGA de compra, idempotencia y colas offline; SSO, gestión GraphQL/agentes/MCP, reportes por voz/texto y Excel, automatización n8n, ML de tallas/segmentación y tres modos de probador. Administración móvil: existencias, alertas, propuestas e ingesta con cámara/galería y revisión de calidad. Arquitectura e ICONIX tienen fuentes versionadas.

Cambios del 9-nov-2026:
- **R5:** las consultas y acciones de negocio de gestión (reportes, agentes, alertas, productos, variantes, stock e ingesta) pasan por el GraphQL de gestión en web y Android, incluidos los procesadores de las colas offline. IA delega en sus casos de uso y en el contrato REST propietario de Inventario. Audio, fotos y descargas siguen por REST como decisión técnica. Detalle en [backend](arquitectura/backend.md#r5--gestión-empresarial-sobre-graphql-9-nov-2026).
- **Android:** Firebase (push) se inicializa en segundo plano y nunca bloquea el arranque. La app compila y funciona sin `google-services.json`, que no se versiona.
- **Avisos de pedido (F2/F3):** pedido confirmado y pedido cancelado, por Push (FCM) y correo (Resend). Ventas → n8n (flujo C) → Clientes (`notificaciones/`, registro durable, reclamo atómico, reintentos) → proveedor. Android vincula la instalación con la cuenta (Keystore, convergencia en serie también con cambios de cuenta en vuelo), guarda preferencias Push/Correo en la cola offline con versión e Idempotency-Key, ofrece «Permitir notificaciones» y abre «Pedidos» al tocar el aviso. En primer plano emite notificación nativa del sistema arriba (`IMPORTANCE_HIGH`) y SnackBar inferior en simultáneo. Envíos reales: Push habilitado (`CLB_NOTIFICACIONES_HABILITADAS=true`) y correo habilitado (`CLB_NOTIFICACIONES_CORREO_HABILITADO=true`).

## Evidencia ejecutada el 9-nov-2026

Resultados en el equipo de desarrollo, con el stack local levantado. Las pruebas de base de datos usan esquemas/tablas temporales `clb_prueba_*`.

| Suite/verificación | Resultado |
|---|---|
| IA `pytest` (`CLB_ANALITICA_PUERTO=5433`) | 85 aprobadas, 3 omitidas (incluye GraphQL de gestión e Inventario delegado) |
| Ventas `mvnw test` / Clientes `npm run probar` | 42/42 · 35/35 (incluye notificaciones con DynamoDB Local real e idempotencia de preferencias) |
| Web `npm test` / `npm run build` | 72/72 · compila |
| Flutter `flutter test` / `flutter analyze` | 120 aprobadas, 4 omitidas · 0 errores ni avisos (46 observaciones informativas de estilo) |
| F3 en estado (`avisos_estado_test.dart`, 14) | Vínculo al iniciar sesión y al renovar el token; logout sin red y convergencia; logout de A + login de B → un solo vínculo; cambio de cuenta y logout con la vinculación en vuelo; una suscripción por flujo; permiso sin apagar/encender; combinaciones Push/Correo; preferencias offline; envío incierto sin reutilizar clave con otro cuerpo; 409; aislamiento por cuenta |
| S23, avisos reales (Push, cuenta `admin.demo`, 5 eventos) | Pedido → Ventas → n8n → Clientes → FCM → S23: primer plano (SnackBar «Ver» → Pedidos), segundo plano y app cerrada normalmente (notificación del sistema; el toque abre Pedidos tras corregir el arranque en frío). Clientes: 5 `ENVIADO` (1 intento), correo `OMITIDO_PREFERENCIA`, eventos históricos sin reenvío. Permiso concedido desde «Permitir notificaciones» |
| S23, preferencias y sesión sin red (sin `adb reverse`) | Cambio de Push guardado en el teléfono y sincronizado a los ~10 s de volver la red (versión 1→2); logout sin red local inmediato, el servidor conserva el vínculo y lo borra a los ~30 s de reconectar; nuevo login pide contraseña y re-vincula; push recibido con el token nuevo. Gestión sin red: «Sin conexión con la tienda: se muestra lo último guardado» |
| Flujos n8n (`CLB_PRUEBA_N8N=1`) / `auditar-autorizacion.py` | 9/9 · todo PASS |
| PWA aislada (`probar-pwa-aislada.py`) | 5/5 en ejecución sola; 4/5 en una corrida previa, en paralelo con otra suite («cierre completo… reconexión real» no llegó a «Catálogo actualizado» en 20 s). Intermitente; causa no determinada |
| S23, arranque en frío en modo avión sin `adb reverse` | APK sin Firebase y APK con Firebase: catálogo guardado y aviso «Sin conexión»; sin token en logcat |
| Reportes F4 (IA `test_reportes_f4.py`, web `gestion.test.ts`) | Columnas extra, filtros, rango, orden, AMBIGUA, Excel y PDF con las mismas filas; PDF de 50 filas en 3 páginas apaisadas |
| Reportes F4, verificación visual web contra el stack (Playwright, Chrome) | Petición ambigua con sugerencias; reporte con interpretación; ajuste con columna «Ventas en Bs»; formulario precargado; 1280 px y 390 px sin desborde; sin errores de consola. Se corrigió en el proceso un fallo al enviar destino desde la UI (`Destino` Literal) |
| GraphQL de gestión contra el stack (lecturas) | Admin lee reportes, propuestas, alertas, auditoría, productos, variantes, movimientos y capacidades; cliente 403; 404 del propietario con su cuerpo; identificador malicioso 422 |
| GraphQL de gestión contra el stack (escrituras, datos `[PRUEBA F1b]`) | 9/9: crear producto/variante idempotentes, modificar, movimiento con la misma clave aplicado una vez, 409 con entidad vigente, mínimo, historial, cliente 403 |
| Integración Flutter contra el stack (`CLB_INTEGRACION=1`) | Pedido real por SAGA; cola de existencias con reconexión, versión encadenada y repetición sin duplicar; ingesta → LISTO → `publicarRecurso` → PUBLICADO (con el worker de prendas arrancado temporalmente; sin él el trabajo queda PENDIENTE) |
| S23, cola offline real (modo avión y sin `adb reverse`) | Entrada pendiente («Pendiente de enviar: +2»), servidor sin cambios; tras restaurar red y túnel se aplicó una vez y no se duplicó al relanzar la app; la operación sobrevivió al cierre de la app sin red. La app se lanzó detrás del bloqueo de pantalla |
| IA caída (`ia_caida_stack_test.dart`) | Con `clb_backend_ia` detenido la operación queda pendiente y reintentable con la misma clave; al volver se aplica una vez |
| S23, Gestión con sesión admin | Las peticiones del teléfono fueron solo `POST /api/v1/graphql` |
| `demo-compra-saga.py` (con logs de Ventas, Inventario y Clientes) | Todo ✓: compra, idempotencia, stock insuficiente, falla real de Clientes con compensación y reversa de puntos al volver |
| `demo-automatizacion.py` | Todo ✓: flujos A y B, n8n caído sin pérdida y sin duplicados al volver |

## Evidencia histórica (27-oct, no re-ejecutada)

| Suite/demo | Resultado reportado |
|---|---|
| Probador web / E2E probador | 63 / 10/10 |
| PHPUnit Inventario | 148/149 (la de reinicio necesita Docker CLI) |
| S23 | RA offline, cámara liberada, stock encolado aplicado una vez |
| Usuario | Buena experiencia RA y Foto con IA; SSO app → Brave sin contraseña repetida |

## Pendientes y límites

- **Bloqueado en este equipo:** PHPUnit de Inventario y la suite Playwright de administración web: PHP no está instalado y la imagen de Inventario no trae dependencias de desarrollo. La suite Playwright de administración además debe adaptarse al GraphQL de gestión, porque su montaje no levanta IA.
- **Pendiente de autorización:** ver en el S23 el aviso de sesión vencida con Gestión abierta. «Sin conexión» ya se vio en el teléfono; el caso vencido está cubierto por `sesion_vencida_test.dart` y por el arranque en frío tras un `invalid_grant`. Forzarlo requiere revocar la sesión en Keycloak con la cuenta administradora del realm (no autorizado en esta sesión) o esperar la caducidad SSO (8 h).
- **Correo real pendiente:** las cuentas demo tienen correos `@clb.local`, no buzones confirmados. Activar `CLB_NOTIFICACIONES_CORREO_HABILITADO=true` solo con una cuenta de prueba cuyo correo sea un buzón controlado, y confirmar la recepción en ese buzón (aceptación de Resend ≠ recepción).
- **Push:** FCM no garantiza la entrega (TTL 1 h, batería, permiso). El aviso usa el icono por defecto de Flutter y el canal `fcm_fallback_notification_channel`. El cambio de cuenta en el teléfono se verificó en pruebas y en el servidor (reasignación atómica), no con una segunda cuenta en el S23.
- Los datos de prueba creados están registrados fuera del repositorio (`contexto/evidencia/2026-11-09-operaciones-prueba.md`); no se borró ningún dato previo.
- Validar la segmentación K-Means con una muestra representativa, incluido el tratamiento de atípicos. Sin ventas no hay datos comerciales suficientes; no sembrar compras ocultamente.
- La medición continua con persona en WebView y calentamiento no equivale al benchmark de una foto en Chrome. Mantener diferenciadas ambas evidencias.
- **Pendiente con el teléfono desbloqueado:** ver en el S23 la interpretación y «Compartir PDF» de la pantalla Reportes (APK instalada; la generación por GraphQL está cubierta por pruebas).
- Fuera de esta etapa: diagramación final en Enterprise Architect y documento institucional; despliegue de producción.

## Antes de compartir

Revisar el diff completo y los no rastreados, ejecutar pruebas según los cambios, validar la semilla y los enlaces, y excluir credenciales/artefactos privados (`google-services.json` está ignorado). La limpieza de datos invalida cachés y colas previas: probar con un perfil limpio. Las demos generan ventas y stock; no ejecutarlas tras el reinicio si se quiere conservar el punto de partida vacío.
