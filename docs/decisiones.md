# Decisiones vigentes

Este registro sustituye las decisiones por fases y notas de conversaciones. Describe el alcance actual, no una aprobación del docente ni una certificación de producción.

## Arquitectura

- Cuatro servicios: Ventas con DDD, Inventario hexagonal, Clientes en capas clásicas y IA con CLEAR (Clear Architecture de Joschi Kuphal, basada en Clean Architecture). La interpretación de CLEAR debe confirmarse si el docente utiliza otra denominación.
- GraphQL solo en gestión empresarial, incluida la gestión Android; tienda y comunicación entre servicios por REST. Cada servicio posee sus datos. El modelo CQRS `clb_analitica` recibe eventos con cursores; no consulta las bases de otros servicios.
- Angular es el shell y React el microfrontend del probador. Flutter conserva dominio, presentación y datos separados.
- Compra como SAGA entre Ventas, Inventario y Clientes. La devolución es una extensión futura; el ejemplo del docente no obliga a implementar dos SAGA.
- n8n coordina stock bajo → alerta y pedido confirmado → comprobante con tres servicios. No se integró WhatsApp; el dominio justifica los dos procesos locales. Comprobante no equivale a factura fiscal.

## Probador y móvil

- RA 3D: mismo componente React en Angular y WebView Android; assets y modelos locales con hashes. Android sirve esos assets en loopback con lista blanca y CSP, sin exponer la API del backend por ese servidor.
- Vista rápida: superposición aproximada con MoveNet TF.js/TFLite; puede mostrar puntos corporales. No simula tela ni garantiza calce físico.
- Foto con IA: CatVTON en el servidor, cola durable separada de las compras, caché por titular y borrado de solicitudes. Puede guardar pendientes sin red, pero generar exige acceso al worker.
- Conjuntos disponibles según el modo; no se promete paridad total con la vista rápida nativa. No afirmar reconstrucción 360° ni precisión universal de color.
- La RA analiza una copia de hasta 640 px y puede cambiar de full a lite. Las cifras 8,6/10,4 estimaciones por segundo son de una foto en Chrome del S23; el usuario confirmó buena experiencia en vivo. No presentarlas como FPS de renderizado de la WebView.
- Se recuerda el modo elegido; RA inicial condicionada a rendimiento medido. Probador móvil claro para mantener coherencia con la WebView. Cámara y procesamiento se liberan al salir/minimizar/cambiar de modo.
- Sugerencia de talla según medidas ingresadas. La exactitud de evaluación sobre datos sintéticos no es confianza individual ni validación clínica/comercial de tallaje.
- Ingesta: informe de calidad, bloqueos no publicables y avisos que exigen aceptación. Modelo 3D y espalda solo cuando la preparación es válida. Las fotografías y modelos conservan sus licencias.

## Sesión y operaciones

- Keycloak con OIDC/PKCE. AppAuth utiliza el navegador del teléfono; la prueba confirmada fue app → Brave sin repetir contraseña. Compartir cuenta no implica compartir cookies entre navegadores o dispositivos. No hay logout global inmediato por back-channel.
- Cola de pedidos/administración por titular; acciones admin requieren rol vigente. Claves y UUID estables. Conflicto definitivo permite rehacer; resultado incierto solo reintenta con la misma clave.
- Gestión offline muestra una copia fechada. Misiones, reportes, confirmación de reposición e ingesta/publicación requieren servidor. Alertas atendidas y movimientos pueden encolarse. Datos administrativos se retiran al cerrar sesión.
- La voz genera texto editable; micrófono solo si hay soporte de grabación y conexión. Los resultados de agentes preceden a los detalles de herramientas; escrituras requieren confirmación.
- Seguridad MCP: lista blanca, identidad/rol, esquemas cerrados, sin SQL arbitrario; datos y respuestas externas no son instrucciones.

## Límites operativos aceptados

- La resolución de dependencias de la cola administrativa puede releer filas por operación (costo cuadrático). Optimizar si crece el volumen, con pruebas que preserven pedidos e idempotencia.
- n8n no guarda ejecuciones exitosas; las fallidas tienen retención limitada. La retención no garantiza ausencia de tokens en fallos: revisar el detalle vigente en su guía antes de publicar.
- K-Means incluye tratamiento de atípicos. Su utilidad debe evaluarse con actividad representativa; un catálogo sin ventas no debe fabricar segmentos o métricas.
- Producción pendiente: dominio/HTTPS, Keycloak sin `start-dev`, secretos, respaldos/restauración, capacidad IA, observabilidad y APK firmada. La entrega local no equivale a despliegue comercial.
- El documento final institucional (EA/StarUML/Word/PDF) se prepara cuando el usuario lo solicite; los Markdown/Mermaid son fuentes técnicas editables.
