# Ventas en Azure (despliegue vigente)

Esta suscripción despliega **Ventas (Spring Boot) con su PostgreSQL `clb_ventas`** y, desde el 10-nov a pedido del compañero, **el backend IA, worker_prendas y su PostgreSQL `clb_analitica`** en la misma VM (§16). El compañero administra el resto: pasarela `api.leonardoserrate.xyz`, Keycloak, Inventario, Clientes, n8n y frontends. El DNS del dominio está en Cloudflare. Coordinación y mensajes: [COORDINACION-VENTAS.md](COORDINACION-VENTAS.md).

La preparación anterior de IA en Azure se retiró de esta carpeta el 10-nov-2026. Se conservan los cambios compartidos de IA que puede necesitar el compañero: `TORCH_CUDA_ARCH_LIST` como argumento en `Dockerfile.vton` y nombres corregidos en `microservicios/inteligencia-artificial/.env.example`.

## Estado (auditoría del 10-nov-2026, 02:50 hora de Bolivia)

| | Estado |
|---|---|
| **Infraestructura** | **Lista.** Seis contenedores arriba: `ventas`, `postgres`, `postgres-analitica`, `ia` (sanos), `prendas` y `caddy`. RAM 2,2 GiB usados de 3,8 (1,7 disponibles). Disco 6,5 de 30 GB |
| **HTTPS** | **Listo.** `ventas` e `ia` → 52.162.217.223, DNS en Cloudflare (solo DNS). Let's Encrypt válido hasta 2027-02-08 para ambos |
| **Integración** | **En producción.** Keycloak `https://auth.leonardoserrate.xyz/identidad/realms/clb`, Inventario `https://api.leonardoserrate.xyz`, Clientes `https://clientes.leonardoserrate.xyz`, orígenes internos `35.208.191.124/32` |
| **Tráfico real (últimas 2 h)** | 8 compras `201`, 6 comprobantes `201`, 6 pedidos `CONFIRMADO`; n8n lee `interno/eventos` (659 × 200); tienda → IA GraphQL (394 × 200); app Flutter → pedidos (81 × 200). Sin `ERROR` en Ventas ni IA |

Los servicios GPU (Ollama y CatVTON) corren en el PC del integrante por Cloudflare Tunnel: ver
[../tunel-gpu/LEEME.md](../tunel-gpu/LEEME.md).

## 1. Arquitectura y recursos creados

```
Frontend → api.leonardoserrate.xyz (Nginx del compañero, GCP)
        → https://ventas.leonardoserrate.xyz (Azure: Caddy :443) → Ventas :8080 → PostgreSQL (red interna, sin puerto)
IA y n8n (compañero) → https://ventas.leonardoserrate.xyz/api/v1/interno/{eventos, pedidos/{id}/comprobante} (solo sus IP)
Ventas → Keycloak, Inventario y Clientes del compañero (HTTPS, token de servicio clb-ventas)
```

Suscripción **Azure for Students** `3655a98c-85a4-4c18-b443-032524c0f489`, región **northcentralus**, creados el 10-nov-2026 con `aprovisionar.ps1`:

| Recurso | Nombre | Detalle comprobado |
|---|---|---|
| Grupo | `clb-ventas-rg` | Etiquetas `proyecto=clb-store`, `componente=ventas`, `curso=ingsoft2-g5` |
| VM | `clb-ventas-vm` | `Standard_B2als_v2` (2 vCPU, 3,8 GiB útiles), Ubuntu 24.04 LTS, Trusted Launch, SSH sin contraseña |
| Disco | `clb-ventas-disco` | Standard SSD LRS 32 GiB (E4); `/` con 30 GB, 3,7 GB usados |
| IP pública | `clb-ventas-ip` | **52.162.217.223**, Standard estática. También es la IP de **salida** de Ventas |
| Red | `clb-ventas-vnet` (subred `app` 10.41.0.0/26), `clb-ventas-vmVMNic`, `clb-ventas-nsg` | — |
| Autoapagado | `shutdown-computevm-clb-ventas-vm` | Enabled, `0300` UTC = 23:00 Bolivia |

Reglas del NSG:
- `ssh-admin`: 22 desde `192.223.106.95/32` (IP del administrador al 10-nov).
- `https-autorizado`: 443 desde esa misma IP, la pasarela/n8n de GCP `35.208.191.124/32` y Clientes de AWS `3.136.183.205/32`.
- `acme-http`: 80 desde Internet, solo para el desafío de Let's Encrypt.

PostgreSQL contiene **solo** la base de aplicación `clb_ventas` (además de `postgres`, `template0` y `template1`, propias de PostgreSQL). Roles con login: `clb_admin`, solo administración y respaldos, y `clb_ventas`, sin superusuario y dueño de su base. Se inicializó con volumen vacío. No se copió ni importó ninguna base local ni de otro servicio.

Notas sobre la región:
- Basv2 figura «NotAvailableForSubscription» en eastus y canadacentral. Un primer intento en eastus falló con `SkuNotAvailable`, y ese grupo lo eliminó el titular.
- El tamaño y la región quedaron aprobados.

## 2. Requisitos y configuración inicial

En el PC necesitas:
- Azure CLI;
- Docker Desktop (para compilar la imagen);
- OpenSSH;
- la clave `~/.ssh/clb_azure`, creada por `aprovisionar.ps1`.

| Script | Dónde se ejecuta | Para qué |
|---|---|---|
| `aprovisionar.ps1` | PowerShell en el PC | Crea los recursos (idempotente). `-SoloComprobar` revisa cuota y restricciones sin crear nada |
| `vm.ps1` | PowerShell en el PC | `-Accion iniciar\|estado\|desasignar`: muestra PowerState, IP y autoapagado |
| `publicar-ventas.ps1` | PowerShell en el PC | Compila `clb_ventas:azure` y la carga en la VM con `compose.ventas.yaml`, `Caddyfile.ventas` y la plantilla de entorno. Sin secretos. Comprobado: 114 s |
| `preparar-vm.sh` | Bash en la VM, una vez | Docker 29.x oficial, `/srv/clb/{ventas,respaldos}`, journald 500 MB. Ya ejecutado |

Para autorizar las IP del compañero en el 443 (PowerShell en el PC):
```powershell
az network nsg rule update -g clb-ventas-rg --nsg-name clb-ventas-nsg -n https-autorizado --source-address-prefixes 192.223.106.95/32 <IP_PASARELA>/32 <IP_IA>/32 <IP_N8N>/32 --subscription 3655a98c-85a4-4c18-b443-032524c0f489
```
Si tu IP de casa cambia, actualiza `ssh-admin` y `https-autorizado` con la nueva.

## 3. Variables (sin secretos)

La plantilla es `.env.ventas.example`. El archivo real es **`/srv/clb/.env.ventas`** en la VM, con permisos `600` y dueño `clb`. Las claves de PostgreSQL se generaron en la VM con `openssl rand -hex 24` y nunca salieron de ella.

| Variable | Estado |
|---|---|
| `CLB_VENTAS_DOMINIO=ventas.leonardoserrate.xyz` | Definida |
| `CLB_POSTGRES_ADMIN_CLAVE`, `CLB_POSTGRES_CLAVE` | Definidas (generadas) |
| `CLB_IDENTIDAD_EMISOR`, `CLB_IDENTIDAD_INTERNO` | `https://auth.leonardoserrate.xyz/identidad/realms/clb` y `…/identidad` |
| `CLB_IDENTIDAD_SECRETO_VENTAS` | Definida (secreto de `clb-ventas`) |
| `CLB_INVENTARIO_URL`, `CLB_CLIENTES_URL` | `https://api.leonardoserrate.xyz` y `https://clientes.leonardoserrate.xyz` |
| `CLB_VENTAS_ORIGENES_INTERNOS` | `35.208.191.124/32` (pasarela y n8n) |

Para cambiarlas, en la VM: `nano /srv/clb/.env.ventas` y luego `$C up -d --no-build` (ver §7).

Valores fijos del código:
- Audiencia `clb-api`; roles en `realm_access.roles`.
- Hacia Inventario y Clientes: conexión 2 s y lectura 4 s.
- SAGA: 3 intentos y reanudación cada 5 s.

## 4. Migraciones y arranque

Flyway aplica V1–V3 al arrancar Ventas.

```bash
cd /srv/clb/ventas
docker compose -f compose.ventas.yaml --env-file /srv/clb/.env.ventas up -d --no-build    # postgres, ventas y caddy
```

Comprobado en la VM el 10-nov-2026:
- primer arranque `healthy` en 32 s;
- migraciones `1:true 2:true 3:true`;
- tras desasignar y encender, PostgreSQL y Ventas **arrancan solos** (`restart: unless-stopped`) y sanos en menos de 1 min, con datos y migraciones intactos.

Caddy se creó el 9-nov con ese mismo `up -d`, y desde entonces los tres servicios arrancan solos al encender la VM.

## 5. Sesión, suscripción, encendido y estado (PowerShell en el PC)

```powershell
az login                                                                    # cuenta lobo.carlos@ficct.uagrm.edu.bo
az account set --subscription 3655a98c-85a4-4c18-b443-032524c0f489          # Azure for Students
cd "C:\Users\rekte\OneDrive\Desktop\CLB Ropa\CLB-STORE\infraestructura\azure"
.\vm.ps1 -Accion iniciar      # comprobado: PowerState/running en ~22 s
.\vm.ps1 -Accion estado
```

## 6. SSH

```powershell
ssh -i $HOME\.ssh\clb_azure clb@52.162.217.223
```
Solo con clave y desde la IP autorizada en `ssh-admin`.

## 7. Comprobar Ventas, PostgreSQL y HTTPS

En la VM (Bash):
```bash
cd /srv/clb/ventas; C="docker compose -f compose.ventas.yaml --env-file /srv/clb/.env.ventas"
$C ps                                                           # postgres y ventas: healthy
$C exec ventas curl -s http://127.0.0.1:8080/salud              # {"estado":"ACTIVO",...}
$C exec postgres psql -U clb_admin -d clb_ventas -c "select version, success from flyway_schema_history"
sudo ss -tlnp                                                   # comprobado sin Caddy: solo 22 en el host
```

Comprobado el 10-nov-2026:
- **Desde el PC:** 22 abierto; 80, 443, 5432 y 8080 cerrados (Caddy aún no corre).
- **Puertos de los contenedores:** PostgreSQL y Ventas no publican ninguno.
- **Red interna:** PostgreSQL no tiene salida a Internet.

**HTTPS, comprobado el 9-nov-2026:**
- Caddy obtuvo el certificado en segundos: «certificate obtained successfully», emisor Let's Encrypt.
- Desde el PC:
  - `/salud` → `{"estado":"ACTIVO","dependencias":{"postgresql":"ACTIVO"}}`;
  - `/api/v1/pedidos` sin token y con token falso → 401;
  - `/api/v1/interno/eventos` desde una IP no autorizada → 404;
  - ruta con `;` → 400; otra ruta → 404;
  - `http://` → 308 a `https://`.
- Puertos: en el host escuchan solo 22, 80 y 443. Desde el PC, 5432, 8080 y 2019 están cerrados.
- PostgreSQL contiene `clb_ventas`, `postgres`, `template0` y `template1`.

Pasos usados (repetibles si se recrea el volumen de certificados):

1. Desde el PC, verificar que el nombre resuelve a la VM:
   ```powershell
   Resolve-DnsName ventas.leonardoserrate.xyz -Server 1.1.1.1    # debe dar 52.162.217.223
   ```
2. En la VM, levantar Caddy y revisar la emisión del certificado:
   ```bash
   $C up -d --no-build                                   # crea Caddy y obtiene el certificado por HTTP-01
   $C logs caddy | grep -iE "certificate obtained|error"
   ```
3. Desde el PC (tu IP está autorizada en el 443):
   ```powershell
   curl.exe -s https://ventas.leonardoserrate.xyz/salud
   curl.exe -s -o NUL -w "%{http_code}" https://ventas.leonardoserrate.xyz/api/v1/pedidos            # 401 sin token
   curl.exe -s -o NUL -w "%{http_code}" https://ventas.leonardoserrate.xyz/api/v1/interno/eventos    # 404 desde tu IP
   ```

Caddy renueva el certificado solo, con unos 30 días de margen, por el puerto 80, que queda abierto para eso.

Reglas de Caddy, verificadas en local:

| Ruta | Respuesta |
|---|---|
| `/salud` | 200 |
| `/api/v1/pedidos*` | 401 sin token (90 s, 1 MB) |
| `/api/v1/interno/eventos` y `…/pedidos/{id}/comprobante` | Solo desde `CLB_VENTAS_ORIGENES_INTERNOS`; al resto, 404 |
| Ruta con `;` | 400 |
| Cualquier otra | 404 |

## 8. Logs y recuperación sin borrar datos

```bash
$C logs --tail 200 ventas          # o postgres, caddy (10 MB × 3 por servicio)
$C restart ventas
$C up -d --no-build                # recrea lo que falte y conserva los volúmenes
```
Para actualizar Ventas, ejecutar `.\publicar-ventas.ps1 -Ip 52.162.217.223` en el PC y después `$C up -d --no-build` en la VM.

Nunca usar `docker compose down -v` ni `docker volume rm`.

## 9. Volúmenes y configuración privada (en la VM)

| Qué | Dónde |
|---|---|
| Compose, Caddyfile y plantilla | `/srv/clb/ventas/` |
| Configuración privada | `/srv/clb/.env.ventas` (600) |
| Respaldos | `/srv/clb/respaldos/` (700) |
| Datos de PostgreSQL | volumen `clb-ventas_postgres` |
| Certificados | volúmenes `clb-ventas_caddy-datos` y `clb-ventas_caddy-config` (no borrar: Let's Encrypt limita las reemisiones) |

## 10. Respaldo y restauración de PostgreSQL

Respaldo, en la VM:
```bash
$C exec -T postgres pg_dump -U clb_admin -d clb_ventas -Fc > /srv/clb/respaldos/clb_ventas-$(date +%F-%H%M).dump
```

Copia al PC (PowerShell):
```powershell
scp -i $HOME\.ssh\clb_azure "clb@52.162.217.223:/srv/clb/respaldos/*.dump" .
```

Restauración, solo ante pérdida de datos y con Ventas detenido:
```bash
$C stop ventas
$C exec -T postgres pg_restore -U clb_admin -d clb_ventas --clean --if-exists --no-owner --role=clb_ventas < /srv/clb/respaldos/<archivo>.dump
$C start ventas
```

Comprobado el 10-nov-2026:
- se generó el respaldo `clb_ventas-2026-11-10-0129.dump` (18,6 KB);
- se restauró en una base temporal `clb_prueba_restauracion` con 3 migraciones y 8 tablas, y luego se eliminó;
- no se ejecutó una restauración sobre `clb_ventas`.

## 11. Autoapagado

Diario a las 23:00 de Bolivia (`0300` UTC), comprobado `Enabled`. Desasigna la VM una vez al día. No impide encenderla después ni limita horas.

Si la presentación se alarga:
```powershell
az vm auto-shutdown -g clb-ventas-rg -n clb-ventas-vm --time 0400 --subscription 3655a98c-85a4-4c18-b443-032524c0f489   # 00:00 Bolivia
```
Volver a `0300` al terminar.

## 12. Desasignar

```powershell
.\vm.ps1 -Accion desasignar      # comprobado: "Estado: PowerState/deallocated" en ~41 s
```
Apagar Linux desde dentro no basta: la VM detenida sin desasignar sigue cobrando cómputo.

## 13. Costos

Fuente: Azure Retail Prices API, USD, precio público Linux bajo demanda, northcentralus, 10-nov-2026.

| Concepto | USD | Incluye |
|---|---|---|
| VM B2als_v2 | 0,0376/h | Cómputo, solo encendida |
| IP Standard | 0,005/h | Se cobra también desasignada |
| Disco E4 32 GiB | 2,40/mes ≈ 0,079/día | Se cobra también desasignada |
| **Encendida** | ≈ **0,046/h** · jornada de 6 h ≈ **0,28** · 24 h ≈ **1,10** | VM + IP + disco |
| **Desasignada** | ≈ **0,20/día** | IP + disco |
| 14 días con 4 jornadas de 6 h | ≈ 3,7 | — |
| 14 días encendida 24/7 | ≈ 15,4 | — |

- Operaciones de disco (0,002 por 10.000) y salida a Internet (gratis hasta 100 GB/mes) no están en las cifras: son despreciables.
- Students descuenta a precio de lista. Las alertas no cortan el gasto; el límite de gasto de la suscripción sí.
- Al cerrar el periodo, borrar `clb-ventas-rg`, previa confirmación, para dejar de pagar disco e IP.

## 14. Checklists

**Antes de presentar** (orden completo con la GPU en [../tunel-gpu/LEEME.md](../tunel-gpu/LEEME.md)):
1. `.\vm.ps1 -Accion iniciar` → `PowerState/running`.
2. Esperar alrededor de 1 min. `curl.exe -s https://ventas.leonardoserrate.xyz/salud` debe responder `ACTIVO`.
3. Si la IP de casa cambió, actualizar `ssh-admin` y `https-autorizado` (§2).
4. Encender la GPU y el túnel (`..\tunel-gpu\gpu.ps1 -Modo ambos`).
5. Avisar al compañero y comprobar `https://api.leonardoserrate.xyz/salud/ventas` y el historial de pedidos desde el frontend.

**Al terminar:**
1. Si hubo pedidos que conservar, hacer un respaldo (§10).
2. `.\vm.ps1 -Accion desasignar` → `PowerState/deallocated`.
3. Si se cambió, devolver el autoapagado a `0300`.

## 15. Integración con el compañero

Hecho y comprobado con tráfico real el 10-nov-2026 (ver Estado): DNS en Cloudflare, Keycloak, Inventario, Clientes, su pasarela, n8n y la tienda.

Pendiente de verificar:
- la renovación automática del certificado (vence 2027-02-08; Caddy renueva con ~30 días de margen);
- `POST /api/v1/interno/notificaciones` de n8n hacia IA: no hubo llamadas en las 2 h auditadas.

## 16. Inteligencia Artificial en la misma VM (backend IA, clb_analitica y worker_prendas)

El compañero pidió desplegarlos en Azure. Van en la VM de Ventas, sin recursos nuevos:

| Servicio | Contenedor | Red | Datos | Límite de RAM |
|---|---|---|---|---|
| PostgreSQL `clb_analitica` | `postgres-analitica` | `analitica` (interna, sin salida ni puerto) | volumen `clb-ventas_postgres-analitica` | 384 MiB |
| Backend IA (FastAPI) | `ia` (perfil `ia`) | `analitica` + `aplicaciones` | volumen `clb-ventas_modelos-ia` (Whisper `small`) | 1280 MiB |
| worker_prendas (U²-Net ONNX) | `prendas` (perfil `ia`) | `aplicaciones`, solo salida | `/srv/clb/modelos-prendas` (solo lectura, SHA-256 verificado) | 1280 MiB |

- **PostgreSQL:** es una instancia **distinta** de la de Ventas. Su script de inicialización solo crea el rol y la base `clb_analitica`; no se usó el script del stack local ni se copió ninguna base.
- **IA:**
  - Lee los eventos de Ventas por la red interna (`http://ventas:8080`), sin pasar por Caddy ni por el NSG.
  - Usa Ollama en la GPU del integrante (`https://clb-ollama.leonardoserrate.xyz`, con token de Access en `/srv/clb/.env.ventas`).
  - No llama a CatVTON: lo llama la pasarela.
- **Entrada pública:** `https://ia.leonardoserrate.xyz` (mismo Caddy):
  - Rutas públicas: `/salud` y `/api/v1/(reportes|agentes|voz|tallas|graphql|notificaciones)`, hasta 6 MB y 300 s.
  - `/api/v1/interno/notificaciones` solo desde `CLB_IA_ORIGENES_INTERNOS` (n8n).
  - `/mcp` y el resto → 404.
- **Memoria medida en local:**
  - Whisper `small`: pico de 746 MiB al transcribir.
  - U²-Net, al preparar una prenda: 835 MiB.
  - La VM sin IA usa 761 MiB de 3 856 y le quedan 3 095 disponibles. Cabe sin redimensionar.
  - Si en la práctica faltara memoria, la alternativa es `Standard_B2as_v2` (8 GiB, USD 0,0752/h frente a 0,0376/h), previa aprobación.

Variables nuevas en `/srv/clb/.env.ventas`:

| Variable | Estado |
|---|---|
| `CLB_ANALITICA_ADMIN_CLAVE`, `CLB_ANALITICA_CLAVE` | Generadas en la VM |
| `CLB_IA_OLLAMA_ACCESS_ID`, `CLB_IA_OLLAMA_ACCESS_CLAVE` | Definidas (token `clb-backend-ia-ollama`) |
| `CLB_IA_DOMINIO` | `ia.leonardoserrate.xyz` |
| `CLB_IDENTIDAD_SECRETO_IA` | Definida (secreto de `clb-ia`) |
| `CLB_IA_ORIGENES_INTERNOS` | `35.208.191.124/32` (n8n) |
| `CLB_IDENTIDAD_EMISOR/INTERNO`, `CLB_INVENTARIO_URL`, `CLB_CLIENTES_URL` | Compartidas con Ventas (§3) |

Inteligencia de negocios (10-nov-2026): la imagen `clb_ia:azure` incluye solo los cambios del BI sobre la versión que
estaba desplegada. `Caddyfile.ventas` publica también `/api/v1/demostracion/` (CSV, solo admin). `demo_bi` se generó con
`$C --profile ia exec -T ia python -m fuente.infraestructura.dataset_demostracion generar` y `… entrenar`. Para volver atrás:
- `docker tag clb_ia:azure-previo-bi clb_ia:azure && $C --profile ia up -d --no-build --no-deps ia`;
- `cp Caddyfile.ventas.previo-bi Caddyfile.ventas` y `caddy reload`.

Respaldo de la base previo al cambio: `/srv/clb/respaldos/clb_analitica-previo-bi-20261110-1814.dump`. No se restaura sobre
actividad nueva.

Publicar y arrancar:
```powershell
.\publicar-ia.ps1 -Ip 52.162.217.223     # compila clb_ia:azure y clb_ia_prendas:azure, sube imágenes y u2net.onnx
```
```bash
cd /srv/clb/ventas; C="docker compose -f compose.ventas.yaml --env-file /srv/clb/.env.ventas"
$C up -d --no-build                      # Ventas, postgres, postgres-analitica y caddy
$C --profile ia up -d --no-build         # IA y prendas: SOLO con los datos de Keycloak (sin ellos fallan al iniciar)
$C --profile ia ps
$C exec -T postgres-analitica pg_dump -U clb_admin -d clb_analitica -Fc > /srv/clb/respaldos/clb_analitica-$(date +%F-%H%M).dump
```
- `--profile ia` es necesario en cada `up`, `ps` o `logs` de IA o prendas.
- Al encender la VM, los contenedores que ya existían arrancan solos (`restart: unless-stopped`).

Comprobado el 10-nov-2026 en la VM:
- **Publicación:** `publicar-ia.ps1` tardó 505 s; `u2net.onnx` coincide con su SHA-256 y las imágenes `clb_ia:azure` y `clb_ia_prendas:azure` quedaron cargadas.
- **`postgres-analitica`:**
  - `healthy`;
  - bases: `clb_analitica`, `postgres`, `template0` y `template1`;
  - login: `clb_admin` (superusuario) y `clb_analitica` (dueño de su base);
  - red `analitica` interna, sin salida a Internet y sin puertos en el host;
  - un dato persistió tras reiniciar el contenedor.
- **Instancia de Ventas:** sigue con solo `clb_ventas`. Ventas `/salud` → ACTIVO por HTTPS.
- **Imagen IA:** se conecta a `clb_analitica` como `clb_analitica` e incluye el soporte del token de Access para Ollama.
- **Desde la VM hacia Ollama:** sin token 401; con el token de `.env.ventas` lista `qwen3:8b`. Se probó forzando la IP de Cloudflare, porque el DNS aún no está migrado.
- **Imagen prendas:** sin red, de solo lectura y con 1280 MiB, preparó una prenda real en 4,5 s con un pico de 746 MiB.
- **Caddy y `ia.leonardoserrate.xyz`:** el certificado falla («authorization failed») porque `ia` todavía apunta a 77.114.54.124, la IP liberada. Caddy reintenta solo.
- **Memoria** con `postgres-analitica` en marcha: 890 MiB usados y 2 965 disponibles.

**Auditoría del 10-nov-2026 (02:50 Bolivia), con el perfil `ia` en marcha:**
- `ia` sano; `/salud` 200; `/api/v1/reportes` sin token 401; `/mcp` y `/api/v1/interno/notificaciones` desde una IP no autorizada → 404.
- Desde el contenedor `ia`, Ollama por el túnel con el token de Access: `/api/tags` 200 y `qwen3:8b` respondió en 8,7 s.
- `clb_analitica` con datos reales: 122 existencias, 6 pedidos, 6 eventos procesados y 2 reportes.
- `prendas`: hubo 502/503 de `api.leonardoserrate.xyz/.../recursos-probador/reclamar` hasta las 05:44 UTC, mientras la pasarela se reiniciaba. Después, ninguno. El ciclo reintenta cada 3 s sin perder el arrendamiento.
