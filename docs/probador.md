# Probador virtual — estado, operación y límites

Documento único del probador (web y Android). Reemplaza las auditorías y planes que vivían en `docs/planes/` hasta el
26 de octubre de 2026; quedan en el historial de git (commit `6999437`, carpeta `docs/planes/`). La evidencia JSON sigue en
`docs/planes/evidencia-material/`, `docs/planes/evidencias/` y `docs/planes/resultado-cv-*.json`. El motor fotográfico
se detalla en `microservicios/inteligencia-artificial/VTON.md`.

## Qué es y por qué cada tecnología (pertinencia)

El probador es el lugar donde el cliente **elige sus prendas** (una de arriba y una de abajo, o un vestido), **elige cómo
probárselas** y **se las prueba**, con una recomendación de talla para cada prenda.

| Modo | Dónde corre | Tecnología | Requisito del docente |
|---|---|---|---|
| Realidad aumentada 3D | Dispositivo (web) | BlazePose 3D en TF.js (33 puntos con profundidad + máscara de persona) y malla Three.js ajustada al cuerpo medido | IA local en el navegador; DL con TensorFlow sobre video |
| Fotografía con IA | Servidor GPU de CLB | CatVTON (difusión) con máscara por DensePose y SCHP; cola durable en el cliente | Extensión autorizada por el usuario; sincronización e idempotencia |
| Vista rápida | Dispositivo (web y Android) | MoveNet en TF.js y TFLite; superposición por regiones (torso y mangas) | IA local en navegador y móvil; DL sobre imagen |
| Talla | Dispositivo | Regresión logística exportada a JSON | ML supervisado, también sin red |

Arquitectura: microfrontend React `<clb-probador>` (Web Component con Shadow DOM, `dominio/aplicacion/adaptadores/presentacion`)
dentro del shell Angular; Android en Flutter (Presentation/Domain/Data). Contrato v1 en
`aplicaciones/probador-virtual/fuente/dominio/contrato.ts` (copia en la web): propiedad `prenda` (prenda inicial),
propiedad opcional `catalogo` (prendas para combinar) y evento `probador-resultado` (uno por prenda). El probador no conoce
Angular, la sesión ni el token; el shell no conoce React ni TF.js.

## Conjuntos (arriba + abajo)

- Dominio puro `fuente/dominio/conjunto.ts`: ranuras `superior`/`inferior`; un vestido ocupa ambas y una prenda de abajo
  lo desplaza. Orden de dibujo y de generación: primero la de abajo.
- **RA**: `construirEscena(modelos[])` arma una malla por prenda; la de arriba pasa apenas por fuera del contorno real del
  pantalón (×1,03) y la prueba de profundidad la deja delante en la cintura. `MotorRA.ponerPrendas` usa un atlas por prenda.
- **Vista rápida**: `lienzo.dibujar` recibe `capas` (abajo → arriba). La malla articulada es solo para prendas de hombros;
  el pantalón usa el ajuste afín de cadera a tobillos.
- **Fotografía con IA**: CatVTON viste una prenda por pasada. La cola (`aplicacion/probador-fotografico.ts`) guarda la
  segunda prenda en la solicitud (`siguiente`) y, al quedar lista la primera, encola otra con su resultado como foto
  (`continuacion`/`base`). Si se cierra la página entre ambas, se retoma al abrir. Tarda el doble que una prenda.
- **Shell**: ruta `/probador` (también en la navegación) además de `/productos/:id/probador`; el catálogo para combinar
  sale de IndexedDB (sirve sin red). Nginx tiene una `location = /probador` porque la `location ^~ /probador/` de los
  archivos del microfrontend devolvía 301 a la ruta Angular.

## RA de costado y suavizado

`fuente/dominio/ra/cuerpo.ts` mide el cuerpo con escala **3D** (`anchoReal`: no se acorta al girar), acepta el hombro
tapado (confianza ≥0,15 si el otro ≥0,5), estima el giro por la profundidad z y por cuánto se acortan los hombros respecto
del mayor ancho visto de frente (`referencia`), centra el torso en la silueta cuando la persona está de perfil y no deja
que el brazo oculto corte la medida del pecho. `fuente/dominio/ra/suavizado.ts` aplica un filtro One Euro al giro, los
anchos y los radios, y conserva el último cuerpo 300 ms si una detección falla. BlazePose `full` (~20 img/s medidos en
Chrome headless) con paso automático a `lite` si la mediana supera 90 ms por cuadro.

## Cuello en la vista rápida

MoveNet marca la **articulación** del hombro, ~0,2 anchos de hombro por debajo del contorno: anclar la prenda ahí dejaba
el cuello interior de la foto plana sobre el pecho («cortaba el cuello»). `SOBRE_HOMBROS = 0.2` sube el borde superior
(en `calcularAjuste` y `articularPrenda`, TS y Dart) y `regionCuello(pose)` vuelve a dibujar el cuello y la cabeza de la
foto original sobre la prenda. Fixtures comunes TS/Dart: `compartido/prendas/fixtures/{ajuste-fotografico,regiones-resultado,region-cuello}.json`
(regenerar con `CLB_REGENERAR_FIXTURE=1 npm test` y portar el cambio a Dart).

## Preparación de prendas (administración)

- Modelos (una vez, con red): `python microservicios/inteligencia-artificial/preparar-modelo-prendas.py` (U²-Net ONNX,
  SHA-256 `8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491`) y `preparar-modelo-estampados.py`
  (PP-OCRv4). Pesos montados de solo lectura; la inferencia nunca descarga. Licencias en `compartido/modelos/`.
- Activar: `CLB_RECURSOS_PROBADOR=true` en el `.env` local de Compose y
  `docker compose --profile prendas up -d --wait inventario ia-prendas web probador` (predeterminado del código: `false`).
- Administración → editar producto → «Fotografía para el probador»: guardar el producto, cargar la prenda frontal
  aislada, indicar color, preparar, revisar y publicar. El worker genera textura, modelo 3D y espalda deducida.
- Rollback: `CLB_RECURSOS_PROBADOR=false`, recrear solo Inventario y detener `ia-prendas`. No borrar volúmenes; los
  recursos publicados siguen disponibles para los clientes.
- Límites: hasta 32 trabajos visuales por producto (documento MongoDB acotado); sin recolección automática de huérfanos.

## Estándar de calidad de la ingesta

Toda foto de prenda pasa un control antes de publicarse (dominio puro `fuente/dominio/calidad_prenda.py`; medición en
`fuente/infraestructura/calidad_cv.py` sobre la silueta y el modelo 3D). Umbrales calibrados con el catálogo y con
candidatas de PNGimg revisadas a ojo (falsos positivos y negativos corregidos: recortes transparentes, máscara invertida
por U²-Net, prendas puestas en una persona).

| Comprobación | Bloquea (no se publica) | Avisa (se publica solo aceptándolo) |
|---|---|---|
| Prenda encontrada | ocupa < 3 % de la foto | — |
| Varias piezas | otra silueta > 8 % de la principal | — |
| Recortada | toca el borde de una foto con fondo | — |
| Resolución | lado menor < 300 px | < 500 px |
| Forma | alto/ancho fuera del rango de su categoría | — |
| Simetría (IoU con su reflejo) | < 0,55 (doblada o muy girada) | < 0,75 |
| Fondo | — | borde semitransparente > 12 % (sombra o fondo mal separado) |
| Persona | — | > 1,5 % de piel (manos o piernas de quien la lleva; una prenda beige o rosada puede dar falso aviso) |
| Modelo 3D | pantalón sin dos perneras | prenda superior sin modelo (no tendrá RA) |
| Mangas | — | ninguna o una sola reconocida (en la RA se vería sin mangas) |

- Una foto ya recortada (PNG con fondo transparente) usa su propio alfa: es la separación exacta, y U²-Net podía invertirla.
- Flujo: el worker devuelve el informe; no apta → `REQUIERE_REVISION` con cada motivo; con avisos → `LISTO` y Inventario
  exige `aceptar_avisos: true` al publicar (409 `AVISOS_SIN_ACEPTAR`). Inventario también rechaza (422) un resultado
  `LISTO` cuyo informe diga `no_apta`: lo grave no se publica aunque el worker se contradiga. El recurso publicado guarda `calidad`, `modelo3d` y
  la `espalda` (otra textura verificada, publicada junto a la frontal). La web la descarga a IndexedDB: la RA de una prenda
  ingerida funciona sin red.
- Panel: guía de foto antes de subir, etapas de la preparación, informe con bloqueos y avisos primero (con medida y
  objetivo), «Entiendo los avisos» obligatorio para publicar con avisos y «Elegir otra fotografía» ante un rechazo.
- Alta por la ingesta real: `python infraestructura/demostraciones/sembrar-prendas-ingesta.py` (repetible; originales y
  procedencia en `compartido/prendas/ingesta/`). Colección del 27-oct: 3 jeans, 2 buzos con capucha, 1 polerón y 2 suéteres,
  todas «apta».
- Catálogo evaluado el 27-oct: los dos jeans de demostración (`CLB-FOTO-JEA-CLA/OSC`, girados y con sombra) no cumplían y se
  **eliminaron** (producto, variantes, archivos y recursos empaquetados); respaldo en
  `temporales/respaldos/prendas-eliminadas-2026-10-27/`. Se conservan pedidos, reservas pasadas y el registro de eventos
  (IA y n8n lo leen por cursor). El vestido tiene aviso de resolución (304 px); el resto, apto.
- Cierre del 27-oct (revisión de código aplicada): pytest IA 72 en la suite completa + 1 nueva (aviso «Persona»), PHPUnit 148/149 (la prueba de
  reinicio de MongoDB necesita el CLI y el socket de Docker; no se ejecutó para no reiniciar el stack), web 69, probador
  63. Inventario y worker de prendas redesplegados; la siembra repetida no duplica nada. La APK aún incluye los jeans
  retirados hasta la próxima compilación.

## RA 3D en Android (27-oct)

- Es el mismo `<clb-probador>` en una WebView (`lib/presentacion/vista_ra.dart`), servido desde `127.0.0.1` por
  `ServidorProbador`, con `modos=["ra"]`. Android conserva nativos la vista rápida (TFLite) y la foto con IA (cola SQLite).
- Verificado en un Galaxy S23 (Android 16, WebView 155):
  - permiso de cámara de Android pedido desde la WebView y video en vivo de 720×960;
  - 0 peticiones externas, también en **modo avión y sin `adb reverse`**;
  - la cámara se libera al cambiar de modo, al salir y en segundo plano (`dumpsys media.camera`);
  - el usuario confirmó la RA en vivo.
- **Rendimiento:**
  - con cuadros de 960 px, 6 img/s;
  - el detector analiza una copia ≤ 640 px (los modelos trabajan a 224/256): 8,6 img/s (full) y 10,4 (lite);
  - la RA pasa sola a `lite` si la mediana supera 90 ms.
- **Talla en el móvil:** la barra muestra «Talla sugerida» y en qué se basa (medidas ingresadas, cálculo en el teléfono y
  exactitud del modelo en su prueba). No muestra la probabilidad de esa talla, porque no está calibrada. Si la talla no
  existe en la prenda: «Ver tallas disponibles».
- La pantalla del probador es siempre clara: el componente web y las fotos se diseñaron sobre fondo claro.

## Interruptores locales (para demo o diagnóstico)

- Web: `localStorage.clb_probador_modo` (`ra`/`fotografico`/`local`), `clb_probador_regiones=false` (vuelve al ajuste
  afín), `clb_probador_material=false` (sin tejido sobre camiseta base).
- Android al compilar: `--dart-define=CLB_PROBADOR_REGIONES=false`, `CLB_PROBADOR_MATERIAL=false`.
- Bancos de desarrollo (no se publican): `aplicaciones/probador-virtual/herramientas/spike-ra.html` y `spike-local.html`
  con `npx vite --port 5199`; `npm run dev` abre el probador con el catálogo de demostración.

## Matriz de aceptación vigente

| # | Criterio | Evidencia | Resultado |
|---|---|---|---|
| 1 | IA local sin red (pose y talla) | `probador.spec.ts`, `camara.spec.ts`, `prendas-fotograficas.spec.ts`; `dispositivo_test.dart` | Pasa web; Android 4/4, TFLite p95 109 ms |
| 2 | Conjunto arriba + abajo en RA, vista rápida e IA | `conjunto.spec.ts` (2), `cola-fotografica.spec.ts` «conjunto con IA» (GPU real, 2 envíos, 1 imagen final, 1,3 min) | Pasa |
| 3 | Prenda de arriba delante del pantalón y sin abrirse | `ra-costado.test.ts` (conjunto RA) | Pasa |
| 4 | Medición de costado (0°, 45°, 80°) y suavizado | `ra-costado.test.ts` (cuerpo sintético) | Pasa; sin video real de perfil: falta la prueba del usuario con su cámara |
| 5 | Cuello no cortado en la vista rápida | `region-cuello.test.ts` + Dart; E2E `data-cuello=original`; captura antes/después | Pasa |
| 6 | Paridad TS ↔ Dart (mangas, ajuste, cuello) | fixtures comunes a 1e-6 | Pasa |
| 7 | Foto con IA pedida sin red no se pierde; caída del worker | `cola-fotografica.spec.ts` (2), `cola_vton_local_test.dart` | Pasa |
| 8 | Reintentos, idempotencia e integridad | `fotografico.test.ts`, `cola_generaciones_test.dart`, `test_probador_vton.py` | Pasa |
| 9 | Privacidad | Logout borra fotos y resultados locales; el servidor no guarda originales | Pasa |
| 10 | Halo y color de CatVTON | `halo.py`, `color.py` | Costura ≤0,9; fondo ΔE>3 1,3–2,2 %; color: roja 4,8 ✓, gris 8,8 revisión, negra 10,7 falla (límite del modelo) |
| 11 | VRAM de la demo | `nvidia-smi` con worker VTON + `qwen3:8b` | 7 808 / 8 151 MiB; arrancar primero Ollama y luego el worker |
| 13 | Estándar de calidad en la ingesta | `test_calidad_prenda.py` (reglas y medición), `RecursosProbadorHttpTest` (rechazo con motivos, avisos aceptados, espalda publicada), `recursos-dinamicos.test.ts` (espalda sin red), captura del panel en 3 estados | Pasa; 8 prendas nuevas aptas por la ingesta real; 2 jeans no aptos eliminados |
| 12 | Accesibilidad | Nav a 320 px sin desborde; estados anunciados; borrado con confirmación | Pasa web; TalkBack pendiente |

## Límites que se explican en la defensa

- La RA es geometría paramétrica sobre el cuerpo medido, no un escaneo ni simulación de tela. La espalda es deducida.
  De perfil la prenda es aproximada; no hay 360° garantizado.
- La vista rápida superpone la foto de catálogo: la prenda puede verse angosta, una camisa abierta muestra su interior y
  la chaqueta azul pierde las mangas que cuelgan pegadas al cuerpo en la foto plana. Puede quedar visible la ropa propia.
- CatVTON puede variar color, texto o anatomía; aclara prendas negras y grises. Licencia CC BY-NC-SA 4.0 (uso académico).
- Calidad comercial requeriría un conjunto de personas y prendas con consentimiento, colores calibrados y aceptación humana.
  Las suites en verde no equivalen a «siempre perfecto».
