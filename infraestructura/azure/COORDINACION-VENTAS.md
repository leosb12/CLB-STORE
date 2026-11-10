# Coordinación Ventas (Azure) ↔ compañero (GCP/AWS, DNS)

Contratos tomados del código: `microservicios/ventas` (`application.properties`, `ConfiguracionSeguridad.java`, controladores), `infraestructura/pasarela/nginx.conf`, `infraestructura/automatizacion/generar-flujos.py`, `infraestructura/identidad/realm-clb.json` y el cliente de IA (`configuracion.py`, `servicios_rest.py`). Los secretos se comparten **solo por canal seguro**, nunca en este archivo ni en un chat grupal.

Estado (auditoría del 10-nov-2026, 02:50 hora de Bolivia):
- **Desplegado e integrado.** Ventas, IA, worker_prendas y sus dos PostgreSQL en `clb-ventas-vm` (52.162.217.223); DNS en Cloudflare.
- El compañero entregó todo lo de la sección A, y ya hay tráfico real de su pasarela, n8n, la tienda y la app. Detalle en [LEEME.md](LEEME.md) («Estado» y §15).
- Las secciones A–E quedan como registro del contrato acordado.

La entrega completa al compañero (Ventas + Ollama + VTON + DNS) está en la sección E. La versión con credenciales
reales vive **solo** en `%USERPROFILE%\clb-privado\entrega-companero.md`, fuera del repositorio.

## A. Lo que necesito del compañero

| # | Dato | Para qué |
|---|---|---|
| 1 | **Issuer exacto** del token, p. ej. `https://<keycloak>/…/realms/clb`. Debe coincidir carácter a carácter con el claim `iss` | `CLB_IDENTIDAD_EMISOR` |
| 2 | **URL base de Keycloak** accesible desde Azure, la que precede a `/realms/clb/protocol/openid-connect/{certs,token}` | `CLB_IDENTIDAD_INTERNO` (JWKS y token de servicio) |
| 3 | Confirmar el realm `clb` (ver detalle abajo) | Ventas valida audiencia y roles |
| 4 | **Secreto del cliente `clb-ventas`**, por canal seguro | `CLB_IDENTIDAD_SECRETO_VENTAS` |
| 5 | **URL base de Inventario** con estas rutas abiertas para la IP de Azure (ver detalle abajo) | `CLB_INVENTARIO_URL` |
| 6 | **URL base de Clientes** con `POST /api/v1/interno/fidelizacion/acreditaciones` y `…/reversas` abiertas para la IP de Azure (`@Roles("servicio")`) | `CLB_CLIENTES_URL` |
| 7 | **IP de salida estática** (no la de entrada) de: su Nginx `api.leonardoserrate.xyz`, IA y n8n | NSG 443 y `CLB_VENTAS_ORIGENES_INTERNOS` |
| 8 | Confirmar que IA (`CLB_VENTAS_URL`) y n8n (`CLB_VENTAS_URL`) apuntarán **directo** a `https://ventas.leonardoserrate.xyz`. Su pasarela responde 404 a `/api/v1/interno/` | IA lee `/api/v1/interno/eventos`; n8n (flujos B y C) lee eventos y sube comprobantes |
| 9 | Configurar el **registro DNS** de la sección C y avisar cuando resuelva | Certificado HTTPS |
| 10 | Una ventana coordinada para una **compra de prueba** `[PRUEBA]`: producto o variante de prueba con stock y un usuario de prueba con rol `cliente` | Verificar SAGA, puntos y eventos sin tocar datos reales |

Detalle del punto 3, realm `clb`:
- `accessTokenLifespan` 900;
- roles de realm `cliente`, `admin` y `servicio`;
- client scope `clb-api` con mapper de audiencia `clb-api`;
- cliente `clb-ventas` confidencial con *service account* y rol `servicio`;
- `clb-ia` y `clb-n8n` también con rol `servicio`, porque llaman a Ventas.

Detalle del punto 5, rutas de Inventario que usa Ventas:
- `GET /api/v1/variantes/{id}`
- `GET /api/v1/productos/{id}`
- `POST /api/v1/interno/reservas`
- `POST /api/v1/interno/reservas/{id}/consumir`
- `POST /api/v1/interno/reservas/{id}/liberar`

Todas llevan un token de servicio y las `POST` además `Idempotency-Key`.

**Límites fijos en el código de Ventas:** conexión de 2 s y lectura de 4 s hacia Inventario y Clientes. Si responden más lento, la SAGA reintenta (3 veces en la petición y luego en segundo plano con espera exponencial) y el pedido puede quedar `EN_REVISION` hasta completarse.

## B. Lo que le entrego

| Dato | Valor |
|---|---|
| URL | `https://ventas.leonardoserrate.xyz` |
| IP pública estática de Azure | **52.162.217.223** |
| IP de salida de Azure (para permitir a Ventas en Keycloak, Inventario y Clientes) | **52.162.217.223** (la misma) |
| URL que deben usar IA y n8n (`CLB_VENTAS_URL`) | `https://ventas.leonardoserrate.xyz`, directo, no vía `api.` |
| Disponibilidad | Solo durante presentaciones (encendido manual) y autoapagado a las 23:00 de Bolivia. Fuera de eso, Ventas no responde |

Rutas publicadas. Ventas valida el JWT (audiencia `clb-api`, roles en `realm_access.roles`):

| Método y ruta | Rol | Consumidor | Notas |
|---|---|---|---|
| `GET /salud` | público | Pasarela (`/salud/ventas`) | 200 ACTIVO o 503 DEGRADADO (comprueba PostgreSQL) |
| `POST /api/v1/pedidos` | cliente, admin | Frontend vía pasarela | `Idempotency-Key` UUID v4; cuerpo `{identificador, líneas:[{identificador_variante, cantidad}]}`; 201. SAGA síncrona: **hasta 90 s** |
| `GET /api/v1/pedidos?antes=&limite=` | cliente, admin | Frontend | Historial propio |
| `GET /api/v1/pedidos/{id}` | cliente, admin | Frontend | El admin ve cualquiera |
| `GET /api/v1/pedidos/{id}/comprobante` | cliente, admin | Frontend | Descarga del comprobante |
| `GET /api/v1/interno/eventos?desde=N&límite=1..100` | servicio, admin | IA, n8n | **Solo desde sus IP**; el resto recibe 404 |
| `POST /api/v1/interno/pedidos/{id}/comprobante` | servicio | n8n flujo B | **Solo desde su IP**; cuerpo binario de hasta 2 MB |

Límites de Caddy:
- `/api/v1/pedidos*` hasta 1 MB y 90 s;
- rutas con `;` → 400;
- todo lo demás (incluido `/mcp`) → 404;
- no hay CORS: lo pone su pasarela.

### Fragmento propuesto para su Nginx (`api.leonardoserrate.xyz`)

Basado en `infraestructura/pasarela/nginx.conf`. Se reenvía la ruta completa, sin quitar prefijos.

```nginx
# Caddy elige el sitio por Host: hay que enviar el de Ventas, no api.leonardoserrate.xyz.
location = /salud/ventas {
    proxy_pass https://ventas.leonardoserrate.xyz/salud;
    proxy_set_header Host ventas.leonardoserrate.xyz;
    proxy_ssl_server_name on;
    proxy_ssl_name ventas.leonardoserrate.xyz;
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
}
location /api/v1/pedidos {
    proxy_pass https://ventas.leonardoserrate.xyz;      # sin URI: conserva la ruta y la consulta originales
    proxy_set_header Host ventas.leonardoserrate.xyz;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_ssl_server_name on;
    proxy_ssl_name ventas.leonardoserrate.xyz;
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
    proxy_connect_timeout 5s;
    proxy_read_timeout 90s;
    client_max_body_size 1m;
    # VM desasignada: JSON en vez de la página HTML de nginx. Solo errores de nginx, no las respuestas de Ventas.
    error_page 502 504 = @ventas_no_disponible;
}
location @ventas_no_disponible {
    default_type application/json;
    return 503 '{"mensaje":"Las compras no están disponibles en este momento. Inténtalo más tarde.","código":"VENTAS_NO_DISPONIBLE"}';
}
# /api/v1/interno/ debe seguir respondiendo 404 en la pasarela: IA y n8n van directo a Azure.
```

Mientras la VM esté desasignada, `/salud/ventas` y `/api/v1/pedidos` fallan. Catálogo, SSO y el resto siguen funcionando.

## C. Registro DNS (lo configura el dueño del dominio). **Hecho el 9-nov en Namecheap**

También está replicado en la zona Cloudflare preparada para la migración de nameservers. Ver
[../tunel-gpu/LEEME.md](../tunel-gpu/LEEME.md#migración-dns-cambio-de-nameservers).

| Tipo | Nombre | Valor | Proxy | TTL |
|---|---|---|---|---|
| A | `ventas` | `52.162.217.223` | **Solo DNS (nube gris)** | Auto |

Por qué «solo DNS»:
- El NSG permite el 443 solo a IP concretas. Con proxy de Cloudflare el tráfico llegaría desde IP de Cloudflare.
- Let's Encrypt valida por HTTP en el puerto 80, directo a la VM.

No cambiar ningún otro subdominio, en particular `ia.` y `api.`. Si la zona tiene registros CAA, deben permitir `letsencrypt.org`.

## D. Mensajes para copiar

**1. Pedido de datos (enviar ahora):**

> Hola. Para desplegar Ventas en Azure (`https://ventas.leonardoserrate.xyz`) necesito:
> 1. El *issuer* exacto de Keycloak (`…/realms/clb`) y su URL base accesible desde Internet.
> 2. Confirmar que el realm `clb` tiene el cliente `clb-ventas` (confidencial, service account con rol `servicio`) y la audiencia `clb-api`. El secreto de `clb-ventas` pásamelo por privado, no en el grupo.
> 3. Las URL de Inventario y Clientes, con `/api/v1/interno/reservas*` (Inventario) y `/api/v1/interno/fidelizacion/*` (Clientes) permitidas para la IP de Azure, que te paso apenas se cree.
> 4. Las IP de **salida** estáticas de tu Nginx, de IA y de n8n.
> 5. Que IA y n8n usen `CLB_VENTAS_URL=https://ventas.leonardoserrate.xyz` (directo, porque la pasarela bloquea `/api/v1/interno/`).
> 6. Una ventana para hacer una compra de prueba marcada `[PRUEBA]`, con un producto y un usuario de prueba.

**2. IP creada (enviar ahora):**

> La VM de Ventas en Azure ya existe. IP pública estática: **52.162.217.223**.
>
> **DNS:** crea en Cloudflare un registro **A** `ventas` → `52.162.217.223`, **solo DNS (nube gris)**, TTL Auto. No toques otros subdominios. Si la zona tiene CAA, debe permitir `letsencrypt.org`. Avísame cuando esté y emito el certificado.
>
> **Autoriza 52.162.217.223** (es también la IP de salida de Ventas) en:
> - Keycloak: token y JWKS;
> - Inventario: `GET /api/v1/variantes/{id}`, `GET /api/v1/productos/{id}`, `POST /api/v1/interno/reservas`, `…/reservas/{id}/consumir`, `…/reservas/{id}/liberar`;
> - Clientes: `POST /api/v1/interno/fidelizacion/acreditaciones` y `…/reversas`.
>
> **Tu Nginx (`api.leonardoserrate.xyz`):**
> - Reenvía `/api/v1/pedidos` (ruta completa, sin quitar prefijo) y `/salud/ventas` → `/salud` a `https://ventas.leonardoserrate.xyz`.
> - Con `proxy_set_header Host ventas.leonardoserrate.xyz`, `proxy_ssl_server_name on` (SNI `ventas.leonardoserrate.xyz`) y `proxy_ssl_verify on`.
> - Con `proxy_connect_timeout 5s`, `proxy_read_timeout 90s` (la compra es síncrona) y `client_max_body_size 1m`.
> - Sugiero `error_page 502 504` con un JSON `VENTAS_NO_DISPONIBLE` para cuando la VM esté apagada.
> - Mantén `/api/v1/interno/` en 404 en la pasarela.
> - El fragmento completo está en la sección B de `COORDINACION-VENTAS.md`.
>
> **IA y n8n:** `CLB_VENTAS_URL=https://ventas.leonardoserrate.xyz`, directo, no vía `api.`.
> - IA lee `GET /api/v1/interno/eventos?desde=N&límite=…`.
> - n8n lee eso mismo y hace `POST /api/v1/interno/pedidos/{id}/comprobante`.
> - Ambos con token de servicio (`clb-ia`, `clb-n8n`, rol `servicio`).
>
> **Mándame las IP de salida de tu Nginx, IA y n8n.** Sin ellas el 443 de Ventas solo acepta mi IP y las rutas internas responden 404.
>
> **Disponibilidad:** Ventas solo está encendida durante las presentaciones, con autoapagado a las 23:00 de Bolivia.

**3. Al terminar la integración:**

> Ventas responde en `https://ventas.leonardoserrate.xyz/salud`. Comprobado: <resultados>. Pendiente: <lista>.

## E. Entrega completa (actualizada el 10-nov-2026: backend IA, `clb_analitica` y worker_prendas pasan a Azure, §16 de LEEME.md)

El mensaje listo para enviar, que reemplaza a los mensajes 1 y 2, está en
`%USERPROFILE%\clb-privado\entrega-companero.md`. Incluye las credenciales de Access y **no se versiona**.

Cubre:
- arquitectura y responsabilidades;
- Ventas (URL, IP, rutas y Nginx);
- Ollama y VTON (URL, contratos, variables, cabeceras y Nginx);
- cambio de código IA para Access;
- migración DNS;
- disponibilidad;
- lo que él debe devolver.

Los contratos sin secretos son los de las secciones B y C de este archivo y de [../tunel-gpu/LEEME.md](../tunel-gpu/LEEME.md#contratos).

Credenciales que se entregan, solo por canal privado:

| Para | Variables o cabeceras | Origen |
|---|---|---|
| Backend IA → Ollama | `CLB_IA_OLLAMA_ACCESS_ID`, `CLB_IA_OLLAMA_ACCESS_CLAVE` | Token `clb-backend-ia-ollama`. Desde el 10-nov el backend IA está en Azure: el valor vive solo en `/srv/clb/.env.ventas` y **no** se entrega |
| Pasarela → VTON | `CF-Access-Client-Id`, `CF-Access-Client-Secret` | Token de servicio `clb-pasarela-vton` |
| Clientes → push y correo | `CLB_FIREBASE_SERVICE_ACCOUNT_BASE64`, `CLB_RESEND_API_KEY`, `CLB_SMTP_REMITENTE`, `CLB_NOTIFICACIONES_HABILITADAS`, `CLB_NOTIFICACIONES_CORREO_HABILITADO` | Cuenta de servicio Firebase `clb-store-cfbc3` y API de Resend del integrante. Las `CLB_SMTP_HOST/PORT/USER/PASS` no las lee el código |

La sección 5b del archivo privado indica en qué `.env` va cada valor: backend IA, pasarela, n8n y Clientes.

Ventas no entrega credenciales propias: sus consumidores usan tokens de su Keycloak, y Ventas usa el secreto de
`clb-ventas` que él emite.
