# Estado de entrega y revisión

Actualizado: 10 de noviembre de 2026. Alcance académico: requisitos [R1–R21](requisitos-docente.md), implementación y [trazabilidad](iconix/trazabilidad.md). Las cuentas y datos de ejecución no se versionan. El catálogo limpio está en [datos-equipo](../infraestructura/datos-equipo/LEEME.md). Plan de pulido en curso (temporal): [plan-pulido-final.md](plan-pulido-final.md).

## Implementado

Web/PWA, Android, cuatro microservicios, SAGA de compra, idempotencia y colas offline; SSO, gestión GraphQL/agentes/MCP, reportes por voz/texto y Excel, automatización n8n, ML de tallas/segmentación y tres modos de probador. Administración móvil: existencias, alertas, propuestas e ingesta con cámara/galería y revisión de calidad. Arquitectura e ICONIX tienen fuentes versionadas.

Cambios del 9-nov-2026:
- **R5:** las consultas y acciones de negocio de gestión (reportes, agentes, alertas, productos, variantes, stock e ingesta) pasan por el GraphQL de gestión en web y Android, incluidos los procesadores de las colas offline. IA delega en sus casos de uso y en el contrato REST propietario de Inventario. Audio, fotos y descargas siguen por REST como decisión técnica. Detalle en [backend](arquitectura/backend.md#r5--gestión-empresarial-sobre-graphql-9-nov-2026).
- **Android:** Firebase (push) se inicializa en segundo plano y nunca bloquea el arranque. La app compila y funciona sin `google-services.json`, que no se versiona.
- **Avisos de pedido (F2/F3):** pedido confirmado y pedido cancelado, por Push (FCM) y correo (Resend). Ventas → n8n (flujo C) → Clientes (`notificaciones/`, registro durable, reclamo atómico, reintentos) → proveedor. Android vincula la instalación con la cuenta (Keystore, convergencia en serie también con cambios de cuenta en vuelo), guarda preferencias Push/Correo en la cola offline con versión e Idempotency-Key, ofrece «Permitir notificaciones» y abre «Pedidos» al tocar el aviso. En primer plano emite notificación nativa del sistema arriba (`IMPORTANCE_HIGH`) y SnackBar inferior en simultáneo. Envíos reales: Push habilitado (`CLB_NOTIFICACIONES_HABILITADAS=true`) y correo habilitado (`CLB_NOTIFICACIONES_CORREO_HABILITADO=true`).

## Inteligencia de negocios, 10-nov-2026 (pregunta 5)

Tablero Dash solo web en `/bi/` (Gestión → «Inteligencia de negocios»), con SSO `clb-bi` y el dataset sintético aislado
`demo_bi`: 10.058 registros (1.000 clientes, 3.683 pedidos, 5.319 líneas, 56 existencias), semilla 7 y hash `fdd2f8ff…`.
Guías: [tablero](../aplicaciones/inteligencia-negocios/LEEME.md) y [decisiones](decisiones.md#inteligencia-de-negocios-10-nov-2026).

| Verificación (stack local) | Resultado |
|---|---|
| Aislamiento | `public` (pedidos 110, líneas 146, existencias 166, clientes 17, eventos 124) y `clb_ventas.pedidos` (110) iguales antes y después de generar, entrenar y usar el tablero. Prueba automática equivalente en un esquema temporal |
| Ingresos de octubre de 2026 en `demo_bi` | Tablero **Bs 138.450,00 / 276 pedidos** = reporte con `conjunto: DEMOSTRACION` (total 13.845.000 centavos, también en Excel) = reporte por lenguaje natural («Ingresos de octubre de 2026 del conjunto de demostración»; lo interpretaron las reglas porque la salida del LLM no fue compatible) = misión al agente de reportes (`obtener_indicadores_demostracion`: 138450.00 Bs, 276; el verificador descartó la redacción del LLM y mostró el resumen verificado) = SQL independiente |
| K-Means | k = 5 por silueta (0,577) sobre 981 clientes con compras; regenerar deja la segmentación «pendiente» y reentrenar da el mismo resultado |
| Regresión logística | Modelo operativo sin cambios: exactitud 94,5 % en 400 casos de prueba (1.600 de entrenamiento, sintéticos); simulador → M 89 % |
| SSO y permisos (Playwright, Chrome) | `admin.demo`: Gestión → botón → tablero sin pedir contraseña; `cliente.demo`: «Se requiere rol administrador» (IA 403). 1280 y 390 px sin desborde ni errores de consola |
| Descarga CSV (Playwright) | Dataset completo 5.319 filas; clientes 1.000, pedidos 3.683, líneas 5.319, existencias 56; todos con BOM UTF-8 y `;`. Sin token 401, cliente 403, nombre fuera de lista 422 |
| Pruebas | IA `pytest` 148 aprobadas (5 nuevas de dataset, paridad, invalidación, permisos y misión); tablero 11 (OIDC: `state`, `nonce`, `aud`, `exp`, firma e `iss` rechazados); web `npm test` 78/78 y `npm run build` correcto (aviso previo de presupuesto, 617 kB) |

Pendientes exactos: Azure; CSP para `/bi/` (Dash usa scripts en línea); `realm-clb.json` no incluye `clb-bi`, que lo crea
`preparar-identidad.py`; el formulario de ajuste de la web no ofrece elegir `MES` ni el conjunto (los conserva al
regenerar); la vista de reporte de Angular muestra el aviso genérico de antigüedad de datos también para la demostración.
Las demos crearon tres reportes y dos misiones reales en el historial y la auditoría de IA.

## Inteligencia de negocios en la nube, 10-nov-2026

URL: **https://store.leonardoserrate.xyz/bi/**. El tablero corre en GCP, en la VM de web, Keycloak y pasarela. IA y
`clb_analitica.demo_bi` siguen en Azure. AWS no cambió. Procedimientos y vuelta atrás: [GCP](../infraestructura/gcp/LEEME.md)
y [Azure](../infraestructura/azure/LEEME.md#16-inteligencia-artificial-en-la-misma-vm-backend-ia-clb_analitica-y-worker_prendas).

| Verificación en la nube | Resultado |
|---|---|
| Interrupciones | IA en Azure: 8 s. Web en GCP: unos 8 s. Caddy de Azure y la pasarela de GCP se recargaron sin reiniciarse; Ventas, Keycloak, n8n, Inventario y el probador no se reiniciaron |
| SSO (Chrome real, cuenta admin) | Del botón de Gestión al tablero. Tras cerrar la sesión del tablero, `/bi/ingresar` volvió sin formulario de contraseña. No hay tokens en la URL y la cookie no es visible desde JavaScript |
| Protección sin sesión | `/bi/` redirige a ingresar (PKCE S256, `nonce`, redirección https). Dash interno, CSV y GraphQL dan 401. `/bi/` por `api.` da 400 |
| Ingresos de octubre de 2026 (`demo_bi`) | Tablero Bs 138.450,00 / 276 = reporte desde el tablero (y su Excel: 138450 y 276) = reporte por lenguaje natural (interpretado por reglas) = agente de reportes (138450.00 Bs; redacción del LLM descartada por el verificador) = SQL independiente 13.845.000 centavos / 276 |
| Modelos | K-Means con k = 5 y silueta 0,577. Regresión logística con 94,5 % de exactitud; simulador → M 89 % |
| Aislamiento | `clb_analitica.public` 11/11/123/3/12 y 11 pedidos en Ventas, iguales antes y después. Solo crecieron los reportes de prueba (6 → 9) |
| CSV en la nube | Existencias verificado (56 filas, BOM). Las demás descargas respondieron sin error; Chrome bloqueó las descargas múltiples y no se verificó su contenido en el navegador |
| No ejecutado | Rechazo en el navegador de una cuenta sin rol admin: no había una cuenta así disponible. El 403 está cubierto por pruebas automáticas y en local |

**Segunda entrega (10-nov, 19:2x UTC):**
- **Despliegue.**
  - IA en Azure: imagen desplegada más solo las correcciones de fechas, verificador y diagnóstico; respaldo `clb_ia:azure-previo-fechas`; corte de 9 s.
  - Tablero en GCP: ajuste visual solo de `bi`; respaldo `clb_bi:gcp-previo-visual` y `~/.clb-gcp/respaldos/bi-visual-*`; corte de 8 s.
  - No se reiniciaron otros servicios.
- **Pruebas en la nube**, con resultado leído en el historial de Azure y SQL independiente:
  - **Tablero:** SSO sin contraseña tras reiniciar `bi`; ningún texto de demostración ni técnico; octubre 2026 Bs 138.450,00 / 276; Buzos en octubre Bs 28.829,00; K-Means con 981 puntos sin cambio por filtros; regresión logística con 94,5 % y simulador M 89 %.
  - **Reporte desde el tablero** (`MANUAL`): 13.845.000 / 276 / 581.
  - **Reportes por LLM:**
    - «Ingresos de octubre de 2026» → 13.845.000;
    - «ingresos de octubre» sin año → octubre de 2026, 13.845.000;
    - «ventas por talla de este mes» → `OPERACION`, S 7 / L 2 / M 1, igual que SQL sobre `public`.
  - **Reportes por respaldo de reglas:**
    - «Ingresos de octubre de 2026», con Ollama sin conexión en ese momento → agregado de `MONTO`, 13.845.000;
    - 15/10/2026 → el LLM se salió del catálogo y la observación lo detalla; agregado de `MONTO` 669.700 = SQL.
  - **Pregunta:** «hasta el 15/10/2026» pide la fecha inicial.
  - **Agente:** respuesta del LLM aceptada, «Bs 138,450.00», sin rechazo del verificador.
- **Límite observado:** por LLM, «cantidad de pedidos» se interpretó como unidades.

## Android de nube, 10-nov-2026

APK release `1.0.12+13` instalada y probada en Samsung SM-S918U1 sin borrar datos: pedido original recuperado y
confirmado con la misma identidad, compras online/offline, notificaciones locales independientes de Firebase,
reenvío idempotente, login comprador/admin, gestión y reporte interpretado por el servidor. Ventas e IA usan la
pasarela HTTPS porque Azure restringe el acceso directo. Suite Flutter: 137 aprobadas, 4 omitidas.
Detalle y reproducción en [la guía Android](../aplicaciones/android/LEEME.md#validación-de-la-apk-de-nube-10-nov-2026).
CatVTON: corregidas las cabeceras Host/Cloudflare Access de la ruta de trabajos en GCP; foto de prueba real
procesada a LISTO, presentada en el teléfono y visible en modo avión. Túnel y API rechazan solicitudes sin sus
respectivas identidades. FCM conserva su implementación, pero no se verificó recepción push real por faltar la
configuración local de Firebase. RA y cámara también se abrieron en modo avión.

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

## Despliegue en la nube (auditado el 10-nov-2026)

| Verificación | Resultado |
|---|---|
| Azure `clb-ventas-vm`: Ventas, IA, worker_prendas, `clb_ventas`, `clb_analitica`, Caddy | 6 contenedores arriba (4 con healthcheck, sanos); certificados Let's Encrypt de `ventas` e `ia` válidos hasta 2027-02-08; PostgreSQL sin puertos |
| Tráfico real en 2 h | 8 compras 201 y 6 pedidos `CONFIRMADO`; 6 comprobantes; n8n → eventos 659 × 200; tienda → IA GraphQL 394 × 200; sin `ERROR` en Ventas ni IA |
| Controles de acceso | Sin token 401; rutas internas, `/mcp` y rutas no publicadas → 404 desde IP no autorizada; 443 del NSG solo para el administrador, GCP y AWS |
| GPU por Cloudflare Tunnel | Ollama y VTON 401 sin token de Access; token cruzado 401; IA en Azure → qwen3:8b 200 en 8,7 s; 4 trabajos VTON reales sin errores |
| DNS | Nameservers en Cloudflare; 1.1.1.1 y 8.8.8.8 coinciden en todos los nombres, MX y SPF |

Guías: `infraestructura/azure/LEEME.md` y `infraestructura/tunel-gpu/LEEME.md`.

## Evidencia histórica (27-oct, no re-ejecutada)

| Suite/demo | Resultado reportado |
|---|---|
| Probador web / E2E probador | 63 / 10/10 |
| PHPUnit Inventario | 148/149 (la de reinicio necesita Docker CLI) |
| S23 | RA offline, cámara liberada, stock encolado aplicado una vez |
| Usuario | Buena experiencia RA y Foto con IA; SSO app → Brave sin contraseña repetida |

## Pendientes y límites

- **AWS solicitado el 9-nov:** cuenta `clb-despliegue`, Ohio; EC2, S3 privado y DynamoDB reales creados. Clientes responde por **HTTPS en `clientes.leonardoserrate.xyz:443`** (alternativa `3.136.183.205:443`), certificado público validado, salud y DynamoDB ACTIVO. HTTP por IP solo permite salud; HTTP del dominio redirige a HTTPS; rutas privadas rechazan solicitudes sin identidad. 42 pruebas y siete verificaciones reales de almacenamiento/persistencia, incluida fidelización idempotente con compensación. Recuperación automática ante una versión defectuosa comprobada. Adaptador opcional S3 de Inventario implementado: 71 pruebas de dominio/aplicación/adaptadores aprobadas. Keycloak y las conexiones entre nubes siguen pendientes de sus despliegues externos. Dominio activado tras la migración DNS del usuario a Namecheap; certificado público y renovación Caddy configurados. Tras propagación, DNS normal y HTTPS comprobados desde esta PC y EC2; no se alteró la IP. Operación, evidencias, límites, costo y configuración del dominio en la [guía AWS](../infraestructura/aws/LEEME.md).

- **Inventario en este equipo:** PHP 8.4 y PHPUnit disponibles; se ejecutaron las 71 pruebas sin MongoDB mencionadas arriba. La suite completa con MongoDB/reinicio requiere su entorno y no se declara reejecutada. La suite Playwright de administración debe adaptarse al GraphQL de gestión, porque su montaje no levanta IA.
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
