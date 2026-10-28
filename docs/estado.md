# Estado de entrega y revisión

Actualizado: 27 de octubre de 2026. Alcance académico: requisitos [R1–R21](requisitos-docente.md), implementación y [trazabilidad](iconix/trazabilidad.md). Las cuentas y datos de ejecución no se versionan. El catálogo limpio está en [datos-equipo](../infraestructura/datos-equipo/LEEME.md).

## Implementado

Web/PWA, Android, cuatro microservicios, SAGA de compra, idempotencia y colas offline; SSO, gestión GraphQL/agentes/MCP, reportes por voz/texto y Excel, automatización n8n, ML de tallas/segmentación y tres modos de probador. Administración móvil: existencias, alertas, propuestas e ingesta con cámara/galería y revisión de calidad. Arquitectura e ICONIX tienen fuentes versionadas.

## Evidencia reportada al cerrar el plan móvil

Estas cifras pertenecen al ensayo del 27-oct anterior a la preparación para compartir, no a una ejecución nueva de todas las suites:

| Suite/demo | Resultado reportado |
|---|---|
| Flutter | 87 pruebas, más integración contra el stack |
| Web / probador | 69 / 63 |
| E2E probador / PWA aislada | 10/10 / 5/5 |
| Ventas / Clientes | 42 / 21 |
| Flujos n8n | 8 + 1 |
| S23 | RA offline, cámara liberada, stock encolado aplicado una vez |
| Usuario | Buena experiencia RA y Foto con IA; SSO app → Brave sin contraseña repetida |

Se reportaron correcciones de M03–M06/B01 y revisión de seguridad/código. No equivalen a una auditoría de producción. El detalle técnico está en las guías de componentes.

## Pendientes y límites

- Repetir demo SAGA con servicios saludables y guardar logs: una corrida falló tras redesplegar Ventas sin conservar el error; la siguiente pasó.
- Validar segmentación K-Means con una muestra representativa, incluido tratamiento de atípicos. Sin ventas no hay datos comerciales suficientes; no sembrar compras ocultamente.
- Medición continua con persona en WebView y calentamiento no equivale al benchmark de una foto en Chrome. Mantener diferenciadas ambas evidencias.
- La prueba de Inventario que reinicia MongoDB requiere Docker CLI/socket; no atribuirle aprobación si se omite.
- Documento final institucional y despliegue de producción quedan fuera de esta preparación.

## Antes de compartir

Revisar el diff completo y los no rastreados, ejecutar pruebas según los cambios, validar la semilla y los enlaces, y excluir credenciales/artefactos privados. La limpieza de datos invalida cachés y colas previas: probar con un perfil limpio. Las demos generan ventas y stock; no ejecutarlas tras el reinicio si se quiere conservar el punto de partida vacío.
