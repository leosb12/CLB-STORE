# Instalación para el equipo

Ejecutar desde la raíz de `CLB-STORE`. Requisitos: Git, Docker con Compose y Python 3.12. Para desarrollar clientes: Node compatible con sus `package.json`; para Android: Flutter y Android SDK según su [guía](../aplicaciones/android/LEEME.md). Descargar dependencias y modelos requiere Internet en la preparación.

## 1. Configuración privada

Copiar `infraestructura/bases-de-datos/.env.example` a `.env` en la misma carpeta. Completar todas las claves vacías con valores locales propios (sin reutilizar claves personales). La clave Laravel usa `base64:` seguido de 32 bytes aleatorios codificados en base64.

En PowerShell, para copiar el ejemplo:

```powershell
Copy-Item infraestructura/bases-de-datos/.env.example infraestructura/bases-de-datos/.env
```

No sobrescribir un `.env` existente. Los cambios de claves en `.env` no rotan usuarios de bases ya creadas. Si el puerto PostgreSQL 5432 está ocupado, cambiar `CLB_POSTGRES_PUERTO`, sin detener otros proyectos. Mantener las publicaciones en loopback.

## 2. Levantar la plataforma

```powershell
docker compose --project-directory infraestructura/bases-de-datos config --quiet
docker compose --project-directory infraestructura/bases-de-datos up -d --build --wait
python infraestructura/identidad/preparar-identidad.py
```

El último comando configura clientes de servicio y las cuentas `admin.demo` y `cliente.demo` con las claves definidas por cada compañero. No importa usuarios privados ni sesiones del equipo original. Para scripts que usan el cliente de demostración, habilitar explícitamente `CLB_IDENTIDAD_DEMOSTRACION=true` **solo en local** y repetir la preparación.

## 3. Cargar prendas sin ventas

Con Inventario vacío:

```powershell
python infraestructura/datos-equipo/preparar.py validar
python infraestructura/datos-equipo/preparar.py importar
```

La importación rechaza una colección existente. No ejecutar `sembrar-gestion.py` para una instalación vacía de ventas: ese script crea compras y clientes de demostración deliberadamente. Las prendas publicadas de la semilla funcionan sin volver a procesar su ingesta.

## 4. Servicios de IA opcionales

La tienda no necesita un modelo generativo para consultar catálogo o comprar. Los agentes necesitan Ollama accesible desde IA y el modelo configurado (`qwen3:8b` por defecto). La voz necesita sus pesos locales. Preparar estos recursos según [IA](../microservicios/inteligencia-artificial/LEEME.md).

Nueva ingesta de prendas: preparar los pesos y habilitar el perfil `prendas` según [probador](probador.md). Foto con IA: GPU y pesos CatVTON, perfil `vton`, según [VTON](../microservicios/inteligencia-artificial/VTON.md). Los pesos grandes no viajan en Git. Esas funciones pueden aparecer no disponibles hasta completar su preparación; no confundirlo con un fallo del catálogo.

## 5. Abrir y probar

- Web/PWA: <http://127.0.0.1:14200>; gestión requiere rol admin.
- Gateway: <http://127.0.0.1:18000>.
- n8n: <http://127.0.0.1:15678> (administración local).
- Android: seguir su guía y seleccionar el dispositivo propio con `adb devices`; no copiar un identificador de otro teléfono.

Esperar una sincronización completa antes de probar offline. Catálogo y recursos descargados, vista rápida y RA se ejecutan localmente. Login inicial, generación de fotos, agentes y nuevos reportes requieren servidor. Las colas reintentan con la app abierta o al volver a abrirla; no se promete ejecución Android permanente en segundo plano.

## 6. Verificación y colaboración

Usar `docker compose --project-directory infraestructura/bases-de-datos ps`. Las suites y demos están descritas por componente; las demos generan actividad y no dejan una base vacía. Para volver a cero, seguir el [reinicio coordinado](../infraestructura/datos-equipo/LEEME.md). Nunca usar `down -v` para limpiar ventas: borraría también usuarios, prendas y modelos.

Antes de un PR: revisar archivos no rastreados, ejecutar pruebas pertinentes, verificar que no se incluyan secretos y describir los cambios y su validación. El [estado](estado.md) diferencia evidencias históricas de comprobaciones nuevas.
