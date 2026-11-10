# GPU del PC por Cloudflare Tunnel: Ollama y CatVTON

Ollama (qwen3:8b) y el worker CatVTON corren en el PC del integrante con la RTX 5060. El túnel `IAJuridica` de
Cloudflare los publica con Access, sin abrir puertos del router. Ventas y PostgreSQL están en Azure
([../azure/LEEME.md](../azure/LEEME.md)) y no dependen de esto.

**Dependencia explícita:** si el PC se apaga, suspende o pierde Internet, Ollama y VTON dejan de responder (ver
«Fallos»). Ventas sigue funcionando.

## Estado (auditoría del 10-nov-2026, 02:50 hora de Bolivia)

| Pieza | Estado |
|---|---|
| Servicios locales | Listos y comprobados (ver «Resultados») |
| Túnel, rutas y Access | **Creados** en la cuenta Cloudflare del integrante, con validación también en el origen |
| Nameservers | **Migrados** a `matt/stella.ns.cloudflare.com`. `comparar-dns.ps1 -Publico`: 1.1.1.1 y 8.8.8.8 dan lo mismo para todos los nombres, MX y SPF |
| Hostnames públicos | Resuelven. Sin token: `clb-ollama` y `clb-vton` → 401 de Access |
| Keycloak del equipo | **Integrado.** `.env` apunta a `https://auth.leonardoserrate.xyz/identidad/realms/clb`; el worker procesó 4 trabajos reales entre 06:41 y 06:47 UTC sin errores |
| Backend IA (Azure) → Ollama | Con su token: `/api/tags` 200 y `qwen3:8b` respondió en 8,7 s |

## Cuentas y responsabilidades

| Concepto | Valor | Responsable |
|---|---|---|
| Registro del dominio | Namecheap | dueño (amigo); no se transfiere |
| Nameservers vigentes | `matt/stella.ns.cloudflare.com` desde el 10-nov-2026 (antes, Namecheap BasicDNS) | dueño, en Namecheap |
| Zona Cloudflare `leonardoserrate.xyz` | cuenta del integrante (Free, configuración completa, ID de zona `245136e8…`). NS asignados `matt.ns.cloudflare.com` y `stella.ns.cloudflare.com`. DNSSEC desactivado | integrante; el dueño, como miembro invitado |
| Túnel `IAJuridica` | ID `2b549003-62ad-46a4-a8c5-cd1c1a7627a3`, remoto, conector = servicio `cloudflared` de este PC | integrante |
| Access (equipo `soft-wood-933b`) | aplicaciones `clb-ollama` y `clb-vton` | integrante |

El túnel y la zona deben estar en la **misma** cuenta: *«The `cfargotunnel.com` subdomain only proxies traffic for DNS
records in the same Cloudflare account.»*
([Cloudflare Tunnel, DNS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)).
Con plan Free no hay alternativa soportada sin cambiar los nameservers: el modo parcial por CNAME
([partial setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)) exige Business y delegar un
subdominio ([subdomain setup](https://developers.cloudflare.com/dns/zone-setups/subdomain-setup/)) exige Enterprise.

### Configuración creada en Cloudflare

Rutas del túnel (versión 4, comprobada en `http://127.0.0.1:20241/config`):

| Hostname | Servicio local | Origen |
|---|---|---|
| `clb-ollama.leonardoserrate.xyz` | `http://127.0.0.1:11434` | **Path `^/api/(chat\|tags)$`** (lo único que usa IA; el resto cae en el 404 final, desde el 10-nov-2026); `httpHostHeader: localhost`; `access.required` con AUD `7233ff75…` |
| `clb-vton.leonardoserrate.xyz` | `http://127.0.0.1:18081` | `access.required` con AUD `4774aa06…` |
| resto | `http_status:404` | — |

La ruta antigua `ia.leonardoserrate.xyz` → Ollama **se retiró**; su registro DNS de tipo túnel también.

Access:

| Aplicación | Política | Token de servicio | Sin token |
|---|---|---|---|
| `clb-ollama` | «Servicio backend IA - Ollama», Service Auth | `clb-backend-ia-ollama` (vence 2027-11-09) | 401 |
| `clb-vton` | «Servicio pasarela - VTON», Service Auth | `clb-pasarela-vton` (vence 2027-11-09) | 401 |

La aplicación `ia`, su política «Permitir Equipo» y el token «Equipo IA» del proyecto anterior no se tocaron. Con `ia`
en solo DNS, Access no se aplica a ese nombre.

Los valores secretos de los tokens están **solo** en `%USERPROFILE%\clb-privado\tokens-access.txt` y en
`%USERPROFILE%\clb-privado\entrega-companero.md`, fuera del repositorio. Se ven una única vez en el panel; si se
pierden, se rotan en Zero Trust → Access controls → Service credentials.

Zona Cloudflare preparada, comprobada con `comparar-dns.ps1`:
- **Iguales a Namecheap, todos en solo DNS** (comprobado el 10-nov):
  - `api`, `auth`, `store` y `probador` A 35.208.191.124;
  - `ventas` A 52.162.217.223;
  - `clientes` A 3.136.183.205;
  - 5 MX `eforward1-5.registrar-servers.com` y TXT SPF.
- **`ia` A 52.162.217.223** (backend IA en Azure). La IP anterior, 77.114.54.124, fue liberada por el compañero. Él
  debe actualizar `ia` en Namecheap.
- **Solo en Cloudflare, con proxy:** `clb-ollama` y `clb-vton` (CNAME al túnel).
- **No había:** CAA, DS ni DNSKEY.

## Migración DNS (cambio de nameservers)

**Hecha el 10-nov-2026.** Lo que sigue queda como registro del procedimiento y para revertir.

Requiere la aprobación del dueño **después** de revisar los registros. No transfiere el dominio: el registro sigue
en su cuenta de Namecheap y él puede revertir el cambio cuando quiera.

**Antes del cambio:**
1. El dueño exporta o copia **todos** los registros de Namecheap: Advanced DNS (host records), Mail Settings y
   redirecciones.
   - Las consultas públicas no descubren todo.
   - Un «URL Redirect Record» de Namecheap no existe en Cloudflare y hay que recrearlo como regla de redirección.
2. Se agregan a la zona Cloudflare los que falten. Luego se ejecuta `.\comparar-dns.ps1 -Nombres @(...)` con
   todos los nombres: todo debe salir `IGUAL` salvo `clb-ollama` y `clb-vton`.
3. Se acuerda el acceso: el integrante invita al dueño en Cloudflare (Manage account → Members) con el rol acordado
   (Administrator o DNS). Se necesita su correo.
4. El correo usa el reenvío de Namecheap (`eforward`). Se confirma con el dueño si lo usa; después del cambio hay que
   enviar un correo de prueba.
5. DNSSEC está desactivado en el registrador (sin DS), así que no hay que retirarlo.

**Cambio** (lo hace el dueño): Namecheap → Domain List → Manage → Nameservers → *Custom DNS* →
`matt.ns.cloudflare.com` y `stella.ns.cloudflare.com` → guardar.

**Comprobación** (en minutos u horas; puede tardar hasta 24–48 h):
```powershell
Resolve-DnsName leonardoserrate.xyz -Type NS -Server 1.1.1.1     # matt/stella.ns.cloudflare.com
.\comparar-dns.ps1 -Publico                                      # 1.1.1.1 frente a 8.8.8.8
curl.exe -s https://ventas.leonardoserrate.xyz/salud             # sigue en Azure, mismo certificado
curl.exe -s -o NUL -w "%{http_code}" https://clb-vton.leonardoserrate.xyz/salud   # 401 sin token
```
Además: `api`, `auth`, `clientes` e `ia` del dueño deben responder como antes, y un correo de prueba debe llegar.

**Reversión:** Namecheap → Nameservers → *Namecheap BasicDNS*. Hay que comprobar que sus host records siguen allí,
porque por eso se copian antes. Los servicios del dueño no cambian de IP en ningún caso.

Mientras los nameservers sigan en Namecheap, Cloudflare puede marcar la zona como «moved» y borrarla días después.
Si ocurre, se recrea: los registros están en esta guía.

## Contratos

### Ollama: `https://clb-ollama.leonardoserrate.xyz`

- API nativa: `POST /api/chat`, `POST /api/generate`, `GET /api/tags`; modelo `qwen3:8b`, contexto 4096.
- Cabeceras obligatorias: `CF-Access-Client-Id` y `CF-Access-Client-Secret` del token `clb-backend-ia-ollama`.
- Solo lo llama el backend IA, nunca el frontend. Desde el 10-nov el backend IA corre en la VM de Azure del
  integrante ([../azure/LEEME.md](../azure/LEEME.md) §16), con estas variables en `/srv/clb/.env.ventas`:
  ```
  CLB_IA_OLLAMA_URL=https://clb-ollama.leonardoserrate.xyz
  CLB_IA_OLLAMA_ACCESS_ID=<client id>
  CLB_IA_OLLAMA_ACCESS_CLAVE=<client secret>
  ```
  Requiere la versión del código con `fuente/infraestructura/ollama.py`, `configuracion.py` y `arranque.py`
  actualizados (9-nov). Envía las cabeceras solo a Ollama; sin esas variables se comporta igual que antes.

### VTON: `https://clb-vton.leonardoserrate.xyz`

Contrato asíncrono de [VTON.md](../../microservicios/inteligencia-artificial/VTON.md):
- `GET /salud`.
- `POST /api/v1/probador/trabajos` (multipart: `persona`, `prenda`, `identificador`, `categoria`, `force_regenerate`)
  → 202 `{identificador, estado}`.
- `GET /api/v1/probador/trabajos/{clave}` hasta `LISTO` o `ERROR`.
- `GET …/{clave}/imagen`: PNG con `X-Contenido-SHA256`.
- `DELETE` de la colección o de un trabajo.

Requisitos:
- Cabeceras `CF-Access-Client-*` del token `clb-pasarela-vton`, **más** el `Authorization: Bearer <JWT del usuario>`.
  El worker valida emisor, audiencia `clb-api` y rol `cliente`/`admin`.
- Access no usa ni altera `Authorization`. No se activó la lectura del token de servicio desde esa cabecera.

Cambio en la pasarela del dueño, sobre `infraestructura/pasarela/nginx.conf`. Los valores van en un archivo incluido
fuera del repositorio, cargado en el bloque `http`:
```nginx
# /etc/nginx/secretos/vton-access.conf (privado)
map "" $clb_vton_access_id     { default "<client id>"; }
map "" $clb_vton_access_secret { default "<client secret>"; }
```
```nginx
set $vton https://clb-vton.leonardoserrate.xyz;     # reemplaza http://ia-vton:8000; requiere su «resolver»

location = /salud/probador {
    proxy_pass $vton/salud;
    include /etc/nginx/clb-vton-proxy.conf;
}
location ^~ /api/v1/probador/ {
    if ($request_method = OPTIONS) { return 204; }
    proxy_pass $vton$uri$is_args$args;              # ruta completa, sin quitar prefijo
    include /etc/nginx/clb-vton-proxy.conf;
    client_max_body_size 18m;
    proxy_read_timeout 120s;                        # el POST valida las imágenes; la inferencia es asíncrona
    proxy_intercept_errors on;
    error_page 502 503 504 530 = @vton_no_disponible;   # 530: túnel desconectado (PC apagado)
}
```
```nginx
# /etc/nginx/clb-vton-proxy.conf
proxy_set_header Host clb-vton.leonardoserrate.xyz;
proxy_ssl_server_name on;
proxy_ssl_name clb-vton.leonardoserrate.xyz;
proxy_ssl_verify on;
proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
proxy_connect_timeout 5s;
proxy_set_header CF-Access-Client-Id     $clb_vton_access_id;
proxy_set_header CF-Access-Client-Secret $clb_vton_access_secret;
# Authorization del usuario: nginx lo reenvía tal cual; no se sobrescribe.
```

### Keycloak que necesita VTON

En `infraestructura/tunel-gpu/.env` (sin secretos; hoy apunta al Keycloak local):
- `CLB_IDENTIDAD_EMISOR`: el `iss` exacto de los tokens del realm `clb` del equipo.
- `CLB_IDENTIDAD_INTERNO`: la URL base pública desde la que este PC descarga
  `<base>/realms/clb/protocol/openid-connect/certs`.

El realm debe coincidir con `infraestructura/identidad/realm-clb.json`:
- roles de realm `cliente`, `admin` y `servicio`;
- client scope `clb-api` con mapper de audiencia `clb-api` y roles de realm en el token.

Tras cambiar el `.env`: `.\gpu.ps1 -Modo vton` (recrea el worker).

## Operación antes de presentar

Orden de encendido:
1. **Azure:** `cd ..\azure; .\vm.ps1 -Accion iniciar`.
   `curl.exe -s https://ventas.leonardoserrate.xyz/salud` debe responder ACTIVO tras ~1 min.
2. **Energía:** cargador conectado y suspensión desactivada (ver abajo).
3. **Docker Desktop** abierto, hasta que `docker info` responda.
4. **Ollama:** la aplicación de la bandeja. `curl.exe -s http://127.0.0.1:11434/api/tags` debe listar `qwen3:8b`.
5. **GPU:** `cd ..\tunel-gpu; .\gpu.ps1 -Modo ambos` (VTON precarga en ~4,5 min y qwen3:8b queda 30 min en VRAM).
6. **Túnel:** `Get-Service cloudflared` en Running (arranca solo); `curl.exe -s http://127.0.0.1:20241/ready`.
7. **Comprobaciones:**
   - `python ..\tunel-gpu\comprobar.py` (local, Keycloak local);
   - remotas, con los tokens del archivo privado:
     `curl.exe -s -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://clb-vton.leonardoserrate.xyz/salud`.
8. Avisar al compañero y comprobar desde el frontend: compra, reporte con IA y foto en el probador.

### Evitar la suspensión y restaurar

1. Anotar los valores actuales: buscar «Current AC Power Setting Index» en
   `powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` y `powercfg /q SCHEME_CURRENT SUB_BUTTONS LIDACTION`.
2. Durante la presentación:
   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0      # cerrar la tapa no suspende
   powercfg /setactive SCHEME_CURRENT
   ```
3. Restaurar:
   ```powershell
   powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE <segundos anotados>
   powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION <valor anotado>
   powercfg /setactive SCHEME_CURRENT
   ```

Pausar las actualizaciones de Windows ese día.

### Al terminar, sin borrar datos

```powershell
.\gpu.ps1 -Modo detener                    # detiene VTON y descarga qwen3:8b; volumen y pesos intactos
cd ..\azure; .\vm.ps1 -Accion desasignar   # PowerState/deallocated
```
- `cloudflared` puede seguir como servicio: sin VTON ni Ollama, las rutas responden 502 detrás de Access.
- Para cortar también el túnel: `Stop-Service cloudflared` (consola de administrador).
- Nunca usar `docker compose down -v`.

### Coordinación de VRAM

| Modo | Efecto |
|---|---|
| `ambos` | Ambos caben, pero al límite (pico 7,8 / 8,15 GB) |
| `vton` | Ejecuta `ollama stop qwen3:8b`: la VRAM queda en ~3,1 GB |
| `ollama` | Detiene el worker y conserva su volumen |
| `detener` | Libera los dos |
| `estado` | Muestra VRAM, modelos cargados, worker y túnel |

## Fallos habituales y lo que ve el usuario

| Situación | Respuesta técnica | Usuario |
|---|---|---|
| PC apagado, suspendido o sin Internet | Cloudflare responde **530** (túnel sin conector) | Probador: 503 `VTON_NO_DISPONIBLE` si la pasarela incluye 530 en `error_page`; puede abrir sus fotos guardadas. Reportes y agentes: el backend IA informa «modelo no disponible» (`NO_DISPONIBLE`) |
| Túnel activo pero VTON u Ollama detenidos | 502 desde cloudflared | Igual que arriba |
| Falta el token de Access o es incorrecto | 401 de Access | El servicio del compañero falla: revisar sus variables |
| JWT de usuario inválido o emisor distinto | 401 del worker; 503 `IDENTIDAD_NO_DISPONIBLE` si no alcanza el JWKS | «Inicia sesión» o error de sesión |
| `CUDA out of memory` | ERROR reintentable en el trabajo | Reintento; `.\gpu.ps1 -Modo vton` |
| Ollama 403 | Falta `httpHostHeader: localhost` en la ruta | — |

Logs:
- `docker logs --tail 50 clb_worker_vton_tunel`;
- registro de la aplicación Ollama (`%LOCALAPPDATA%\Ollama\server.log`);
- eventos de Windows (Aplicación, origen `cloudflared`);
- Cloudflare: Networking → Tunnels → IAJuridica → Live logs.

## Resultados verificados (9-nov-2026)

| Prueba | Resultado |
|---|---|
| GPU | RTX 5060 Laptop, compute capability 12.0. Imagen `clb_ia_vton:local` con `TORCH_CUDA_ARCH_LIST=12.0+PTX` (no el 7.5 de Azure) |
| Exposición | Ollama y VTON solo en 127.0.0.1 (11434 y 18081); cerrados desde la LAN. PostgreSQL y el daemon Docker no se publican por el túnel |
| Rutas de Ollama por el túnel (10-nov-2026) | Con token: `/api/tags` 200; `/api/delete`, `/api/pull`, `/api/create`, `/api/ps`, `/api/version`, `/` y `/api/chat/../delete` → 404. Sin token 401. IA en Azure → `/api/chat` 200 |
| VTON local | sano en 253–269 s; inferencia con JWT local en 97,6 s y 49,4 s; sin token 401; persistencia tras reinicio |
| VRAM | VTON + qwen3:8b juntos: pico 7 838 / 8 151 MiB, sin OOM. Liberación efectiva en los modos `vton` y `ollama` |
| Por Cloudflare, Ollama | sin token 401; con el token de VTON 401; con su token 200; `/api/chat` respondió en 7 s |
| Por Cloudflare, VTON | sin token 401; con token, `/salud` ACTIVO; sin JWT de usuario 401; trabajo real LISTO en 73 s; PNG con SHA-256 verificado. JWT del Keycloak **local** |
| Código IA | `pytest pruebas/test_puertos.py pruebas/test_ollama.py` con `CLB_ANALITICA_PUERTO=5433`: 12 de 12 aprobadas, incluida la nueva prueba de cabeceras de Access |

En este PC hay otro PostgreSQL escuchando en 5432. Sin `CLB_ANALITICA_PUERTO=5433`, `test_puertos.py` queda
esperando a un servidor que no arranca: `PoolTimeout` por autenticación. Es del entorno, no del código.

## Pendiente

- [x] Migración de nameservers (10-nov-2026).
- [x] Keycloak del equipo en `.env`; inferencias reales de usuarios del equipo.
- [x] Backend IA en Azure con el Keycloak del equipo y el token de Ollama.
- [x] Pasarela del compañero enviando trabajos VTON; reporte con IA descargado en PDF desde la tienda.
- [ ] Correo de prueba al dominio tras el cambio de NS (MX y SPF resuelven igual; no se envió ninguno).
- [ ] `comprobar.py` usa el Keycloak **local** para el JWT: contra el túnel con el Keycloak del equipo falla en el paso del trabajo (`NO_AUTENTICADO`); salud y rechazos 401 pasan.
- [ ] Contenedor viejo `clb_worker_vton_pc` (de un compose retirado): detenido. Puede retirarse con
      `docker rm clb_worker_vton_pc`; no borra volúmenes.
