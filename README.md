# CLB Store

Plataforma académica de tienda de ropa: web Angular/PWA, probador React y app Android Flutter. Cuatro microservicios, compra SAGA, IA local, gestión con agentes, automatización n8n y SSO con Keycloak. Ingeniería de Software II, grupo 5, metodología ICONIX.

## Empezar

1. Seguir la [guía de instalación del equipo](docs/inicio-equipo.md).
2. Cargar el [catálogo limpio](infraestructura/datos-equipo/LEEME.md): 14 prendas, 56 variantes y recursos del probador. No contiene ventas, contraseñas ni perfiles personales.
3. Abrir la tienda en <http://127.0.0.1:14200> y entrar con una cuenta creada en la instalación local.

El repositorio funciona por sí mismo: no necesita la carpeta externa `contexto/` ni historiales de conversaciones. El despliegue incluido es **local**; publicar en Internet requiere configurar HTTPS, identidad, secretos, persistencia y los servicios de IA.

## Componentes

| Componente | Tecnología | Función |
|---|---|---|
| Ventas | Java / Spring Boot / PostgreSQL | Pedidos, SAGA, comprobantes e idempotencia |
| Inventario | PHP / Laravel / MongoDB | Productos, variantes, stock e ingesta de prendas |
| Clientes | TypeScript / NestJS / DynamoDB | Perfiles y fidelización |
| Inteligencia Artificial | Python / FastAPI / PostgreSQL | Analítica CQRS, GraphQL, agentes/MCP y reportes |
| Web | Angular + React | Tienda PWA, gestión y probador |
| Android | Flutter + SQLite | Tienda, gestión y colas offline; RA mediante WebView |

## Documentación

- [Requisitos del docente](docs/requisitos-docente.md) y [trazabilidad ICONIX](docs/iconix/trazabilidad.md).
- [Arquitectura](docs/arquitectura/LEEME.md), [decisiones vigentes](docs/decisiones.md) y [estado y límites](docs/estado.md).
- [Probador](docs/probador.md): RA 3D local, vista rápida 2D local y fotografía generativa en servidor.
- Guías: [web](aplicaciones/web/LEEME.md), [Android](aplicaciones/android/LEEME.md), [React](aplicaciones/probador-virtual/LEEME.md), [automatización](infraestructura/automatizacion/LEEME.md).
- Backend: [Ventas](microservicios/ventas/LEEME.md), [Inventario](microservicios/inventario/LEEME.md), [Clientes](microservicios/clientes/LEEME.md), [IA](microservicios/inteligencia-artificial/LEEME.md), [CatVTON](microservicios/inteligencia-artificial/VTON.md).

## Trabajar en equipo

Crear una rama por cambio; revisar el diff y ejecutar las pruebas del componente modificado. Los scripts de demostración crean operaciones reales en el stack local: ejecutarlos solo cuando se quiera generar actividad. La semilla limpia permite empezar sin esos historiales.

No subir `.env`, volcados de bases, fotos personales, claves, sesiones, APK ni modelos descargados excluidos por Git. Los usuarios locales se conservan al reiniciar operaciones; cada compañero define sus propias contraseñas. Los recursos de terceros conservan su [procedencia](compartido/prendas/CREDITOS.txt); CatVTON y ciertas fotografías tienen restricciones no comerciales, detalladas en sus guías. No se concede una licencia general distinta de las licencias originales de cada recurso.
