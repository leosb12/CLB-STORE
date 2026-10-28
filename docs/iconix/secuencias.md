# Diseño de secuencias

## CU01 — Identidad y perfil

```mermaid
sequenceDiagram
  actor U as Usuario
  participant UI as Aplicación
  participant K as Keycloak
  participant C as Clientes
  U->>UI: Iniciar sesión
  UI->>K: Authorization Code + PKCE
  K-->>UI: Retorno y código
  UI->>K: Intercambiar código/verificador
  K-->>UI: Tokens del realm clb
  UI->>C: GET/PUT perfil propio con token y versión
  C->>C: Verificar firma/iss/aud/sub y versión
  C-->>UI: Perfil o conflicto 409
```

## CU02 — Paquete y prueba offline

```mermaid
sequenceDiagram
  actor U as Cliente
  participant UI as Web / Android
  participant S as Sincronización
  participant I as Inventario
  participant L as Persistencia local
  participant P as ProbarPrenda
  participant M as MoveNet local
  participant G as Geometría local de regiones
  S->>I: Catálogo y recursos publicados
  I-->>S: Manifiesto + PNG
  S->>S: Validar contrato/tamaño/SHA-256
  S->>L: Activar generación completa
  Note over UI,L: Desconectar red y reiniciar aplicación
  U->>UI: Probar prenda con foto
  UI->>L: Leer textura y modelo local
  UI->>P: Imagen local + anclas
  P->>M: Inferir articulaciones
  M-->>P: Pose
  P-->>UI: Pose + ajuste base / motivo insuficiente
  UI->>G: Alfa preparado + anclas + pose local
  G-->>UI: Malla torso/mangas o fallback seguro
  UI->>UI: Dibujar textura local o fallback; explicar ajuste parcial
  Note over P,M: Sin llamada al servidor
```

## CU03 — Compra, repetición y compensación

La secuencia transversal está en [arquitectura backend](../arquitectura/backend.md). Detalle de reintento:

```mermaid
sequenceDiagram
  participant Q as Cola local del titular
  participant V as Ventas
  participant R as Repositorio de pedidos
  Q->>V: POST pedido UUID + clave estable
  V->>R: Buscar identidad/comprobante
  alt Primer envío
    V->>R: Persistir pedido y pasos SAGA
    V->>V: Ejecutar participantes con claves de paso
    V->>R: Persistir estado y outbox
  else Repetición con el mismo contenido
    R-->>V: Estado durable existente
  else Misma clave con contenido distinto
    V-->>Q: 409
  end
  V-->>Q: Pedido del titular
  Q->>Q: Guardar respuesta sin crear otra operación
```

## CU04 — Modificación optimista

```mermaid
sequenceDiagram
  actor A as Admin
  participant UI as Administración
  participant C as ModificarProducto
  participant R as Puerto repositorio
  A->>UI: Editar y guardar
  UI->>UI: Persistir propuesta + clave + versión
  UI->>C: PUT con token admin
  C->>C: Validar reglas y construir producto
  C->>R: Actualizar con versión esperada y comprobante
  alt Versión vigente
    R-->>C: Producto confirmado
    C-->>UI: 200
    UI->>UI: Releer catálogo vigente
  else Otra escritura ganó
    R-->>C: Conflicto
    C-->>UI: 409 con producto actual
    UI->>UI: Conservar propuesta para revisión
  end
```

## CU04.9 — Recurso fotográfico

```mermaid
sequenceDiagram
  actor A as Admin
  participant UI as Panel fotografía
  participant I as GestionarRecursosProbador
  participant R as MongoDB / archivos privados
  participant W as Worker IA
  participant CV as PrepararPrenda / ONNX
  UI->>I: Cargar archivo + clave + versión + color
  I->>R: Guardar original y trabajo PENDIENTE
  I-->>UI: 202 + identificador
  W->>I: Reclamar con identidad de servicio
  I->>R: CAS reclamo/vencimiento
  I-->>W: Trabajo y reclamo
  W->>I: Obtener original con reclamo
  W->>CV: Preparar localmente (timeout 60 s)
  alt Geometría suficiente
    CV-->>W: PNG + anclas normalizadas
    W->>I: Resultado con mismo reclamo
    I->>R: Verificar bytes y guardar LISTO
    UI->>I: Consultar y previsualizar (admin)
    A->>UI: Publicar
    UI->>I: Clave publicación + versión esperada
    I->>R: Activar referencia + comprobante + versión
    I-->>UI: PUBLICADO
  else Ambigua o timeout
    CV-->>W: Rechazo identificable
    W->>I: REQUIERE_REVISION / ERROR
    I-->>UI: Repetir fotografía, conservar recurso anterior
  end
  Note over W,I: Reclamo sustituido o vencido: 409, sin publicación
```

## CU05 — Reporte verificable

```mermaid
sequenceDiagram
  actor A as Admin
  participant UI as Gestión / voz
  participant R as GenerarReporte
  participant L as LLM local / STT local
  participant M as MCP / GobiernoHerramientas
  participant G as GraphQL / ConsultarAnalitica
  UI->>L: Voz a texto cuando corresponde
  UI->>R: Petición + destino/formato
  R->>L: Proponer especificación estructurada
  R->>R: Validar esquema y lista permitida
  R->>M: Herramienta fija autenticada
  M->>G: Consulta fija sobre modelo de lectura
  G-->>R: Datos reales + fecha de actualización
  R->>R: Verificar cifras, guardar reporte y generar xlsx
  R-->>UI: Resultado y exportación
  Note over R,G: Sin SQL arbitrario ni acceso a bases ajenas
```

## CU02 — Alternativa de material preparado (realización actual)

```mermaid
sequenceDiagram
  actor U as Cliente
  participant UI as React / Flutter
  participant L as Paquete local verificado
  participant P as MoveNet local
  participant S as Segmentador local TF.js / LiteRT
  participant C as Compositor puro TS / Dart
  U->>UI: Seleccionar modo material y foto frontal
  UI->>L: Leer textura, anclas y modelos
  UI->>P: Estimar hombros y cadera
  P-->>UI: Pose y confianza
  UI->>S: Segmentar foto en memoria
  S-->>UI: Probabilidades de seis clases
  UI->>C: Foto, pose, probabilidades y atlas con estampados
  alt Información suficiente
    C->>C: Máscara, oclusiones, borde y luz de camiseta base
    C-->>UI: Raster compuesto
    UI-->>U: Resultado y límites del corte base
  else Foto o recurso insuficiente
    C-->>UI: Motivo verificable
    UI-->>U: Repetir foto o preparar recurso; sin cambio silencioso de modo
  end
  Note over UI,C: Modo material local: sin API ni persistencia de fotografía personal
```

En CU04.9, el worker prepara segmentación/anclas y ejecuta detección de zonas de texto con ONNX local antes de entregar método3 a Inventario. No realiza reconocimiento ni síntesis de letras. Inventario valida las cajas, guarda archivos y publica mediante la misma escritura CAS/idempotente. Los diagramas de compra y SAGA no cambian.

## CU02.1 — Generación y eliminación de fotografía

```mermaid
sequenceDiagram
  participant U as Cliente
  participant C as Web o Android
  participant G as Pasarela
  participant V as Worker VTON del servicio IA
  participant M as Motor residente CUDA
  U->>C: Seleccionar foto y Generar (aviso previo)
  opt Android
    C->>C: Confirmar originales y solicitud en SQLite
  end
  C->>G: POST multipart + JWT
  G->>V: Validar titular, límites y contenido
  V-->>C: 202, identificador y estado
  V->>M: Inpainting con pesos locales y máscara protegida
  M-->>V: PNG completo
  V->>V: Publicar si sigue vigente la generación
  C->>G: Consultar estado e imagen con JWT
  G->>V: Leer resultado propio
  V-->>C: PNG, Cache-Control no-store
  C->>C: Guardar resultado; Android retira originales
  U->>C: Borrar / eliminar
  C->>C: Retirar vista, PNG y solicitud; persistir borrado pendiente
  C->>G: DELETE con JWT al conectar
  G->>V: Eliminar por titular
  V->>V: Retirar fila y PNG; invalidar publicación tardía
  V-->>C: 204
```

## CU02.3 — Realidad aumentada en Android (microfrontend en WebView)

```mermaid
sequenceDiagram
  actor U as Cliente
  participant P as PantallaProbador (Flutter)
  participant S as ServidorProbador (127.0.0.1)
  participant W as WebView · clb-probador
  participant B as BlazePose TF.js
  U->>P: Elegir «RA 3D»
  P->>S: iniciar() → URL efímera
  P->>W: cargar movil.html
  W->>S: GET probador.js, modelos, /prendas, /recursos/sha
  S-->>W: archivos de la APK o del almacén local (lista blanca)
  W-->>P: canal ClbProbador {listo, webgl}
  P->>W: clbAbrir({prenda, catalogo, modos:["ra"]})
  U->>W: Cámara
  W->>P: solicitud de permiso de cámara
  P->>U: permiso de Android
  P-->>W: grant()
  loop cada cuadro
    W->>B: estimar(cuadro ≤ 640 px)
    B-->>W: 33 puntos 3D + máscara
    W->>W: medir, suavizar, construir escena, dibujar
  end
  W-->>P: probador-rendimiento {img/s}
  P->>P: guardarPreferencia(ra_imagenes_por_segundo)
  U->>W: Calcular mi talla
  W-->>P: probador-resultado {talla, disponible}
  P-->>U: barra «Talla sugerida» · «Elegir talla»
  U->>P: cambiar de modo o salir
  P->>W: clbPausar() → la cámara se apaga
```

## CU04.9 — Ingesta con estándar de calidad

```mermaid
sequenceDiagram
  actor A as Administrador
  participant I as Inventario
  participant W as Worker IA
  A->>I: POST foto + color + versión (Idempotency-Key)
  W->>I: reclamar (token servicio)
  W->>W: fondo → 768×1024 → modelo 3D + espalda → medir → evaluar_prenda
  alt no apta
    W->>I: REQUIERE_REVISION + calidad (motivos)
    I-->>A: informe con bloqueos
  else apta o con avisos
    W->>I: LISTO + textura + espalda + modelo3d + calidad
    I->>I: validar contratos; rechazar si calidad = no_apta
    A->>I: publicar (aceptar_avisos si hay avisos)
    I-->>A: PUBLICADO, versión + 1
  end

## CU04.10 — Movimiento de stock sin red y reconexión

```mermaid
sequenceDiagram
  actor A as Administrador
  participant P as PantallaVariantesAdmin
  participant Q as Cola SQLite (operaciones)
  participant S as SincronizarPedidos
  participant X as ProcesadorExistencias
  participant I as Inventario
  A->>P: Entrada +2, motivo
  P->>Q: encolarOperacion(UUID, clave, versión_esperada)
  S->>X: enviar (sin red)
  X-->>S: SinConexion
  S->>Q: PENDIENTE, intentos+1, próximo intento
  Note over A,I: vuelve la conexión
  S->>X: enviar(misma clave)
  X->>I: POST /variantes/{id}/movimientos (Idempotency-Key)
  I-->>X: variante versión+1
  X-->>S: comprobante validado
  S->>Q: CONFIRMADA + respuesta
```
