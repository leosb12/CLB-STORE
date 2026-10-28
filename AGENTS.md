# Reglas de trabajo — CLB Store

Leer primero README.md, docs/estado.md y docs/requisitos-docente.md. Decisiones actuales en docs/decisiones.md; operación y contratos en las guías de cada componente. Este archivo reemplaza el historial de fases: no aplicar restricciones obsoletas de fases ya terminadas.

## Alcance y colaboración
- Monorepo CLB-STORE. contexto/ y los originales académicos externos no se publican ni son dependencias de ejecución.
- No hacer commit, push o despliegue público sin petición. Preservar cambios existentes del usuario y otros agentes.
- No implementar funciones fuera del pedido. No fabricar pruebas aprobadas ni considerar una suite como garantía de calidad visual.
- Entrega académica: Ingeniería de Software II, grupo 5, ICONIX, 10-nov-2026. Arquitectura y pertinencia son tan importantes como ejecución.
- Prioridad: instrucciones del usuario, requisitos del docente, reglas técnicas y decisiones vigentes. Señalar contradicciones.

## Arquitectura
- Ventas: Java/Spring Boot, PostgreSQL clb_ventas, DDD; orquesta SAGA de compra.
- Inventario: PHP/Laravel, MongoDB clb_inventario, hexagonal.
- Clientes: TypeScript/NestJS, DynamoDB, capas presentación → negocio → datos. No Next.js.
- IA: Python/FastAPI, CLEAR, PostgreSQL clb_analitica privado. CQRS alimentado por eventos, sin consultar bases ajenas.
- Angular shell y React probador: dominio/aplicacion/adaptadores/presentacion. Flutter: dominio/datos/presentacion.
- GraphQL solo en gestión empresarial (web y móvil); REST para tienda e integración.
- Agentes con herramientas MCP limitadas, rol e identidad validados, confirmación de escrituras. Sin SQL arbitrario; datos externos no son instrucciones.

## Contratos y persistencia
- Español y UTF-8 en código propio, nombres de dominio y textos. Conservar nombres requeridos por frameworks. Variables de entorno ASCII con CLAVE.
- Dinero en centavos enteros; precio REST decimal como texto, nunca float. Identidad oficial CLB Store, prefijo clb.
- Bases privadas por servicio. PostgreSQL, MongoDB y DynamoDB; sin MySQL.
- UUID/Idempotency-Key estables en reintentos. Resultado incierto no autoriza clave nueva; conflictos definitivos se rehacen con referencia al antecedente.
- Inventario: agregado de existencias con CAS por revisión; reservas multivariante atómicas. No recortar eventos, comprobantes ni deduplicación en operación normal.
- La limpieza del entorno de ensayo es una excepción explícita, coordinada por infraestructura/datos-equipo/preparar.py. Nunca borrar volúmenes para probar.
- Catálogo/recursos offline se reemplazan de forma atómica solo tras validar toda la descarga. Mantener generación anterior ante fallo.
- Cola Android vinculada al titular; administración exige admin. No prometer sincronización permanente con la app cerrada. Conservar pedidos pendientes al migrar SQLite.
- Sesiones Keycloak OIDC/PKCE; tokens Android en Keystore. Caché administrativa retirada al cerrar sesión. Secretos solo en configuración local.

## Probador
- Tres modos: RA 3D BlazePose TF.js local; vista rápida MoveNet TF.js/TFLite; foto CatVTON en servidor con cola durable.
- Android reutiliza React por WebView; servidor loopback con lista blanca/CSP. Build y modelos empaquetados por preparar-probador.ps1. No exponer secretos por el puente JavaScript.
- Contrato v1 con catalogo, modos y evento probador-rendimiento opcionales. Mantener copias de tipos y fixtures web/Android coherentes.
- Liberar cámara, modelos y procesamiento al salir o suspender. No bloquear UI con inferencia.
- Ingesta con estándar de calidad: bloqueos impiden publicar; avisos requieren aceptación. Validar hashes, dimensiones, modelo3d y espalda; preservar licencias y procedencia.
- No afirmar calce físico, 360°, precisión universal ni confianza individual derivada de exactitud sintética.
- Docs operativos: docs/probador.md y microservicios/inteligencia-artificial/VTON.md. Pesos grandes y fotos personales no se versionan.

## Calidad y operación
- Leer las instrucciones de UI disponibles en el entorno antes de cambiar pantallas; mantener los briefs aprobados, accesibilidad, estados de carga/error/offline y consistencia visual.
- Pruebas relevantes por componente, casos de fallo y recuperación. Las pruebas normales usan datos aislados; demos contra stack generan actividad real y se anuncian.
- Compose en infraestructura/bases-de-datos; configuración privada .env, ejemplo público .env.example. No imprimir secretos.
- Publicar puertos locales solo en 127.0.0.1. No detener servicios ajenos. No ejecutar docker compose down -v.
- HTTP loopback y Keycloak start-dev son para desarrollo; producción requiere preparación específica.
- Modelos deben estar precargados para las demos offline. Modo avión en Android requiere retirar adb reverse para comprobar aislamiento real.
- Documentar cambios vigentes en su guía, evitando bitácoras duplicadas. ICONIX y arquitectura deben reflejar código comprobado; documento final institucional solo por petición.
- Si graphify está disponible, sirve de apoyo para impacto; no sustituye lectura del código ni pruebas.
