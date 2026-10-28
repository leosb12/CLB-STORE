# Análisis de robustez

Convención: B = boundary/interfaz, C = control/caso de uso, E = entidad. Los actores hablan con interfaces; las interfaces delegan en controles. Los repositorios/adaptadores realizan persistencia y no sustituyen las reglas de dominio.

```mermaid
flowchart LR
  U[Cliente] --> B1[B: catálogo / detalle / probador]
  B1 --> C1[C: consultar y sincronizar catálogo]
  C1 --> E1[E: Producto / Variante / Manifiesto]
  B1 --> C2[C: ProbarPrenda / RecomendarTalla]
  C2 --> E2[E: Pose / Ajuste / ModeloTallas]
  U --> B2[B: carrito / pedidos]
  B2 --> C3[C: ConfirmarPedido / SincronizarPedidos]
  C3 --> E3[E: Operacion / LineaCarrito]
  C3 --> B3[B: REST Ventas]
  B3 --> C4[C: ConfirmarPedido / OrquestadorSagaCompra]
  C4 --> E4[E: Pedido / Reserva / LineaPedido]
```

```mermaid
flowchart LR
  A[Administrador] --> B1[B: panel productos / fotografía]
  B1 --> C1[C: RegistrarProducto / ModificarProducto]
  C1 --> E1[E: Producto / CodigoSku / Precio]
  B1 --> C2[C: GestionarExistencias]
  C2 --> E2[E: Variante / Existencias / Movimiento]
  B1 --> B2[B: HTTP recursos autenticado]
  B2 --> C3[C: GestionarRecursosProbador]
  C3 --> E3[E: Trabajo / RecursoProbador]
  W[Worker IA] --> B2
  W --> C4[C: PrepararPrenda]
  C4 --> E4[E: AnclasPrenda / PrendaPreparada]
```

```mermaid
flowchart LR
  A[Administrador] --> B[B: panel gestión / voz]
  B --> C[C: EjecutarMision / GenerarReporte]
  C --> E[E: EspecificacionReporte]
  C --> G[C: GobiernoHerramientas]
  G --> M[B: MCP / GraphQL]
  M --> Q[C: ConsultarAnalitica]
  Q --> D[E: modelo de lectura / reporte / auditoría]
```

| Caso | Interfaces | Controles | Entidades y alternativos clave |
|---|---|---|---|
| CU01 | Sesión OIDC, retorno, perfil REST | iniciar/cerrar sesión, editar perfil | Titular/Perfil; estado PKCE inválido, token vencido, conflicto |
| CU02 | catálogo, detalle, cámara | sincronizar, probar, recomendar | Producto/Variante/Pose/Ajuste; descarga parcial y puntos insuficientes |
| CU03 | carrito, pedidos, REST internos | confirmar, SAGA, reanudador | Operación/Pedido/Reserva; compensaciones y repetición |
| CU04 | panel, HTTP admin | registrar/modificar/existencias | Producto/Variante/Movimiento; conflicto y rechazo |
| CU04.9 | carga, preview, REST worker | gestionar/preparar/publicar recurso | Trabajo/Recurso/Anclas; sustitución, timeout y geometría ambigua |
| CU05 | gestión, voz, MCP y GraphQL | misión/reporte/gobierno/consulta | Especificación/Reporte/Auditoría; inyección, concurrencia y datos antiguos |

La cámara y ONNX son adaptadores técnicos. No se los dibuja como entidades comerciales. El análisis no habilita llamadas directas de una pantalla a MongoDB o DynamoDB.

## CU02.1 — Fotografía generativa

```mermaid
flowchart LR
  U[Cliente] --> B1[B: probador · Foto con IA]
  B1 --> C1[C: ColaFotografica / ColaGeneraciones]
  C1 --> E1[E: SolicitudFotografica · clave por titular, foto, prenda, motor]
  C1 --> B2[B: REST /probador/trabajos + JWT]
  B2 --> C2[C: probador.py · deduplicar y encolar]
  C2 --> E2[E: TrabajoVton / ResultadoVton]
  C2 --> B3[B: worker CatVTON GPU]
```

## CU02.2 y CU02.3 — Conjunto y realidad aumentada 3D

```mermaid
flowchart LR
  U[Cliente] --> B1[B: probador web o WebView Android]
  B1 --> C1[C: elegir conjunto · conjunto.ts]
  C1 --> E1[E: Conjunto · arriba / abajo]
  B1 --> C2[C: usarRealidadAumentada]
  C2 --> B2[B: cámara / foto]
  C2 --> B3[B: DetectorBlazePose · TF.js]
  C2 --> C3[C: medirCuerpo · SuavizadorCuerpo · construirEscena]
  C3 --> E2[E: Cuerpo / ModeloPrenda3D / Escena]
  C2 --> B4[B: MotorRA · Three.js]
  B1 --> C4[C: RecomendarTalla]
  C4 --> E3[E: ModeloTallas]
  A[App Android] --> B5[B: ServidorProbador 127.0.0.1]
  B5 --> B1
```

## CU04.9 — Ingesta con estándar de calidad

```mermaid
flowchart LR
  A[Administrador] --> B1[B: panel de fotografía · guía, informe, aceptar avisos]
  B1 --> B2[B: HTTP recursos-probador]
  B2 --> C1[C: GestionarRecursosProbador]
  C1 --> E1[E: Trabajo / RecursoProbador · modelo3d, espalda, calidad]
  W[Worker IA] --> C2[C: PreparadorU2Net]
  C2 --> C3[C: evaluar_prenda · estándar]
  C3 --> E2[E: MedidasPrenda / InformeCalidad]
  C2 --> C4[C: construir_modelo_3d]
  C4 --> E3[E: Modelo3D / Espalda]
  C2 --> B2
```

## CU02 — Material fotográfico

```mermaid
flowchart LR
  U[Cliente] --> B[B: foto / selector / visor]
  B --> C[C: probar material local]
  C --> P[B: adaptador MoveNet]
  C --> S[B: adaptador segmentación TF.js / LiteRT]
  C --> M[E: pose / atlas / máscara / raster efímeros]
  C --> V[C: validar imagen / recurso / cobertura]
  V --> B
```

Atlas y máscara son objetos técnicos efímeros, no nuevos agregados comerciales. Los rechazos se muestran en la misma interfaz y no generan pedidos, reservas ni escrituras en Inventario. El detector ONNX de zonas de texto pertenece al límite de preparación de producto, nunca al flujo de foto personal.

## CU04.10 y CU05.1 — Administración y gestión en el móvil

```mermaid
flowchart LR
  A[Administrador] --> B1[B: pestaña Gestión · Existencias · hojas de movimiento]
  B1 --> C1[C: operacionExistencias · resolverVersion]
  C1 --> E1[E: Operacion · VarianteAdmin]
  B1 --> C2[C: SincronizarPedidos · cola única]
  C2 --> B2[B: ProcesadorExistencias / ProcesadorAtenderAlerta · REST + Idempotency-Key]
  B2 --> C3[C: GestionarExistencias · Inventario]
  B1 --> B3[B: AdministracionRest · GraphQL / REST]
  B3 --> C4[C: Consultas · EjecutarMision · GenerarReporte · IA]
```
