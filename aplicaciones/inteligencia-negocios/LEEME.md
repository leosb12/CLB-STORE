# Inteligencia de negocios — tablero Dash (`/bi/`)

Python 3.12 + Dash/Plotly. Es el cuarto frontend de CLB Store: un tablero solo web y solo para administradores, que se
abre desde **Gestión → «Inteligencia de negocios»** (otra pestaña, mismo origen `http://127.0.0.1:14200/bi/`).

Usa **exclusivamente el dataset sintético aislado** `demo_bi` (≈10.000 registros). No toca ventas, stock, puntos ni n8n.
Los dashboards de Angular y Flutter no cambian.

**Presentación (10-nov-2026, a pedido):** la pantalla se titula «CLB STORE · Inteligencia de negocios». Muestra solo
«N registros · actualizado el …», sin rótulos de demostración ni detalles técnicos (semilla, huella, comandos, esquemas).
Es un cambio solo visual:
- el origen sigue identificado internamente (`demo_bi`, `conjunto: DEMOSTRACION`, metadatos);
- los reportes y agentes conservan su interpretación «Datos sintéticos de demostración»;
- los CSV se descargan como `clb-bi-<tabla>.csv`.

## Qué muestra
- KPI: ingresos, pedidos, unidades, ticket promedio y clientes. Filtros por fechas (≤ 366 días,
  la misma regla que los reportes), categoría y producto.
- Evolución mensual, productos más vendidos y ventas por categoría.
- **K-Means (no supervisado):** dispersión por segmento, centroides y silueta. Se calcula una sola vez sobre el dataset
  completo a la fecha de corte y **no depende de los filtros de ventas**.
- **Regresión logística (supervisado):** exactitud, matriz de confusión, casos de entrenamiento y de prueba del modelo de
  tallas que ya usa la tienda (entrenado con medidas sintéticas de la tabla de tallas), y un simulador funcional.
- Conteos por tabla, semilla y huella SHA-256 del dataset.
- **Descarga en CSV** (UTF-8 con BOM, separador `;`, montos en centavos y en Bs con coma decimal; se abre directo en Excel):
  «Dataset completo» trae una fila por línea de venta (5.319) con su pedido, cliente, producto y stock actual. También se
  descarga cada tabla: clientes (1.000), pedidos (3.683), líneas de venta (5.319) y existencias (56). El tablero la pide a
  IA con el token del usuario (`GET /api/v1/demostracion/dataset/{nombre}.csv`, solo admin) y la entrega al navegador.
- «Generar reporte con estos filtros» guarda la misma especificación en el historial de reportes de Gestión, con Excel y PDF.

## Arquitectura
`fuente/dominio` (filtros y formato Bs) → `fuente/aplicacion` (casos de uso) → `fuente/adaptadores` (cliente de IA y SSO)
→ `fuente/presentacion` (Dash, figuras y `assets/clb.css` con los tokens de la web).

- **Sin fórmulas propias.** Los KPI salen de `indicadoresDemostracion` del GraphQL de gestión de IA. Cada bloque es una
  especificación de reporte v2 con `conjunto: DEMOSTRACION`, resuelta por el mismo motor que los reportes y que la herramienta
  MCP `obtener_indicadores_demostracion` del agente de reportes.
- **Sin acceso a bases.** Solo GraphQL (con el token del usuario) y `GET/POST /api/v1/tallas/*` (públicos), por la pasarela.
- **SSO (cliente Keycloak `clb-bi`, confidencial):** código + PKCE S256 con Authlib, que valida `state`, `nonce`, la firma
  (JWKS), `iss`, `aud` y `exp`. Los tokens quedan en memoria del servidor y la cookie `clb_bi_sesion` (HttpOnly,
  SameSite=Lax) solo lleva un identificador; nunca hay tokens en la URL. El permiso lo decide IA en cada consulta: sin rol
  admin se muestra «Se requiere rol administrador». «Salir del tablero» cierra solo la sesión del tablero.
- Un proceso de gunicorn con hilos, porque las sesiones viven en memoria. Reiniciar el contenedor obliga a pasar otra vez
  por Keycloak, sin contraseña si la sesión SSO sigue viva.

## Operación local
```powershell
# Desde infraestructura/bases-de-datos, con .env completo (CLB_IDENTIDAD_SECRETO_BI, CLB_BI_SECRETO_SESION, CLB_BI_ORIGENES)
python ..\identidad\preparar-identidad.py              # crea/actualiza el cliente clb-bi
docker compose -p clb-store up -d --build bi web       # la pasarela ya enruta /bi/
docker exec clb_backend_ia python -m fuente.infraestructura.dataset_demostracion generar
docker exec clb_backend_ia python -m fuente.infraestructura.dataset_demostracion entrenar
docker exec clb_backend_ia python -m fuente.infraestructura.dataset_demostracion estado
```
`generar` es determinista (semilla 7) e invalida la segmentación anterior. Hasta volver a `entrenar`, el tablero muestra
«Segmentación pendiente».

## Pruebas
```powershell
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q pruebas
```
Cubren el formato boliviano, los filtros, la delegación de KPI a IA y el OIDC con un Keycloak doble y un id_token RS256 real.
Se rechazan un `state` alterado, un `nonce` distinto, una audiencia ajena, un token vencido, una firma de otra clave y otro
emisor, y no hay tokens en la URL ni en la cookie.

## Límites
- Solo local (Azure, pendiente). Sin acceso móvil por decisión de alcance.
- Sin CSP en `/bi/`: Dash usa scripts en línea. Se envían `nosniff`, `no-referrer` y `X-Frame-Options: DENY`.
- Los nombres de los segmentos salen de las reglas de dominio existentes (por ejemplo, inactivo = más de 30 días sin
  comprar), pensadas para la tienda real; en un dataset de 22 meses varios grupos quedan como «Inactivos».
