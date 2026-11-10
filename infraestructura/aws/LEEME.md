# AWS de CLB Store

Cuenta **445817183267**, perfil de operador **clb-despliegue**, región **Ohio (`us-east-2`)**. No usar el perfil `default`: apunta a otra cuenta. El 9-nov-2026 se verificaron inicialmente USD 100 de créditos y después AWS informó **USD 120 disponibles**, plan FREE y vencimiento del plan el 9-may-2027; volver a consultar el saldo antes de asumir cobertura. Las políticas de la organización deniegan las operaciones probadas en Virginia y São Paulo. No se modificaron esas políticas.

## Recursos y acceso

| Recurso | Ubicación |
| --- | --- |
| Backend público comprobado | **`https://clientes.leonardoserrate.xyz:443`**; alternativa `https://3.136.183.205` |
| Salud sin autenticación | `GET /salud` |
| EC2 | `i-08fefc69b6d4ba523`, Ubuntu 24.04 ARM64, t4g.micro, IP estable `3.136.183.205` |
| Stack | [CloudFormation clb-store-aws](https://us-east-2.console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks) |
| Datos de clientes | [DynamoDB clb_fidelizacion](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#table?name=clb_fidelizacion) |
| Registro de archivos | [DynamoDB clb_archivos](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#table?name=clb_archivos) |
| Archivos funcionales | [S3 clb-store-archivos-leonardoserrate](https://s3.console.aws.amazon.com/s3/buckets/clb-store-archivos-leonardoserrate?region=us-east-2&tab=objects) |
| Paquetes de actualización | `s3://clb-store-despliegues-leonardoserrate/CLIENTES/` (expiran a los 30 días) |
| Presupuesto | `clb-store-mensual`, USD 12/mes antes de créditos; avisos a `playstsb@gmail.com` |

**Estado de Internet:** `https://clientes.leonardoserrate.xyz/salud` devuelve HTTP 200 y DynamoDB ACTIVO desde EC2 usando DNS normal. Let's Encrypt emitió un certificado público para el dominio, SAN correcto, vencimiento **7-feb-2027 23:19:37 UTC**, con renovación automática por Caddy. Desde esta PC se verificaron cadena, nombre del dominio y TLS 1.3, primero contra su IP fija y finalmente usando la resolución DNS normal de Windows, sin omitir la validación TLS. El acceso alternativo `https://3.136.183.205/salud` también funciona y conserva un certificado independiente de 160 horas; ver [certificados de IP de Let's Encrypt](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability). Caddy está habilitado al arrancar y conserva certificados en su almacenamiento persistente local.

HTTP por dominio redirige a HTTPS. HTTP por IP solo permite salud y la redirección de raíz a salud; las operaciones privadas o solicitudes con `Authorization` reciben **426**. Una cabecera enviada por HTTP ha viajado sin cifrar: nunca enviar un token real al puerto 80. En HTTPS, los endpoints privados sin token o con token inválido reciben **401**. Node escucha exclusivamente en `127.0.0.1:3000`; el grupo de seguridad no abre 22 ni 3000.

## Dominio y certificado (activados)

El usuario migró la delegación a **Namecheap BasicDNS** y autorizó conectar el dominio. Google y Cloudflare por DNS-over-HTTPS devuelven `A clientes → 3.136.183.205`; Cloudflare también muestra `dns1.registrar-servers.com` y `dns2.registrar-servers.com`. Google aún conservaba NS de Cloudflare en una caché distinta. Durante la propagación, el DNS habitual de esta PC (`10.5.205.1`) devolvía NXDOMAIN incluso tras limpiar la caché de Windows. **Al cierre ya resolvía el A correcto y `curl`/Python accedieron por el dominio normalmente**, sin `--resolve`, cambios de DNS de la PC ni hosts. No fue necesario cambiar la IP.

Conservar **Namecheap → Advanced DNS → A · clientes · 3.136.183.205 · TTL Automatic**, sin AAAA hacia otro servidor. No cambiar raíz, MX, SPF ni otros subdominios. No se creó `auth` ni se modificaron registros DNS en esta ejecución. Para reaplicar y verificar Caddy:

```powershell
python infraestructura/aws/configurar-acceso.py --dominio clientes.leonardoserrate.xyz
curl.exe --fail https://clientes.leonardoserrate.xyz/salud
python infraestructura/aws/verificar.py
# Si el DNS local aún devuelve NXDOMAIN, comprobar TLS PARA EL DOMINIO sin cambiar DNS:
curl.exe --fail --resolve clientes.leonardoserrate.xyz:443:3.136.183.205 https://clientes.leonardoserrate.xyz/salud
```

El script **no modifica DNS**: valida y recarga Caddy, conserva HTTPS por IP y el host del dominio. Sin argumentos también conserva ambos. Caddy obtiene el certificado SSL/TLS público gratuito y lo renueva sin cron ni Certbot. Mantener 80/443 abiertos y `/var/lib/caddy` persistente; revisar `journalctl -u caddy` si ACME falla. No usar `-k` para verificar HTTPS. Fuente: `configurar-acceso.py`; configuración aplicada: `/etc/caddy/Caddyfile`. Para retirar deliberadamente el host de dominio sin tocar DNS: `python infraestructura/aws/configurar-acceso.py --solo-ip`.

Los consumidores usan `CLB_CLIENTES_URL=https://clientes.leonardoserrate.xyz` y `CLB_ARCHIVOS_URL=https://clientes.leonardoserrate.xyz`. Agregar los orígenes HTTPS reales de la web a CORS de Clientes y S3 si difieren de los reservados; no usar comodín.

No volver a alternar nameservers para intentar acelerar la caché. Las consultas al puerto 53 desde esta red devolvían respuestas recursivas antiguas incluso al apuntar a servidores autoritativos; se contrastó con DNS-over-HTTPS y EC2. La automatización de Chrome se detuvo al no poder determinar su URL de forma segura. No se modificaron ajustes del navegador, DNS de la PC ni hosts.

Preservar el correo existente: MX @ `eforward1/2/3.registrar-servers.com` prioridad 10, `eforward4.registrar-servers.com` prioridad 15 y `eforward5.registrar-servers.com` prioridad 20; TXT @ `v=spf1 include:spf.efwd.registrar-servers.com ~all`. Esto no es una exportación completa de la zona. No se modificaron esos registros.

## Actualizar desde esta PC

Desde la raíz del repositorio, con Node >=22, Python y AWS CLI v2:

```powershell
python infraestructura/aws/desplegar.py
```

El comando valida la cuenta, ejecuta `npm ci`, compila TypeScript localmente, empaqueta solo `package*.json`, `dist/fuente` y el verificador AWS, sube el paquete privado, comprueba SHA-256, instala dependencias de producción en una carpeta nueva y cambia el enlace `actual` de forma atómica. No publica `contexto/`, `.env`, fotos personales ni credenciales. SSM ejecuta la actualización; no hay llave SSH.

`systemd` reinicia Node ante fallos y al arrancar el sistema. Si la nueva versión no recupera `/salud` con DynamoDB ACTIVO, el actualizador restablece la versión anterior y comprueba su salud. La versión en servicio continúa funcionando mientras se instalan las dependencias de la candidata. Un cerrojo impide dos actualizaciones simultáneas.

```powershell
# Volver manualmente a la versión anterior, con verificación pública al finalizar:
python infraestructura/aws/desplegar.py --volver

# Ensayo explícito: genera una candidata que falla al arrancar y exige recuperación:
python infraestructura/aws/desplegar.py --probar-recuperacion
```

El ensayo causa una interrupción breve mientras el actualizador detecta el fallo. No ejecutarlo durante la presentación. Si AWS indica que la sesión de operador venció, renovar la sesión con `aws login --profile clb-despliegue`; las credenciales del servicio se renuevan automáticamente mediante el rol EC2. Ante un resultado SSM incierto, revisar su comando antes de repetir; el paquete y su SHA-256 quedan en `datos-locales/ultima-actualizacion.json`.

La comprobación pública usa el dominio HTTPS de forma predeterminada. Si el DNS local devuelve NXDOMAIN, `acceso_publico.py` lo informa y comprueba el dominio contra la IP del stack, conservando Host/SNI y la validación del certificado. No modifica DNS ni hosts. El verificador también consulta la URL por DNS normal desde EC2. Alternativa de operación: `--url https://3.136.183.205`.

Para infraestructura, `python infraestructura/aws/aprovisionar.py` muestra las salidas; `--aplicar` crea o actualiza el stack y `--presupuesto` crea el presupuesto si falta. `plantilla.py` es la fuente declarativa; `preparar-servidor.sh` instala una instancia nueva con HTTP limitado a salud. Tras el primer despliegue ejecutar `python infraestructura/aws/configurar-acceso.py` para activar HTTPS por dominio e IP. Los cambios de bootstrap no se aplican con el comando de actualización del backend; revisar cualquier cambio CloudFormation de EC2 antes de ejecutarlo porque puede interrumpir la instancia.

## DynamoDB: qué contiene cada tabla

`clb_fidelizacion` utiliza `pk` (string) + `sk` (string). Índice `clb_por_cliente`: partición `identificador_cliente`, orden `fecha`, proyección ALL. Es el esquema requerido por los repositorios reales de Clientes:

| Clave de partición | Clave de orden | Contenido |
| --- | --- | --- |
| `PEDIDO#id` | `ACREDITACION` / `REVERSA` | Movimientos SAGA |
| `CLIENTE#id` | `SALDO` | Saldo entero |
| `CLAVE#uuid` | `CLAVE` | Huella y respuesta idempotente |
| `PERFIL#sub` | `PERFIL` | Nombre, teléfono, medidas, versión y fecha |
| `PERFIL#sub` | `CUENTA` / `CONTACTO` / `NOTIF#PREFERENCIAS` | Datos de notificación y preferencias |
| `PERFIL#sub` | `DISPOSITIVO#instalacion` | Vínculo con instalación |
| `INSTALACION#id` / `TOKEN#hash` | `DISPOSITIVO` / `TOKEN` | Exclusividad y convergencia de dispositivos |
| `ENVIO#evento` | Canal | Registro durable, reclamo, reintentos y estado de envío |

No hacen falta tablas adicionales por módulo: las transacciones del código utilizan esta tabla única. Los identificadores permanecen en sus datos; no forman rutas de S3.

`clb_archivos` utiliza `identificador` (string, UUID v4 de la subida). Índice `clb_por_titular`: partición `titular`, orden `fecha`, proyección ALL. Guarda `descripcion`, `tipo`, `mime`, `bytes`, `sha256`, `origen`, `referencias`, `objeto`, **`ruta_s3`**, `fecha`, `huella` y `estado`. Es un registro técnico de almacenamiento propiedad de Clientes; no sustituye MongoDB, PostgreSQL ni los perfiles.

Ambas tablas usan capacidad bajo demanda, cifrado AWS, protección contra eliminación y recuperación a un punto del tiempo de 7 días. No hay TTL ni recorte de claves idempotentes. En la consola, abrir **Explore table items** para consultar datos; para recuperar archivos buscar su descripción o `ruta_s3` en el registro. No compartir capturas que contengan teléfonos, medidas o tokens FCM.

## Archivos: organización y contrato

No se crean carpetas vacías. Estos son los destinos admitidos; aparecen en S3 solo al recibir objetos:

```text
PRODUCTOS/FOTOGRAFIAS/
PRODUCTOS/ORIGINALES/
MODELOS-3D/TEXTURAS/
MODELOS-3D/PRENDAS/
PROBADOR-VIRTUAL/FOTOS-ORIGINALES/
PROBADOR-VIRTUAL/RESULTADOS-IA/
REPORTES/EXCEL/
REPORTES/PDF/
COMPROBANTES/PDF/
COMPROBANTES/EXCEL/
```

Cada nombre contiene descripción, fecha y hora UTC con milisegundos y sufijo de seis letras. Ejemplo **real**, subido y descargado con SHA-256 idéntico:

```text
s3://clb-store-archivos-leonardoserrate/PRODUCTOS/FOTOGRAFIAS/polera-gris-jaspeada-frontal-de-demostracion_2026-11-09_23-31-02-123_UTC_vsvlzr.png
```

SHA-256 `ad3ff0218b8db365e6b9167a931e7ee07b2d16366c6bf38037a0dc27f798d02e`, 837824 bytes. Procedencia y licencia CC BY-NC 4.0 permanecen en `referencias` (PNGimg.com/image/5448); es material de demostración académica. El registro de ejemplo tiene identificador `4871a351-5d76-44ab-9a54-cf8a425d6af6`. La descripción del nombre nunca se construye a partir de un ID de producto, titular u operación. UUID, hashes y cadenas numéricas largas se rechazan como descripción.

El bucket bloquea todo acceso público, utiliza propietario obligatorio, AES256 sin claves KMS con costo adicional, exige TLS y rechaza PUT sin escritura condicional. Se utiliza `If-None-Match: *`: los reintentos no sobrescriben objetos. Las URLs duran 300 segundos y son credenciales temporales: no pegarlas en documentación, logs ni chats.

| Operación REST | Resultado |
| --- | --- |
| `POST /api/v1/archivos/subidas` + `Idempotency-Key: UUID-v4` | Registro PENDIENTE, ruta exacta y PUT firmado |
| `POST /api/v1/archivos/{id}/confirmar` | HEAD comprueba tamaño, MIME, SHA-256 y referencia; marca DISPONIBLE y registra la ruta en logs |
| `GET /api/v1/archivos/{id}` | Metadatos y ruta permanente |
| `GET /api/v1/archivos/{id}/descarga` | GET firmado si está DISPONIBLE |
| `GET /api/v1/archivos?cursor=...` | Últimos 50 del titular y cursor para continuar |
| `DELETE /api/v1/archivos/{id}` | Borrado repetible; conserva el comprobante de ubicación con estado BORRADO |

Preparar una subida requiere `{tipo, descripcion, mime, bytes, sha256, origen, referencias?}`. `tipo`: `producto`, `original-prenda`, `textura`, `modelo3d`, `foto-probador`, `resultado-probador`, `reporte-excel`, `reporte-pdf`, `comprobante` (PDF) o `comprobante-excel`. `origen`: `web`, `android` o `microservicio` (dato declarado; la identidad se obtiene del JWT). Formatos PNG/JPEG, PDF, XLSX y GLB según función; límite 20 MiB. Las validaciones de dimensiones, calidad y publicación siguen a cargo del servicio propietario: una carga técnica no publica una prenda.

El llamador debe guardar la clave ANTES de preparar la subida y reutilizarla después de desconexiones, expiración de URL o respuesta incierta. Mismo contenido y clave devuelven la misma ruta; otro cuerpo devuelve 409. La huella no depende del orden de los campos JSON. Un 412 en PUT significa que existe el objeto: confirmar verifica que sea exactamente el registrado. No generar otra clave para el mismo intento incierto.

El titular puede subir su foto del probador y leer/borrar sus archivos. Productos, texturas, modelos, resultados, reportes y comprobantes requieren `admin` o `servicio`. Un servicio ve los archivos que él registró; un administrador puede recuperar metadatos de otro titular mediante ID. Un cliente ajeno recibe 404. Los tokens se validan por firma RS256, `exp`, emisor, sujeto y audiencia `clb-api`.

El cliente Python de referencia no necesita SDK ni claves AWS:

```powershell
# CLB_TOKEN: token OIDC vigente, proporcionado por el flujo de sesión o servicio.
# Guardar una UUID v4 de la operación antes del primer intento y reutilizarla.
python infraestructura/aws/archivos.py foto.png --descripcion "camiseta negra frontal" --tipo producto --mime image/png --clave <UUID-V4-PERSISTIDA>
```

Imprime la ruta exacta y la registra localmente en `datos-locales/archivos.jsonl`. El registro principal permanece en DynamoDB. Web y Android pueden seguir el mismo contrato con su token vigente: mostrar `archivo.ruta_s3` después de confirmar y guardar `identificador`, `ruta_s3` y la clave en el comprobante local. No guardar URLs firmadas como enlaces permanentes ni incluirlas en el catálogo offline.

## Auditoría de productores y consumidores

| Componente y fuente comprobada | Archivos actuales | Relación con AWS |
| --- | --- | --- |
| Inventario, `fuente/Aplicacion/GestionarRecursosProbador.php`, `Adaptadores/Salida/ArchivosCompartidos.php` | Original JPEG/PNG, textura RGBA, maestro, espalda; lectura por hash y publicación explícita | Adaptador opcional implementado: usa API de Clientes y PUT/GET firmados, muestra `almacenamiento` con rutas S3 en el resultado del trabajo. Conserva clave durable, integridad y control de publicación. Activación pendiente de Keycloak/secretos y despliegue del propietario |
| IA, `infraestructura/worker_prendas.py`, `preparar_prenda.py`, `modelo_prenda_3d.py` | Procesa fotos y genera texturas/modelo paramétrico; entrega resultados a Inventario | No lee DynamoDB. Transferencia por REST; el modelo paramétrico actual no obliga a inventar archivos GLB |
| IA, `infraestructura/trabajos_vton.py`, `puertos/probador.py` | Originales personales en memoria, resultados PNG en volumen privado/SQLite, eliminación por titular y caducidad | La nueva API admite originales/resultados, pero no archiva automáticamente fotos personales ni cambia su retención. Integrar almacenamiento externo requiere preservar borrado y vencimiento |
| IA, `puertos/rest.py`, `infraestructura/excel.py`, `pdf.py` | Audio de entrada para voz; XLSX y PDF generados al descargar, desde datos de reporte en PostgreSQL | No necesitan otra base de negocio. No archivar audio temporal automáticamente. Puede archivarse una exportación explícita mediante la API; no se vuelven a calcular bytes durante el reintento |
| Ventas, `ControladorComprobantesHttp.java`, dominio `Comprobante` | PDF/XLSX válidos, actualmente persistidos en PostgreSQL por el propietario | Mantener autorización del pedido e idempotencia del comprobante; usar `comprobante` o `comprobante-excel` si se externalizan bytes |
| n8n, `generar-flujos.py` | Genera/transfiere comprobantes entre servicios | Usa `CLB_CLIENTES_URL` para fidelización y avisos, con JWT de servicio; no necesita acceso directo a tablas |
| Angular/PWA y React | Selección de foto, ingesta, exportaciones y cachés de recursos/resultados | Nunca reciben claves AWS. Integración por API y PUT/GET firmados; caché offline conserva bytes, hashes y metadatos verificados |
| Flutter/Android | Cámara/galería, cola de fotos, recursos RA empaquetados, exportación y archivos privados | Nunca lleva claves AWS en APK/puente JS. La cola debe persistir clave estable por titular y ruta al confirmar; las descargas siguen siendo atómicas |
| Preparación de modelos y catálogo limpio | Pesos, TF.js/TFLite/ONNX, build del probador, semillas y licencias | Son artefactos de preparación/offline. No se sustituyen por URLs firmadas que caduquen ni se suben pesos grandes a estos buckets |

**Alcance de integración:** el mecanismo AWS compartido está desplegado y comprobado. El adaptador de Inventario está implementado y probado con HTTP simulado, incluidas respuestas perdidas, PUT 412, aislamiento de credenciales de S3, hash corrupto y borrador no publicado. Permanece opcional para conservar el entorno local. VTON, exportaciones y comprobantes mantienen su persistencia y retención actuales: no se copian automáticamente fotos personales ni se duplican bases de negocio. Las aplicaciones GCP/Azure no están disponibles para comprobar su conexión real. El cliente `archivos.py` permite archivar explícitamente otros formatos con el mismo contrato; esos flujos no se declaran ya migrados.

## Datos para GCP y Azure

Compartir este archivo y `.env.example`, nunca `/etc/clb/clientes.env`, sesiones de AWS o tokens.

```dotenv
CLB_CLIENTES_URL=https://clientes.leonardoserrate.xyz
CLB_ARCHIVOS_URL=https://clientes.leonardoserrate.xyz
CLB_IDENTIDAD_EMISOR=https://auth.leonardoserrate.xyz/realms/clb
CLB_IDENTIDAD_JWKS=https://auth.leonardoserrate.xyz/realms/clb/protocol/openid-connect/certs
```

Ventas (Spring), IA (Python) y n8n ya leen `CLB_CLIENTES_URL`. Sus rutas existentes de fidelización, perfiles y notificaciones no cambian. Externamente también se publican `/api/v1/interno/*` para llamadas entre nubes: cada ruta exige el rol `servicio` firmado por Keycloak. El puerto 3000 no es público. No copiar la regla de la pasarela local que oculta todas esas rutas entre nubes, porque impediría la SAGA.

El compañero de GCP debe configurar realm `clb`, audiencia `clb-api`, roles `cliente`, `admin`, `servicio`, clientes con Code+PKCE para apps y client credentials para servicios. Conservar los IDs actuales `clb-ventas`, `clb-ia` y `clb-n8n`; agregar `clb-inventario` para el adaptador de archivos. Sus secretos se entregan por configuración privada. Si Keycloak publica bajo `/identidad`, ajustar **ambas** URLs OIDC anteriores de forma coherente en los servicios y apps. Clientes arranca y atiende salud aunque Keycloak esté ausente, pero rechaza las operaciones autenticadas hasta poder verificar tokens. No hay bypass de autenticación.

Para activar archivos compartidos en Inventario, configurar `CLB_ARCHIVOS_URL=https://clientes.leonardoserrate.xyz`, `CLB_ARCHIVOS_URL_TOKEN=<URL HTTPS real del endpoint token del realm clb>` y `CLB_IDENTIDAD_SECRETO_INVENTARIO=<secreto privado>`. El cliente obtiene tokens por client credentials. Conservar `CLB_RECURSOS_DIRECTORIO` en un volumen privado persistente: contiene caché y `comprobantes-s3`, con claves guardadas antes de cada solicitud; no eliminarlo en redeploy. Con URL vacía se usa el adaptador local. Los archivos previos continúan leyéndose localmente; los nuevos muestran su ruta S3 en `almacenamiento` del trabajo. No guardar tokens ni URLs firmadas en MongoDB, caché offline o comprobantes.

Los nombres `auth` y `tienda` son destinos reservados/configurables: su publicación no forma parte de este stack. Si el origen real de la web es otro, agregar su HTTPS exacto al CORS de API (`CLB_CORS_ORIGENES`) y del bucket mediante la plantilla; no habilitar `*`. Android y comunicación servidor-servidor no requieren CORS. HTTPS se exige para cualquier carga por Internet.

## Operación y seguridad

Entrar por AWS Systems Manager a la instancia. No hay entrada 22 ni 3000 en el grupo de seguridad. El rol de EC2 permite operaciones de ítems solo en las dos tablas, sus índices, objetos del bucket funcional y lectura de paquetes `CLIENTES/*`; no puede crear tablas ni administrar IAM. IMDSv2 obligatorio, disco gp3 cifrado. Los proveedores Push/Resend están desactivados porque sus claves no se trasladaron a AWS: los endpoints conservan su registro durable, pero no se afirma envío real desde esta instancia.

```bash
systemctl status clb-clientes caddy
journalctl -u clb-clientes -n 100 --no-pager
journalctl -u caddy -n 100 --no-pager
curl --fail http://127.0.0.1:3000/salud
```

El entorno privado está en `/etc/clb/clientes.env` (root:clb, 640). Aplicar cambios con `systemctl restart clb-clientes`; nunca imprimir el archivo si contiene secretos. Versiones en `/opt/clb/clientes/versiones`, enlaces `actual`/`anterior`. Logs locales persistentes limitados a 100 MiB y 7 días; no se contrata CloudWatch Logs. Revisar disco si se realizan muchas actualizaciones: se conservan las versiones locales para recuperación.

## Costos estimados

Precios consultados el 9-nov-2026, USD, 730 horas/mes, antes de impuestos/créditos:

| Concepto | Estimación mensual |
| --- | ---: |
| t4g.micro Linux Ohio, USD 0,0084/h | 6,13 |
| IPv4 pública, USD 0,005/h | 3,65 |
| gp3 8 GiB, USD 0,08/GiB-mes | 0,64 |
| Base de cómputo/red/disco | **10,42** |
| S3, DynamoDB bajo demanda, PITR y transferencia | Variable; con pocos archivos/solicitudes de demo, margen previsto < USD 1/mes |

La tarifa EC2 se contrastó con el catálogo público de AWS para Ohio. Fuentes: [EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [IPv4](https://aws.amazon.com/vpc/pricing/), [EBS](https://aws.amazon.com/ebs/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/). No se asume que un crédito cubra todos los servicios ni que se renueve. El presupuesto **avisa; no corta el gasto**, y la facturación tiene demora.

CPU en modo standard para evitar cargos por créditos de CPU adicionales; no GPU, balanceador, NAT Gateway, Route53 ni KMS de pago. La aplicación se midió alrededor de 81 MB de memoria bajo systemd en reposo; la instancia dispone de 1 GiB para sistema, Caddy, Node e instalación de dependencias. Esto no es una prueba de carga ni una garantía de disponibilidad: hay una sola instancia. Detener EC2 conserva IP/disco y sus cargos; eliminar recursos con datos exige una operación explícita y revisada.

## Evidencia ejecutada

- `npm run probar` con endpoint AWS real, credenciales temporales de operador y tablas aisladas `clb_prueba_*`: **42 aprobadas**, sin omitidas. Las tablas temporales se eliminaron al terminar. No se crearon ventas.
- Hubo una repetición con timeout de conexión de 2 segundos desde la PC en el hook DynamoDB (37 aprobadas y 6 resultados afectados por hook/limpieza). Se repitió ese bloque: **5/5**, y la siguiente corrida completa terminó **42/42**. No se amplió el timeout de producción ni se ocultó esa intermitencia de la red de ensayo.
- `verificacion-aws.mjs` en EC2 con el rol de la instancia: CRUD real de una fila aislada; perfil por HTTP con JWT y conflicto de versión; acreditación idempotente y compensación por HTTP con saldo neto cero; PUT/GET S3 firmados con SHA-256 real, 412 al sobrescribir, 403 anónimo, 404 entre titulares, listado del registro y borrado repetible con comprobante durable: **7 verificaciones aprobadas**. El pedido de fidelización es sintético y no crea una venta; sus registros idempotentes se conservan.
- El perfil y las imágenes de demostración están marcados como pruebas. No confundirlos con actividad comercial ni métricas del negocio. Los originales del catálogo conservan procedencia y licencia.
- La aplicación de ensayo escucha solo en loopback y utiliza un emisor efímero propio. **Esto verifica autenticación criptográfica del código; no es evidencia de integración con Keycloak público**, que aún no existe. No cambia el emisor del proceso `clb-clientes`.
- Ensayo de recuperación por SSM: candidata que lanza un error al iniciar, rechazo por salud, restablecimiento automático de la versión anterior y DynamoDB ACTIVO: **aprobado**. Se mantuvo el mismo dominio/IP y no se alteraron datos.
- Inventario: `php vendor/bin/phpunit --testsuite Dominio,Aplicacion,Adaptadores`: **71 pruebas, 187 aserciones**, sin omisiones; no necesita MongoDB para este bloque. No equivale a una prueba de integración con Azure/GCP.
- Internet: salud por IP HTTP/HTTPS 200, rutas privadas por IP HTTP 426, dominio HTTP 308 a HTTPS y rutas privadas HTTPS sin identidad o con token ficticio 401. Certificados para dominio e IP comprobados con validación TLS normal; dominio también verificado por DNS desde EC2. HTTP por dominio redirige a HTTPS.
- Un intento de actualización no pudo conectar con el endpoint S3 desde la PC antes de ejecutar SSM; no cambió la versión activa. La conectividad se recuper? y el comando completo se repiti? con ?xito: versi?n `clientes_2026-11-10_00-27-03-457_UTC_orkyjg`, salud verificada por el dominio HTTPS.
- Pendientes externos: Keycloak público y prueba autenticada entre las nubes, y proveedores de notificación. No impiden salud, persistencia ni almacenamiento AWS.

Para repetir la comprobación AWS completa ahora: `python infraestructura/aws/verificar.py`. Crea archivos/perfiles de ensayo identificables y verifica desde la PC y desde EC2; no genera ventas ni notificaciones reales. El verificador remoto no cambia la configuración OIDC del servicio publicado. Sin HTTPS, solo probar `/salud` públicamente y usar SSM para pruebas privadas por loopback; nunca transmitir sesiones, datos personales o URLs firmadas por HTTP.

La evidencia detallada local sin URLs firmadas está en `infraestructura/aws/datos-locales/`, excluida de Git. No hay commit ni push de estos cambios.
