# Auditoría final · CLB Store · Segundo parcial

**10 de noviembre de 2026 · Ingeniería de Software II · Grupo 5**

**14 de 16 cumplen, 2 parciales, 0 no cumplen y 0 no verificables. Cumplimiento completo: 87,5 %.** Las subfilas no cuentan en el denominador. R01–R16 son los IDs de esta auditoría, D1–D21 los del [docente](docs/requisitos-docente.md).

Fuentes: código y contratos, [estado de pruebas](docs/estado.md), [decisiones](docs/decisiones.md), [trazabilidad](docs/iconix/trazabilidad.md), [PDF final de 232 páginas](<C:/Users/Leonardo/Downloads/CLB_STORE_ENTREGA_FINAL/CLB_STORE_ICONIX_FINAL.pdf>) y [proyecto EA](<C:/Users/Leonardo/Downloads/CLB_STORE_ENTREGA_FINAL/CLB_STORE_ICONIX_FINAL.eap>). «p.» identifica páginas físicas del PDF. «EA #» es Diagram_ID, consultado en t_diagram vía ODBC de 32 bits sobre copia temporal del EAP. Se identificaron 97 diagramas por tipo y nombre. La inspección del EAP fue de metadatos y correspondencia con el PDF.

La evidencia actual comprende lecturas HTTPS y autenticación PKCE para una consulta GraphQL. Las demás pruebas se citan con el alcance histórico indicado. No se repitieron suites completas ni se ejecutaron escrituras de negocio. Se preservaron el código, infraestructura, bases y documentos ICONIX.

## Matriz principal

Las rutas son relativas a la raíz. En subfilas, las rutas precedidas por «IA» pertenecen a microservicios/inteligencia-artificial.

| ID | Requerimiento del docente | Estado | Cómo se implementó | Microservicio/componente | Archivo o ruta exacta | Evidencia | Qué falta |
|---|---|---|---|---|---|---|---|
| R01 · D1 | Tres microservicios independientes como mínimo | CUMPLE | Cuatro servicios HTTP con bases de propiedad separada | Ventas, Inventario, Clientes, IA | infraestructura/bases-de-datos/compose.yaml; docs/arquitectura/backend.md | Cuatro rutas de salud 200 hoy. PDF 94–99, 138–141; EA #79–82, #91–93 | Ensayo comercial cloud |
| R02 · D3 | Microfrontends integrados | CUMPLE | Angular carga bundle React y monta clb-probador mediante contrato y eventos | Angular/React | aplicaciones/web/fuente/probador/adaptadores/cargador-probador.ts; aplicaciones/web/fuente/probador/dominio/contrato.ts; aplicaciones/probador-virtual/Dockerfile | Manifiesto 200 hoy; E2E histórico. PDF 100, 148, 166–168; EA #17–19, #31 | Mostrar navegación y carga del módulo |
| R03 · D5 | GraphQL empresarial y REST para tienda/integración | CUMPLE | Consulta y mutación Strawberry; delegación a REST propietario con JWT e idempotencia | IA/Inventario/web/móvil | IA fuente/puertos/graphql.py, esquema_gestion, ConsultaGestion, MutacionGestion, _inventario; microservicios/inventario/rutas/api.php | GraphQL autenticado 200 hoy, lecturas y escrituras históricas del stack. PDF 98–99, 151–154, 164; EA #15, #34–37, #80 | Demostrar consulta de negocio y diferenciarla de REST |
| R04 · D6 | Agentes que ejecuten misiones con herramientas | CUMPLE | Orquestación por misión, herramientas MCP, fuentes, propuesta con confirmación humana | IA y gestión | IA fuente/aplicacion/agentes.py, EjecutarMision y GestionarPropuestas; IA fuente/dominio/agentes.py; infraestructura/demostraciones/demo-gestion-ia.py | Código, prueba de puertos y evidencia histórica. PDF 153, 194–195, 203; EA #25, #36, #40 | Mostrar fuentes de una misión en la defensa |
| R05 · D7–D9 | IA local, offline, sincronización y SAGA | CUMPLE | Inferencia en clientes, colas e idempotencia extremo a extremo, orquestación con compensación | Web, Android y servicios comerciales | Subfilas A–E | PDF 100–102, 123–134, 147–152, 179–194; EA #31–35, #47–49, #54–55 | Diferenciar entorno local y cloud |
| R05-A | IA local Android | CUMPLE | MoveNet TFLite/LiteRT y probador React reutilizado por WebView con loopback | Flutter/WebView | aplicaciones/android/lib/datos/detector_movenet.dart; aplicaciones/android/lib/datos/servidor_probador.dart; aplicaciones/android/lib/presentacion/pantalla_probador.dart | Ensayo S23 y modo avión sin adb reverse. PDF 192–193; EA #19, #31 | Precachear modelos |
| R05-B | IA local navegador | CUMPLE | MoveNet y BlazePose con TF.js, modelos e inferencia locales tras precarga | React | aplicaciones/probador-virtual/fuente/adaptadores/detector-movenet.ts y detector-blazepose.ts | Historial de inferencia offline y hashes. PDF 72, 148, 193; EA #18, #31 | Separar pose local de foto remota |
| R05-C | Offline | CUMPLE | Service Worker, IndexedDB y SQLite, copia activada tras validar descarga | Angular/Flutter | aplicaciones/web/ngsw-config.json; aplicaciones/web/fuente/catalogo/adaptadores/repositorio-local.ts; aplicaciones/android/lib/datos/almacen_sqlite.dart | S23 real; PWA 5/5 aislada, 4/5 en una corrida paralela. PDF 77, 123–134, 187, 192; EA #49, #55, #74–76 | Repetir arranque frío web antes de defensa |
| R05-D | Colas, conflictos y titular | CUMPLE | UUID/Idempotency-Key estable, revisión esperada, conflicto explícito, colas por titular | Web/Android/API | aplicaciones/web/fuente/catalogo/aplicacion/sincronizador.ts; aplicaciones/android/lib/presentacion/estado_tienda.dart; aplicaciones/android/lib/datos/almacen_sqlite.dart | Existencias offline en S23 aplicadas una vez. PDF 181, 187, 207–209; EA #46, #49, #55 | Demostrar pérdida de respuesta y cambio de titular |
| R05-E | SAGA entre tres servicios | CUMPLE | Reserva, puntos, consumo y confirmación con estado durable y compensación | Ventas, Inventario, Clientes | microservicios/ventas/src/main/java/clb/ventas/aplicacion/OrquestadorSagaCompra.java y SagaCompra.java; infraestructura/demostraciones/demo-compra-saga.py | Compra local, caída de Clientes, compensación y repetición. PDF 149–150, 179–180, 186, 193–199; EA #32–33, #47–48, #54 | Ensayo cloud controlado |
| R06 · D10–D11 | Supervisado, no supervisado y DL visual | CUMPLE | Regresión logística, K-Means y redes de pose | IA, React, Flutter | Subfilas A–C | PDF 148, 153, 192–206; EA #18–19, #31, #97 | Datos representativos de talla y segmentación |
| R06-A | ML supervisado | CUMPLE | Regresión logística multinomial entrenada con medidas sintéticas etiquetadas | IA/scikit-learn | IA fuente/infraestructura/aprendizaje.py, ModeloTallasLogistico y conjunto_sintetico; aplicaciones/probador-virtual/pruebas/fixtures/modelo-tallas.json | Exactitud 0,945, 1.600 entrenamiento y 400 prueba sintética. PDF 58–59, 148, 203–206; EA #31 | Validación en medidas reales |
| R06-B | ML no supervisado | CUMPLE | K-Means normalizado, selección por silueta, tratamiento de atípicos y fallback de un grupo | IA/scikit-learn | IA fuente/infraestructura/aprendizaje.py, AgrupadorKMeans._kmeans; IA pruebas/test_dominio_y_aprendizaje.py | Ajuste real en código y prueba. PDF 153, 203–205; EA #36, #96 | Validación representativa comercial |
| R06-C | Deep Learning visual | CUMPLE | BlazePose y MoveNet preentrenados en TF.js/TFLite, CatVTON remoto separado | React, Android, IA | aplicaciones/probador-virtual/fuente/adaptadores/detector-movenet.ts y detector-blazepose.ts; IA VTON.md | Pose offline histórica y salud VTON 200 actual. PDF 143, 148, 155, 182, 192–196; EA #31, #38, #50, #97 | Generar foto real controlada en cloud |
| R07 · D12 | Automatización real | CUMPLE | Sondeo por cursor, tres workflows, persistencia y reintento con identidad estable | n8n, Inventario, Ventas, IA, Clientes | infraestructura/automatizacion/flujos/clbStockBajo0001.json, clbComprobante01.json, clbAvisosPedido1.json; infraestructura/demostraciones/demo-automatizacion.py | Demo A/B con caída y recuperación, push histórico para C. PDF 141–142, 158, 185, 210–213; EA #41, #53, #96 | Probar destinatario controlado en cloud |
| R08 · D13 | Reportes por texto y voz, selección y exportación | PARCIAL | Existe dictado integrado, sin prueba real completa localizada | Web, Android, IA | Subfilas A–C | PDF 64, 75, 154, 195, 210, 223–224; EA #26, #37, #63 | Ensayo real de micrófono hasta reporte |
| R08-A | Reporte textual y fuentes | CUMPLE | Especificación cerrada, ambigüedad, datos de proyecciones y salida persistida | IA | IA fuente/aplicacion/reportes.py; IA pruebas/test_reportes_f4.py | Ensayo web del 9-nov y PDF 195; EA #37 | Mostrar aclaración ambigua |
| R08-B | Voz | PARCIAL | Audio REST → faster-whisper → texto revisable | Web, Android, IA | aplicaciones/android/lib/presentacion/microfono.dart; aplicaciones/web/fuente/gestion/adaptadores/grabadora-voz.ts; IA fuente/infraestructura/voz.py | test_puertos.py usa doble. PDF 195 y 210 excluye voz del ensayo citado; EA #21, #37 | Probar modelo desplegado con audio de ensayo |
| R08-C | Destino de visualización y exportación | CUMPLE | Selector de salida y formatos, pantalla/vista/historial según opción, Excel/PDF y compartir en Android | Web y Flutter | aplicaciones/web/fuente/gestion/presentacion/pagina-gestion.ts y pagina-reporte.ts; aplicaciones/android/lib/presentacion/reporte_v2.dart | Verificación web y pruebas Android. PDF 75, 154, 223–224; EA #37, #63 | Repetir compartir PDF en S23 |
| R09 · D14 | MCP, lenguaje natural y voz | PARCIAL | Protocolo y herramientas reales. Falta acreditar audio real hasta ejecución MCP | IA/gestión | Subfilas A–B | PDF 153–154, 170, 195, 230–231; EA #21, #36–37 | Evidencia integrada de dictado |
| R09-A | Cliente, servidor y herramientas MCP | CUMPLE | Streamable HTTP, token admin, lista blanca y herramientas con argumentos acotados | IA | IA fuente/puertos/mcp.py, crear_servidor_mcp y AutenticacionMcp; IA fuente/infraestructura/herramientas_mcp.py, SesionMcp y HerramientasMcp | Prueba de puertos y demo de misiones. PDF 153, 195, 203; EA #25, #36 | Enseñar nombre de herramienta y autorización |
| R09-B | Voz a herramienta | PARCIAL | Dictado de reporte → GraphQL → generar_reporte por MCP | Web, Android, IA | aplicaciones/web/fuente/gestion/adaptadores/gestion-rest.ts; IA fuente/puertos/rest.py, voz; IA fuente/aplicacion/reportes.py | Tramos en código. PDF 154, 195, 210; EA #37 | Audio real y traza de herramienta en el mismo ensayo |
| R10 · D2 | Tres lenguajes backend | CUMPLE | Java/Spring Boot, TypeScript/NestJS y PHP/Laravel; Python adicional. Sin Next.js en el backend | Backend | microservicios/ventas/pom.xml; microservicios/clientes/package.json; microservicios/inventario/composer.json | Fuente docente registra «N-E-S-T». PDF final 23, 95–97; EA #92–93 | Llevar aclaración de la errata del preliminar |
| R11 · D4 | Angular, React y complementos | CUMPLE | Tienda Angular, probador React, móvil Flutter | Frontends | aplicaciones/web/package.json; aplicaciones/probador-virtual/package.json; aplicaciones/android/pubspec.yaml | Tienda y manifiesto 200 hoy. PDF 22–23, 100, 166–168; EA #17–19, #94 | Mostrar una prenda en ambos clientes |
| R12 · D15 | PostgreSQL, MongoDB y DynamoDB | CUMPLE | Persistencia privada por dueño y adaptadores explícitos | Backend | microservicios/ventas/src/main/java/clb/ventas/infraestructura/persistencia/RepositorioPedidosJdbc.java; microservicios/inventario/config/database.php; microservicios/clientes/fuente/fidelizacion/datos/repositorio-dynamodb.ts; IA fuente/infraestructura/analitica.py | Salud actual y persistencia histórica. PDF 101–113, 115–137; EA #67–78, #95 | Correlacionar operaciones por ID |
| R13 · D16 | Keycloak, OIDC y SSO | CUMPLE | Code/PKCE y AppAuth, sesión reutilizable dentro del navegador, autorización JWT | Keycloak, web, Flutter, servicios | infraestructura/identidad/realm-clb.json; aplicaciones/web/fuente/sesion/adaptadores/sesion-oidc.ts; aplicaciones/android/lib/datos/sesion_keycloak.dart | PKCE real hoy; histórico Android → Brave sin repetir contraseña. PDF 56, 135–136, 145, 169, 190–191; EA #20, #28, #77 | Mostrar roles comprador/admin |
| R14 · D17–D18 | DDD, Hexagonal, CLEAR y niveles | CUMPLE | Ventas aplica DDD, Inventario Hexagonal e IA CLEAR | Backend y arquitectura | Subfilas A–C | PDF 94–143, 213; EA #79–82, #91–97 | Mostrar la separación de responsabilidades en la defensa |
| R14-A | DDD | CUMPLE | Pedido, invariantes, casos de uso y persistencia por contrato | Ventas | microservicios/ventas/src/main/java/clb/ventas/dominio y aplicacion/OrquestadorSagaCompra.java | PDF 97, 150, 160, 197–199; EA #11, #33 | Mostrar estado y compensación |
| R14-B | Hexagonal | CUMPLE | Dominio, casos de uso, puertos y adaptadores REST/Mongo | Inventario | microservicios/inventario/fuente/Dominio, Aplicacion, Puertos, Adaptadores y Configuracion/ProveedorInventario.php | PDF 97, 151–152, 161–162; EA #12–13 | Mostrar sustitución por puerto |
| R14-C | CLEAR | CUMPLE | Separación entre dominio, aplicación, puertos e infraestructura | IA | IA fuente/dominio, aplicacion, puertos, infraestructura/arranque.py; docs/decisiones.md; docs/requisitos-docente.md | PDF 97, 164–165, 170, 213; EA #15–16, #21, #93 | Mostrar el ensamblado de dependencias en arranque.py |
| R15 · D19–D20 | ICONIX y trazabilidad | CUMPLE | Requisitos, dominio inicial/refinado, casos, prototipos, robustez, secuencias, clases, pruebas y trazabilidad | PDF, EA, repo | docs/iconix/LEEME.md y artefactos enlazados arriba | PDF 27–79, 80–93, 144–177, 189–213. EA #1–10, #22–46, #57–66, #83–90. 97 diagramas | Conciliar numeración del repo y del PDF |
| R16 | Plataforma de tienda integrada | CUMPLE | Compra, catálogo, probador, gestión, stock, puntos y eventos conectados | Todos | infraestructura/pasarela/nginx.conf; infraestructura/gcp/Caddyfile; docs/arquitectura/despliegue.md | Compra histórica local y servicios cloud saludables hoy. PDF 19–25, 94–102, 138–143, 186–196; EA #79–82, #91, #96–97 | Ensayo cloud continuo, de pedido a aviso y foto |

## Explicación técnica y guion de defensa

### R01 · Microservicios y límites

| Servicio | Responsabilidad, API y tecnología | Datos propios y ubicación |
|---|---|---|
| Ventas | Java/Spring Boot. REST de pedidos, comprobantes y eventos; orquesta la compra | PostgreSQL clb_ventas en Azure. Pedidos, líneas, avances SAGA y comprobantes |
| Inventario | PHP/Laravel. REST de catálogo, stock, reservas e ingesta de prendas | MongoDB Atlas clb_inventario, backend GCP. Productos, variantes, agregado de existencias, reservas y recursos |
| Clientes | TypeScript/NestJS. REST de perfiles, fidelización y avisos | DynamoDB clb_fidelizacion y clb_archivos, con objetos privados en S3, AWS |
| IA | Python/FastAPI. Gestión GraphQL, REST de integración/binarios y MCP interno | PostgreSQL clb_analitica para proyecciones, reportes, propuestas y auditoría. API empresarial conectada a Azure. CatVTON se alcanza por túnel al servidor GPU |

Cada servicio conserva sus propias reglas y persistencia. Ventas coordina por REST. IA lee eventos y proyecta datos en su propia base. **Defensa:** abrir EA #79–82 y seguir el pedido a través de los tres contratos, sin consultas cruzadas a bases.

### R02 · Microfrontends

Angular carga el manifiesto y módulo React y monta el elemento clb-probador con prenda, capacidades y recursos según el contrato. React usa su build independiente y responde por eventos. Nginx sirve el módulo bajo /probador/ en el mismo origen. **Defensa:** abrir una ficha, lanzar el probador y mostrar su módulo en Network. El manifiesto respondió hoy, mientras que los ensayos de interfaz son históricos.

### R03 · GraphQL y REST

Gestión usa POST /api/v1/graphql con JWT administrativo. Strawberry monta ConsultaGestion y MutacionGestion, incluida ejecutarMision; el adaptador de gestión delega a Inventario respetando identidad, cuerpo y clave. Catálogo y compra son REST; audio, archivos y cargas binarios también. ControladorPedidosHttp.java atiende pedidos en Ventas, y ControladorConsultaProductosHttp.php atiende el catálogo en Inventario. **Prueba actual:** la consulta autenticada { __typename } devolvió {"data":{"__typename":"ConsultaGestion"}}. **Defensa:** contrastar GET /api/v1/productos con la consulta administrativa real en Network; el ensayo histórico registró escrituras, conflictos y rechazo de un comprador.

### R04 · Agentes

El Vendedor usa el rol admin y puede enviar una misión como «Monitorea mi negocio». EjecutarMision dirige monitoreo, reportes, inventario y clientes. Las herramientas disponibles por agente son ventas/stock bajo/alertas, ventas/productos/reportes, productos/stock bajo/propuesta de reposición y segmentos, respectivamente. Ollama participa en selección y redacción; existe respaldo determinista por plantilla. MCP comprueba rol, identidad, argumentos y lista blanca. Proponer reposición no cambia stock; se requiere confirmación humana tras la recepción. **Defensa:** pedir una misión que combine ventas y stock, mostrar fuentes y confirmar una propuesta solo en un ensayo controlado.

### R05 · IA local, desconexión y compra distribuida

- **Android:** con modelos empaquetados, ejecutar MoveNet y mostrar la WebView restringida al servidor loopback. Repetir en modo avión sin adb reverse. El ensayo histórico en S23 mostró catálogo offline, inferencia y liberación de cámara.
- **Navegador:** precargar TF.js, modelos y recursos; abrir el probador sin red. MoveNet y BlazePose inferidos en cliente son distintos de la difusión CatVTON remota.
- **Offline:** IndexedDB/SQLite guardan catálogo y colas; cada generación se activa tras validación. Mostrar reapertura sin red, fecha de copia y cola pendiente. El antecedente de PWA intermitente en paralelo sigue abierto.
- **Sincronización:** mostrar la misma clave al perder respuesta, conflicto por revisión y aislamiento de la cola de la cuenta A al entrar con B. Android conserva operaciones y las reanuda en condiciones previstas; no se acredita sincronización permanente con la app cerrada.
- **SAGA:** Ventas persiste avance, reserva todas las líneas en Inventario, acredita puntos en Clientes, consume stock y confirma. Compensa o reanuda según el estado conocido. La demo local con falla de Clientes verificó compensación. **Defensa:** pedido controlado, correlación de stock/puntos/evento y repetición idempotente. Ensayar caída solo en stack aislado.

### R06 · Aprendizaje

La regresión logística se ajusta a muestras etiquetadas generadas con rangos de tallas y ruido; la tabla fija es su respaldo separado. Los coeficientes normalizados se usan en Dart/TS. K-Means se ajusta sobre filas de clientes y elige k por silueta, con un grupo explícito si los datos son insuficientes. TF.js/TFLite ejecutan modelos preentrenados sobre imagen o video; CatVTON ejecuta difusión remota. **Defensa:** mostrar coeficientes, exactitud del fixture sintético, agrupamiento con silueta y pose en modo offline. Evitar extrapolar 94,5 % a medidas reales o calce individual.

### R07 · Automatizaciones

A · Stock bajo: Inventario → evento/variante/producto → alerta en IA. B · Comprobante: Ventas → evento pedido confirmado → PDF → registro en Ventas. C · Avisos: Ventas → confirmado/cancelado → Clientes → proveedores conforme a preferencias. Triggers programados cada 20 s, cursores persistentes, deduplicación y reintentos. El comprobante es comercial, no factura fiscal; los tres workflows del proyecto se activan por sondeo. **Defensa:** realizar un pedido identificado y mostrar PDF, cursor y aviso controlado. A y B tienen demo histórica de recuperación; el push histórico no prueba correo actual.

### R08 · Reportes generativos

La petición natural se convierte en una especificación cerrada de período, columnas, filtros y orden; si es ambigua, se pide aclaración. Las proyecciones respaldan cifras y el mismo resultado alimenta pantalla, vista/historial y Excel/PDF. Android ofrece pantalla y compartir archivos. El micrófono llama a /api/v1/voz, faster-whisper transcribe en el servidor de IA y el usuario puede corregir el texto antes de enviarlo. **Defensa:** «Ventas de la semana por producto», primero en texto y luego dictado, comparando totales de pantalla, PDF y Excel. La ficha PDF 195 y el resumen p. 210 acotan la evidencia al texto.

### R09 · MCP y voz

crear_servidor_mcp expone obtener_ventas, obtener_productos, obtener_stock_bajo, obtener_alertas, obtener_segmentos, generar_reporte y proponer_reposicion. HerramientasMcp abre sesión con el SDK sobre Streamable HTTP y llama herramientas. El endpoint MCP es interno; las pantallas usan GraphQL y el envío de audio usa REST. La voz llega al MCP por el recorrido de reportes; la caja de misión libre tiene su propio flujo textual. **Defensa:** dictar un reporte y mostrar transcripción, invocación generar_reporte y resultado; ejecutar aparte una misión textual y mostrar herramientas. Queda pendiente el registro de voz real hasta la herramienta.

### R10 · Lenguajes y errata

Los manifiestos verifican Spring Boot, NestJS, Laravel y FastAPI. No se identificó Next.js como backend. La fuente interna del docente registra que deletreó «N-E-S-T» y el PDF final coincide. La mención de Next.js en el enunciado preliminar requiere aclaración si se usa ese enunciado como referencia literal. **Defensa:** mostrar pom.xml, package.json y composer.json y explicar la diferencia.

### R11 · Frontends

Angular sirve tienda y gestión web. React implementa el probador integrado y Flutter es cliente móvil complementario con WebView para el probador. **Defensa:** mostrar una misma prenda en Angular y Flutter y abrir el módulo React, indicando qué parte del build es independiente.

### R12 · Bases

Ventas conecta por JDBC a PostgreSQL. IA mantiene otro PostgreSQL para CQRS. Laravel usa el driver MongoDB con URI TLS en Atlas y CAS del agregado. NestJS usa SDK DynamoDB con escrituras condicionales, además de S3 privado para archivos. PostgreSQL de Keycloak es una base separada; SQLite e IndexedDB pertenecen a clientes offline. **Defensa:** correlacionar el identificador de una compra con stock, puntos y proyección por APIs autorizadas.

### R13 · SSO

Keycloak realm clb emite JWT después de Code + PKCE. Angular y AppAuth gestionan sesión; la cookie del proveedor se reutiliza en el mismo navegador. Las APIs validan tokens y aplican rol/titular según contrato. **Defensa:** entrar por Android y abrir la web desde el mismo navegador; comparar acceso de comprador y Vendedor. Hay prueba histórica app → Brave y PKCE admin observado hoy. El ensayo no implica compartir sesión entre navegadores distintos.

### R14 · Arquitecturas

Ventas concentra el agregado Pedido y sus invariantes en dominio. Inventario separa puertos y adaptadores HTTP/Mongo del caso de uso. IA organiza dominio, aplicación, puertos y dependencias ensambladas en fuente/infraestructura/arranque.py. El usuario confirmó que el requisito del examen es CLEAR. Backend, frontend, datos y despliegue se modelaron por separado. **Defensa:** seguir una solicitud por cada arquitectura y explicar cómo se aplica CLEAR en IA.

### R15 · ICONIX

La entrega materializa requisito → caso de uso → prototipo/robustez → secuencia → clases → pruebas → trazabilidad. El EAP contiene los 13 casos y sus robusteces, modelos inicial/refinado, secuencia SAGA y estados. **Defensa:** seguir CU05 institucional en PDF p. 60, 149–150, 160, 172 y 193–194, con EA #23, #32–33, #11 y #43. Comparar dominio EA #8 y #9/#22. Las fuentes Markdown históricas usan cinco casos principales con extensiones; su CU05 puede ser gestión, mientras que el CU05 institucional es compra.

### R16 · Plataforma integrada

Sesión → catálogo → probador → carrito → pedido → stock y puntos → evento → comprobante/avisos/proyección → gestión. El worker de prendas alimenta el catálogo visual por preparación, revisión y publicación. **Defensa:** reproducir ese recorrido con un pedido de ensayo y mostrar un tramo en Android. Las pruebas locales históricas acreditan integración y las lecturas actuales acreditan disponibilidad de rutas, con alcance distinto de una nueva compra cloud.

## Faltantes priorizados

| Prioridad | Requisito | Problema concreto | Solución mínima | Archivos a modificar | Dependencias | Forma de demostrarlo |
|---|---|---|---|---|---|---|
| 1 | R08 | Falta evidencia real de micrófono a reporte con exportación | Confirmar Whisper precargado y registrar una prueba con audio de ensayo usando el código actual | docs/estado.md y ficha CU09 tras el ensayo; voz.py solo si aparece un fallo | HTTPS, permiso, modelo y datos analíticos | Audio, texto reconocido, pantalla y PDF/XLSX del mismo reporte |
| 1 | R09 | Falta traza de herramienta MCP en el mismo recorrido de voz | Reusar R08 y observar generar_reporte. Si se exige dictar cualquier misión, reutilizar el micrófono para rellenar la misión y mantener envío explícito | docs/estado.md; si se exige dictado libre, pagina-gestion.ts y pantalla_gestion.dart | Admin, MCP interno y Whisper | Audio → transcripción → GraphQL → llamada MCP → resultado |

## Estado real de operación

| Entorno | Implementado, configurado y desplegado | Integración y evidencia de prueba | Operación observada hoy |
|---|---|---|---|
| GCP | Angular/React, Nginx, Keycloak con PostgreSQL, Inventario, n8n | Historial de PKCE, Compose, reinicio y prueba idempotente con Atlas | Tienda, manifiesto, discovery y salud Inventario 200. PKCE admin y consulta GraphQL 200 |
| Azure | Ventas e IA configurados como destinos HTTPS; bases propietarias según despliegue | SAGA local real histórica; lectura autenticada de eventos y avance de cursores observados en integración anterior | Salud Ventas e IA 200 por pasarela. Sin nueva compra cloud ni dictado |
| AWS | Clientes con DynamoDB/S3 y configuración de avisos | Persistencia y fidelización históricas; acceso HTTPS probado | Salud Clientes 200 por pasarela |
| Atlas | M0 clb-inventario con TLS y acceso acotado | CRUD real e idempotencia de Inventario tras reinicio en despliegue anterior | Salud Inventario 200. Sin escrituras de auditoría |
| CatVTON | Túnel con Access y motor GPU externo | Incidente previo 502 desde origen. Evidencia histórica de contrato y ensayos de motor con alcance distinto | /salud/probador 200. Sin generación y descarga nueva |
| Firebase/Resend | Configuración en Clientes AWS, ajena al alojamiento de tienda | Push histórico en S23; OAuth FCM y lectura Resend comprobados en integración anterior | Sin envío real en esta auditoría. El 200 de Clientes no acredita entrega |
| n8n | Tres flujos versionados y persistencia. URLs directas a Azure | Recuperación A/B histórica, C con push histórico y cursores observados anteriormente | Destinos saludables. No se generaron eventos nuevos |
| Android | Flutter, Keycloak, SQLite y modelos locales | Ensayos históricos con APK y teléfono físico | Sin nueva ejecución en el teléfono |

## Evaluación final

| Estado principal | Cantidad | IDs |
|---|---:|---|
| CUMPLE | 14 | R01–R07, R10–R16 |
| PARCIAL | 2 | R08, R09 |
| NO CUMPLE | 0 | — |
| NO VERIFICABLE | 0 | — |

**Cierre mínimo:** un ensayo real de voz → reporte → MCP. Llevar también la referencia que corrige Next.js/NestJS. D17 queda respaldado por los cuatro niveles del PDF/EA y D20 por el entregable escrito disponible; D21 es fecha de presentación y queda fuera de los 16 requisitos técnicos.

**Diferencias documentales:** el README ICONIX marca EA pendiente, pero el EAP final existe y contiene 97 diagramas. La numeración histórica del repo difiere de la institucional. El preliminar dice Next.js y el código/PDF final dicen NestJS. El dictado está en el código, pero la ficha principal de reporte documenta una prueba textual. El mapa de despliegue PDF p. 138–141 describe un estado fechado; las verificaciones actuales se registran arriba.

**Orden sugerido de defensa:** EA y propiedad de bases → SSO → catálogo y probador offline → pedido de ensayo y SAGA → comprobante y n8n → misión y reporte dictado → trazabilidad CU05/CU08/CU09.
