# Requisitos y trazabilidad de aceptación

Fuente de requisitos: [requisitos del docente](../requisitos-docente.md) (destilado de apuntes/audio), contrastada con AGENTS.md y código. Los identificadores R1–R21 mantienen los del docente; las condiciones de la ampliación visual llevan prefijo RF para no renumerarlos.

| Requisito | Caso | Implementación / evidencia verificable |
|---|---|---|
| R1/R2: servicios y lenguajes | CU03/CU04/CU05 | `microservicios/{ventas,clientes,inventario,inteligencia-artificial}`; Compose y suites de cada servicio |
| R3/R4: Angular y React integrados | CU02 | Web Component `clb-probador`, contrato y `pruebas:probador` |
| R5: GraphQL solo empresarial | CU05 | `fuente/puertos/graphql.py`, consultas y pruebas de puertos IA |
| R6: agentes y misión empresarial | CU05 | EjecutarMision, agentes/MCP; `demo-gestion-ia.py` |
| R7: IA en móvil/navegador | CU02 | MoveNet TF.js/TFLite; pruebas de probador y `integration_test` Android |
| R8: offline, sincronización, idempotencia | CU02/CU03/CU04 | Suites persistencia, pedidos, administración; demo desconexión en ambos clientes |
| R9: transacción transversal | CU03 | SAGA Ventas–Inventario–Clientes; `demo-compra-saga.py`, compensaciones y repetición |
| R10: ML supervisado y no supervisado | CU02/CU05 | Modelo de tallas y AgrupadorKMeans; fixtures y pruebas de aprendizaje |
| R11: DL de imagen/video con TensorFlow | CU02 | MoveNet TensorFlow.js y LiteRT; pruebas de inferencia local |
| R12: automatización entre servicios | CU03/CU05 | Flujos n8n stock bajo y comprobante; demo-automatizacion.py |
| R13: reportes por audio/texto y exportación | CU05 | STT, reportes y xlsx; demo-gestion-ia.py |
| R14: MCP y mitigación de inyección | CU05 | GobiernoHerramientas y pruebas de puertos/gobierno |
| R15: PostgreSQL, MongoDB y DynamoDB | CU03/CU04/CU05 | Pruebas contra bases reales y propiedad por servicio |
| R16: entrada única y SSO | CU01 | Keycloak/PKCE y JWT en servicios; ensayo de identidad |
| R17: cuatro niveles | Todos | `docs/arquitectura/LEEME.md` y documentos de backend/frontend/datos/despliegue |
| R18: Hexagonal, DDD y CLEAR | CU03/CU04/CU05 | Núcleos y puertos de Inventario, Ventas e IA; separación de dependencias |
| R19: ICONIX | Todos | Modelo, casos/alternativos, robustez, secuencias y esta matriz |
| R20: versión preliminar escrita | Todos | CLB Documento.pdf original; documentación versionada actualiza el alcance y las erratas |
| R21: presentación 10 de noviembre | Todos | Guion de aceptación y bitácora de ensayo; pendiente defensa |
| Plataforma Android (R7/R8) | CU01–CU03 | Flutter, SQLite y TFLite; 3/3 integraciones físicas en RFCW80G3Q7F con modo avión y sin reverse |
| RF1: carga autorizada y durable | CU04.9 | RecursosProbadorHttpTest y AccesoOidcHttpTest |
| RF2: segmentación y anclas locales | CU04.9 | preparar_prenda.py, prendas_onnx.py; 12/12 + 4/4 sintéticos autorizados; generalización fotográfica no demostrada |
| RF3: publicación idempotente | CU04.9 | GestionarRecursosProbador y pruebas HTTP con MongoDB real |
| RF4: texturas offline íntegras | CU02/CU04.9 | recursos-dinamicos.test.ts; recursos_prendas_test.dart |
| RF5: ajuste equivalente Dart/TS | CU02 | `compartido/prendas/fixtures/ajuste-fotografico.json` y pruebas de ambos clientes |

## Distinción entre pruebas y demostración

Una prueba unitaria de transformación no demuestra segmentación real. Un fixture PNG sintético prueba integridad/persistencia, no realismo. Un emulador no demuestra funcionamiento ni consumo en el teléfono físico. Una captura con red no demuestra arranque frío sin conexión.

## Evidencia y límites de cierre

- El usuario sustituyó el conjunto externo por 12 casos válidos y 4 inválidos sintéticos/programáticos. IoU y error medidos en `docs/planes/resultado-cv-sintetico.json`; no demuestran calidad universal ni detección semántica de maniquíes.
- Cámara Web offline durante diez minutos: 180 tensores constantes en primera corrida, 180–182 en repetición final dentro del margen de inferencia en curso. Android físico: Samsung SM-S911U, Android 16, 7243744 kB RAM; diez inferencias de 57–120 ms. Evidencia detallada en la auditoría.
- Auditorías de dependencias y revisión visual ejecutadas con alcance y límites explícitos; no equivalen a certificación integral externa.
- Mermaid/Markdown disponibles; importación en EA/StarUML y conformidad del formato institucional no verificadas. La defensa académica y el ensayo completo de todos los procesos de venta permanecen fuera de la certificación de esta mejora.

Resultados ejecutados, omisiones y versiones se registran en `docs/probador.md` (matriz de aceptación vigente) y en la evidencia JSON de `docs/planes/`; esta matriz no marca automáticamente requisitos como aprobados por existir código.

Extensión de CU02: regiones articuladas en Domain de ambos clientes, fixtures comunes y pruebas geométricas/raster; E2E verifica codos visibles, aviso parcial, ambas mangas con encuadre de torso y recarga offline. La prueba física de material se ejecutó en Samsung con cuatro fotografías personales y sin red; no reutilizar esos tiempos para cámara continua o para otros dispositivos. Referencia: docs/probador.md.

## Extensión verificada de material (aceptación visual abierta)

| Requisito | Caso | Implementación y evidencia |
|---|---|---|
| Privacidad y runtime offline | CU02 | Segmentador TF.js / compositor LiteRT; E2E sin POST de foto y Samsung en modo avión sin reverse API |
| Cobertura y oclusión | CU02 | CampoCamiseta puro TS/Dart; fixture oscuro común, cuatro fotos físicas y referencia pública independiente |
| Diseño original y proporción | CU02/CU04.9 | DetectorEstampadosLocal; protección de bordado tenue y gráfico cuadrado en TS/Dart; no generación de letras |
| Recursos antiguos | CU02/CU04.9 | Metadato aditivo, modo anterior disponible; pruebas de contrato PHP/Web/Flutter |
| Arquitectura R17 | Todos | Cuatro niveles actualizados, inferencia personal cliente / preparación producto IA / propiedad Inventario |
| ICONIX R19 | CU02/CU04.9 | Cursos alternativos, robustez, objetos técnicos y secuencia local actualizados |

La primera foto privada de laboratorio no fue el único caso: cuatro entradas en el teléfono y una referencia pública para contraste. Es una muestra acotada; no prueba generalización universal. Los intentos fallidos y omisiones se conservan en la bitácora. Importación EA/StarUML y aprobación docente siguen sin verificarse.

## Auditoría VTON del 24 de octubre de 2026

CU02.1 conserva R5/R7/R8/R11/R16/R17/R18: REST, modo TensorFlow local, cola Android
durable, JWT, capas y datos privados. Pruebas de referencia: `test_probador_vton.py`,
`fotografico.test.ts`, `cola_generaciones_test.dart`, `verificar-interfaz.mjs --generar`
y ensayo de `comprobar_vton_gpu.py` con Docker sin red. La corrección funcional no
certifica perfección visual ni ejecución física de la APK nueva; resultados exactos
y límites en [docs/probador.md](../probador.md).

Extensión de CU02.2 (conjunto) y del cuello de la vista rápida (26-oct-2026): `pruebas/conjunto.test.ts`,
`pruebas/ra-costado.test.ts` (conjunto RA y medición de costado), `pruebas/fotografico.test.ts` (cola encadenada y
reanudación), `pruebas/region-cuello.test.ts` + `test/dominio/region_cuello_test.dart` (fixture común), E2E
`conjunto.spec.ts` (RA y vista rápida) y `cola-fotografica.spec.ts` «conjunto con IA» (GPU real). Matriz en `docs/probador.md`.

## Cierre del 27 de octubre de 2026

| Requisito / CU | Evidencia ejecutada | Resultado |
|---|---|---|
| R7/R11 · CU02.3 RA en Android | APK en Galaxy S23: permiso, cámara en vivo, 0 peticiones externas, modo avión sin túnel, cámara liberada al cambiar de modo y en segundo plano (`dumpsys media.camera`) | ✅ (usuario confirmó la RA en vivo) |
| R7 rendimiento | Banco BlazePose en el S23: 8,6 img/s (full) y 10,4 (lite) con el cuadro de 640 px | ✅ ≥ 8 img/s |
| R12 · M03–M06, B01 | `flujos.test.mjs` 8+1, Ventas 42, Clientes 21, `demo-automatizacion.py`, base de n8n sin `access_token` en ejecuciones nuevas | ✅ |
| R16 · CU01 SSO | `guion-sso.md`: web → panel sin volver a autenticar (automatizado); app → Brave sin contraseña (usuario) | ✅ |
| Demo «apagar IA» | `demo-apagar-ia.py`: catálogo y SAGA sin IA, gestión 502 inmediato, reanudación por cursor | ✅ |
| R9 · CU03 | Compra SAGA (`demo-compra-saga.py`); la devolución se justifica en `arquitectura/backend.md` | ✅ compra · devolución documentada |
| CU04.9 ingesta | pytest IA 73, PHPUnit 148/149 (la de reinicio necesita el CLI de Docker), web 69, probador 63 | ✅ |
| R8 · CU04.10 existencias offline (móvil) | `cola_administracion_test.dart` (7) + `administracion_stack_test.dart` (stack real) + prueba manual en el S23: modo avión → pendiente → reconexión 8 → 10 | ✅ |
| R6/R13/R16 · CU05.1 gestión móvil | Pestaña Gestión en el S23 con admin.demo: resumen GraphQL y misión de 4 agentes | ✅ |
| CU04.9 desde el móvil | `administracion_stack_test.dart`: carga → LISTO con calidad → publicación con modelo 3D y espalda | ✅ |
