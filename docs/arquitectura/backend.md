# R17 — Nivel backend

## Límites y comunicación

```mermaid
flowchart LR
  W[Web Angular / Android] --> G[Gateway Nginx]
  G --> K[Keycloak: OIDC / PKCE]
  G --> I[Inventario: Laravel / Hexagonal]
  G --> V[Ventas: Spring Boot / DDD]
  G --> C[Clientes: NestJS / capas]
  G --> A[IA: FastAPI / CLEAR]
  V -->|REST servicio: reservar / consumir / liberar| I
  V -->|REST servicio: acreditar / revertir| C
  A -->|REST con cursor| V
  A -->|REST con cursor y catálogo| I
  A -->|REST perfiles| C
  N[n8n local] -->|eventos y APIs internas| I
  N --> V
  N --> C
  N --> A
  P[Worker de prendas del servicio IA] -->|reclamar / original / resultado| I
```

Gateway enruta; cada backend verifica firma JWT, emisor, audiencia y rol. Las rutas `/api/v1/interno/` no se publican. Keycloak es identidad, no propietario del catálogo ni de pedidos.

| Servicio | Reglas propias | Arquitectura y dependencias |
|---|---|---|
| Inventario | SKU, precio BOB, variantes, stock, reservas, recursos de prenda | Dominio y aplicación independientes; puertos de salida implementados por MongoDB/filesystem; adaptadores HTTP |
| Ventas | Pedido, total confirmado por servidor, SAGA y comprobante | Dominio sin Spring; aplicación orquesta mediante puertos; JDBC/HTTP en infraestructura |
| Clientes | Perfil por titular, fidelización y deduplicación | Presentación → negocio → datos; repositorios DynamoDB |
| IA | Especificación de reportes, gobierno de herramientas, tallas y procesamiento visual | Dominio/aplicación hacia adentro; FastAPI, GraphQL y MCP como puertos; ONNX, OpenCV, Ollama, STT y PostgreSQL en infraestructura |

GraphQL existe solo en gestión empresarial. Tienda, Android y comunicación entre servicios utilizan REST. MCP expone herramientas fijas y auditadas; el LLM no recibe SQL ni acceso directo a bases.

## Compra distribuida

```mermaid
sequenceDiagram
  participant U as Cliente
  participant V as Ventas
  participant I as Inventario
  participant C as Clientes
  U->>V: Confirmar UUID + Idempotency-Key
  V->>I: Reservar variantes (clave estable)
  I-->>V: Reserva durable
  V->>C: Acreditar puntos (clave estable)
  alt Acreditación y consumo correctos
    V->>I: Consumir reserva
    V-->>U: CONFIRMADO
  else Falla definitiva del participante
    V->>I: Liberar reserva
    V->>C: Revertir puntos incluso si la respuesta previa se perdió
    V-->>U: CANCELADO / estado de compensación
  else Respuesta temporal incierta
    V-->>U: EN_REVISION
    Note over V: Reanudador retoma pasos persistidos
  end
```

No hay rollback global. Las claves de pasos se conservan; una respuesta perdida no justifica repetir con otra identidad. Outbox y cambio del pedido se confirman juntos en PostgreSQL.

## R9 — La compra como transacción transversal (y por qué no se implementó la devolución)

El docente pidió una acción que involucre al menos tres microservicios sin rollback global y sugirió SAGA. Su ejemplo
fue una devolución. La **compra** cumple el mismo requisito con una SAGA real y probada con fallas:
Ventas orquesta → Inventario reserva → Clientes acredita → Inventario consume. Ante una falla definitiva se compensa:
se libera la reserva y se revierten los puntos.
- `demo-compra-saga.py` la demuestra deteniendo Clientes de verdad.
- Las claves de cada paso son fijas y el reanudador retoma las SAGA interrumpidas.

La devolución sería la SAGA inversa y reutilizaría piezas idempotentes que ya existen:
- Ventas registra la devolución de un pedido CONFIRMADO;
- Inventario hace la ENTRADA de las unidades;
- Clientes revierte los puntos con `reversas` (idempotente por pedido);
- si Clientes falla, Inventario compensa con una SALIDA.

Se dejó como extensión documentada (decisión del equipo, 27-oct). Repetiría el mismo patrón sin demostrar un concepto
nuevo, y el tiempo se priorizó en requisitos sin cubrir.

## Preparación visual (ampliación desactivada)

El administrador carga una fotografía de producto. Inventario conserva original privado y trabajo en el mismo documento. IA reclama con vencimiento, procesa y entrega resultado. El administrador revisa y publica mediante versión esperada. Este flujo administrativo no recibe fotos personales.

La publicación incrementa la versión comercial una sola vez. Una modificación simultánea, resultado tardío o clave con otros datos se rechaza. Las referencias publicadas por hash permanecen disponibles tras reemplazarlas. Fallar IA no cambia stock ni compras.

Un proceso worker adicional sigue perteneciendo al servicio IA: no publica API, no posee otra base y solo usa REST de Inventario. Concurrencia uno y proceso de inferencia terminable tras 60 s. No añadir ONNX a Laravel ni pasar credenciales MongoDB a IA.

## Preparación de material y estampados (actualización de implementación)

El adaptador de preparación IA CLEAR procesa fotografías de producto: U²-Net segmenta y un adaptador PP-OCRv4 ONNX local propone rectángulos de texto que deben conservarse. No reconoce ni genera letras. El worker inyecta ambos adaptadores y falla si faltan pesos precargados. Inventario Hexagonal valida método `u2net-perfiles-3`, anclas y hasta16 rectángulos; conserva propiedad de originales/resultados, CAS, arrendamiento e idempotencia. No se añade servicio público ni acceso a bases ajenas. Clientes en capas y Ventas DDD conservan sus contratos. Los modos locales procesan la foto personal exclusivamente en clientes. El modo generativo opcional la envía, con aviso previo, al worker CatVTON del mismo servicio IA; véase VTON.md.
