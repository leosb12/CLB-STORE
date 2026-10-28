# Inteligencia Artificial — gestión empresarial con agentes

Python 3.12 + FastAPI con **Clear Architecture (CLEAR)**. Es el sistema de gestión empresarial: agentes, GraphQL, MCP,
reportes generativos con exportación a Excel, voz local y aprendizaje automático. Su base privada es el **modelo de
lectura `clb_analitica`** (CQRS): nunca lee bases ajenas; recibe datos por eventos REST.

## Arquitectura (CLEAR)
Las dependencias apuntan solo hacia adentro; las capas internas definen interfaces (`Protocol`) que implementa la infraestructura.
- `fuente/dominio/`: especificación de reporte (listas cerradas y reglas de coherencia), tallas y tabla de referencia,
  nombres de segmentos, agentes y su **lista blanca** de herramientas. Usa pydantic solo como librería de validación.
- `fuente/aplicacion/`: casos de uso — `IngerirEventos`, `ConsultarAnalitica`, `GenerarReporte`, `EjecutarMision`
  (orquestador + 4 agentes, verificador de cifras), `GobiernoHerramientas` (lista blanca, auditoría, proponer reposición),
  `GestionarPropuestas`, `RecomendarTalla` — e `interfaces.py`.
- `fuente/puertos/`: REST (`rest.py`), GraphQL (`graphql.py`, Strawberry) y servidor MCP (`mcp.py`, SDK `mcp` 2.3). Solo traducen.
- `fuente/infraestructura/`: PostgreSQL (`analitica.py`), Ollama, cliente MCP, clientes REST con token de servicio `clb-ia`,
  faster-whisper, scikit-learn, openpyxl, validación JWT y la raíz de composición `arranque.py`.
- `pruebas/`: pytest.

## API (por la pasarela, 127.0.0.1:18000)
| Ruta | Rol | Qué hace |
|---|---|---|
| POST `/api/v1/agentes/misiones` `{mision}` | admin | Orquestador → agentes con herramientas MCP; respuesta con fuentes por agente |
| GET `/api/v1/agentes/propuestas[?estado=]` · POST `…/{id}/confirmar\|rechazar` | admin | Reposiciones propuestas por el agente; solo una persona las confirma |
| GET `/api/v1/agentes/auditoria` | admin | Misiones, herramientas invocadas y rechazos |
| POST `/api/v1/reportes` `{peticion}` o `{especificacion}` (+ `destino`) | admin | LLM → especificación validada → `generar_reporte` (MCP → GraphQL) → historial |
| GET `/api/v1/reportes[/{id}[/excel]]` | admin | Historial, reporte y exportación xlsx con gráfico nativo |
| POST `/api/v1/graphql` | admin | `resumenVentas`, `productos`, `stockBajo`, `alertas`, `segmentosClientes` |
| POST `/api/v1/voz` (multipart `audio`) | admin | Texto con faster-whisper local (máx. 5 MB y 60 s) |
| GET `/api/v1/tallas/modelo` · POST `/api/v1/tallas/recomendacion` | público | Modelo exportado en JSON para inferencia offline · recomendación orientativa |
| GET `/api/v1/tallas/mi-recomendacion` | cliente | Con las medidas del perfil de Clientes |
| `/mcp` | interno | MCP HTTP streamable; token admin + `X-Clb-Agente`; la pasarela **no** lo publica |
| GET `/salud` (`/salud/ia` en la pasarela) | público | PostgreSQL, Ollama y estado de la ingesta |

Errores: `{mensaje, código}`. 429 `OCUPADO` si ya hay una misión o un reporte en curso (la GPU atiende uno a la vez).

## Datos (`clb_analitica`)
`pedidos`, `lineas_venta`, `existencias`, `alertas_stock`, `cursores`, `eventos_procesados`, `eventos_rechazados`,
`reportes`, `auditoria_agentes` y `propuestas_reposicion`. El servicio crea las tablas al arrancar (idempotente). Ingesta cada
20 s: outbox de Ventas (`pedido_confirmado`/`pedido_cancelado`) y eventos de Inventario (`stock_bajo`) con cursor, lote y
cursor en una transacción, idempotencia por evento y eventos malformados apartados sin bloquear la fuente. La copia de
existencias desde el catálogo público se hace cada 5 ciclos. La base se crea con `crear-analitica.py` o, en un volumen vacío,
con `inicializar-analitica.sh`.

## Defensas contra la inyección de instrucciones
Esquemas cerrados (`Literal`, rangos), lista blanca por agente comprobada en el cliente y en el servidor MCP, token admin y
usuario verificado en cada llamada MCP, consultas GraphQL fijas (sin SQL ni filtros libres), ninguna escritura sin
confirmación humana (una propuesta abierta por variante), tope de llamadas por misión, texto del usuario y resultados como
datos delimitados, verificador de cifras (descarta redacciones con números que no salen de las herramientas), Excel sin
fórmulas y auditoría de todo. Sin LLM, todo funciona con plantillas «no generativas» sobre los mismos datos.

## Configuración
`CLB_ANALITICA_SERVIDOR/PUERTO/BASE/USUARIO/CLAVE/ESQUEMA`, `CLB_VENTAS_URL`, `CLB_INVENTARIO_URL`, `CLB_CLIENTES_URL`,
`CLB_IDENTIDAD_EMISOR`, `CLB_IDENTIDAD_INTERNO`, `CLB_IDENTIDAD_SECRETO_IA`, `CLB_IA_OLLAMA_URL`, `CLB_IA_MODELO` (`qwen3:8b`;
`qwen3:4b` si falta memoria), `CLB_IA_MODELO_VOZ` (`small`), `CLB_IA_INTERVALO_INGESTA` (20 s).
Para usar la voz sin Internet, precargar el modelo una vez: `docker exec clb_backend_ia python -m fuente.infraestructura.voz`.

## Pruebas
`.venv/Scripts/python.exe -m pytest -q -p anyio` (requiere `clb_postgres`; las de Ollama se omiten si no está). Incluye
dominio y ML, casos de uso con dobles, integración con PostgreSQL en un esquema temporal `clb_prueba_*` que se borra,
puertos de punta a punta (uvicorn + MCP HTTP + GraphQL + REST) y Ollama real. Dependencias de desarrollo: `requirements-dev.txt`.

Demostraciones: `python infraestructura/demostraciones/sembrar-gestion.py` (datos por APIs reales, repetible) y
`python infraestructura/demostraciones/demo-gestion-ia.py`.
