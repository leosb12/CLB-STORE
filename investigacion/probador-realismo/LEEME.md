# CLB: laboratorio de segmentación semántica

**Historial y reproducción del laboratorio. El compositor TS/Dart y el modelo fijo se integraron posteriormente al modo por fotografía; estado operativo y límites en docs/probador.md. Los scripts Python siguen siendo experimentales y NO se ejecutan en los clientes.**

El usuario rechazó la calidad visual de la malla de `abb4610`. Antes de sustituirla, este laboratorio comprueba una dependencia necesaria para oclusión/materiales: ejecutar la misma red de segmentación en LiteRT y con operaciones de TensorFlow.js, sin un servidor de inferencia. No sustituye VTON generativo ni demuestra reconstrucción de zonas tapadas por ropa.

## Modelo y procedencia

Google MediaPipe SelfieMulticlass 256×256 float32, versión 1. Archivo de 16 371 837 bytes; SHA-256 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`.

- [Modelo oficial](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite).
- [Guía oficial y categorías](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter).
- [Ficha del modelo y licencia Apache 2.0](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf).

Google advierte que no está destinado a máscaras perfectas por píxel. Separar fondo, cabello, piel y ropa no permite recuperar la piel que una chaqueta oculta.

## Reproducción

Desde la raíz del repositorio, con dependencias npm del probador instaladas. Los pesos, constantes y tensores de laboratorio se guardan en `temporales/laboratorio-realismo`, ignorado por Git. No se incluyen fotos personales.

Preparación con conexión: descargar el archivo oficial al directorio indicado y comprobar su SHA-256 antes de continuar. No cargarlo desde una URL durante la inferencia. `uv` debe tener previamente en caché las versiones fijadas en estos comandos; el modo offline falla si faltan.

```powershell
uv run --offline --no-project --with tflite==2.18.0 --with numpy==2.2.6 python investigacion/probador-realismo/inspeccionar.py
uv run --offline --no-project --with tflite==2.18.0 --with numpy==2.2.6 python investigacion/probador-realismo/exportar.py
uv run --offline --no-project --with ai-edge-litert==2.3.0 --with numpy==2.2.6 python investigacion/probador-realismo/referencia.py
node investigacion/probador-realismo/paridad.mjs
```

Las herramientas Python se ejecutan en un entorno aislado de `uv`; no cambian las dependencias de IA ni los clientes. El script Node utiliza TF.js 4.22 del probador, no `tfjs-node`. Reproduce 175 operaciones de once tipos, libera intermedios al agotarse sus consumidores y conserva constantes hasta terminar.

## Resultado observado y alcance

Un tensor determinista de entrada `[1,256,256,3]`, semilla 20261023, valores entre 0 y 1. Comparación de los 393 216 valores de salida:

- Error absoluto máximo TF.js CPU frente a LiteRT CPU: `0,000018537044525146484`.
- Error absoluto medio: `0,0000006374655849109937`.
- Tensores TF.js restantes al cerrar: cero.
- Una inferencia observada: aproximadamente 0,04 s en LiteRT CPU Windows y 5–6 s en TF.js CPU Node. Son ejecuciones individuales, no p95 ni mediciones del Samsung o WebGL.

La salida nativa observada contiene valores negativos y mayores que uno: es una salida bruta, no probabilidades listas para usar. La lectura posterior de metadatos confirmó `(RGB-127,5)/127,5` y SOFTMAX; `metadatos.py` lee y comprueba los campos de los esquemas oficiales de TensorFlow Lite Support y MediaPipe.

Los informes `*-observada.json` conservan las etapas iniciales. La inspección de formato, por sí sola, marca inferencia/compatibilidad como no demostradas. Se añadió después una fotografía real y WebGL (ver abajo). Siguen pendientes integración Flutter y dispositivo físico. El laboratorio no valida un lector genérico de modelos TFLite ni garantiza paridad en otros modelos.

## Puerta antes de integrar

El usuario aprobó explícitamente fotografías con camiseta base lisa y ajustada el 23 de octubre de 2026. Esa condición permitiría investigar transferencia de textura conservando iluminación/silueta reales; no equivale a cambiar cualquier ropa por otra ni a mostrar la forma física exacta de la prenda seleccionada. No incorporar esa limitación silenciosamente al producto.

Si exige sustituir cualquier ropa, sigue sin haber una implementación fotográfica validada dentro de LiteRT+TF.js y modo avión independiente. No mostrar un montaje generado por otra herramienta o por un servidor GPU como evidencia de ese cumplimiento.

## Fotografía real y transferencia de material

Entrada de prueba: [Estefania Milazzo, Pexels17858295](https://www.pexels.com/photo/standing-man-in-jeans-and-white-t-shirt-17858295/), bajo [licencia Pexels](https://www.pexels.com/license/), consultada el 23 de octubre de 2026. Se incluye una copia de evaluación reducida en `fixtures/persona-base.jpg`; no sugiere respaldo del modelo o de la fotógrafa al producto. La foto tiene camiseta blanca frontal y brazos separados. No contiene al usuario.

Con los pesos ya descargados y el venv de IA disponible, desde la raíz:

```powershell
microservicios/inteligencia-artificial/.venv/Scripts/python.exe investigacion/probador-realismo/preparar_foto.py
uv run --offline --no-project --with tflite==2.18.0 --with numpy==2.2.6 python investigacion/probador-realismo/metadatos.py
uv run --offline --no-project --with ai-edge-litert==2.3.0 --with numpy==2.2.6 python investigacion/probador-realismo/foto_referencia.py
node investigacion/probador-realismo/paridad.mjs
microservicios/inteligencia-artificial/.venv/Scripts/python.exe investigacion/probador-realismo/probar_material.py
microservicios/inteligencia-artificial/.venv/Scripts/python.exe investigacion/probador-realismo/material.py --textura RUTA_LOCAL_A_TEXTURA_RGBA
python investigacion/probador-realismo/preparar_web.py
```

Preparar la prueba Vite en otra terminal: `npm run dev -- --strictPort`, dentro de `aplicaciones/probador-virtual`. Después ejecutar desde la raíz `node investigacion/probador-realismo/probar-navegador.mjs`. Requiere Chrome local y las dependencias existentes de Playwright; no descarga navegador. La prueba bloquea peticiones fuera de 127.0.0.1. Cerrar Vite al concluir. Los datos copiados a `temporales/` no se publican en el build del cliente.

Material: máscara semántica de ropa, selección de componente y restricción a camiseta clara neutra; filtro guiado por luminancia; piel/cabello de alta confianza protegidos; UV del torso separado de las mangas; descomposición aproximada de iluminación del producto y combinación en RGB lineal con sombras de la base. OpenCV/Python componen SOLO en este laboratorio. No es un adaptador cliente integrado ni se envían fotos a IA/backend.

Diez pruebas verifican conservación de piel/fondo y orden de sombras, entradas intactas y rechazo de entradas insuficientes/corruptas. No certifican realismo. En la foto real LiteRT y TF.js CPU difirieron como máximo en 2,155e-5; Chrome WebGL con SwiftShader obtuvo 100 % de acuerdo de clases, 2,742e-5 de diferencia máxima y cero tensores tras cerrar. SwiftShader es WebGL emulado en el PC, no una medida del Samsung.

**Puerta visual todavía NO superada.** La salida preserva mejor la silueta real, pero la textura arrugada del producto conserva pliegues ajenos y la transición de mangas pierde detalles. El método mantiene el corte de la camiseta base; no representa el corte/talla real de la prenda objetivo. No se desplegó, no cambió la APK y no se presenta como evidencia de una integración terminada. Debe resolverse fidelidad de material/estampados/mangas y evaluarse más fotos antes de integrar. No repetir pruebas de backend sin cambios: este bloque afecta solo al laboratorio.

## Implementación posterior al experimento

El usuario aprobó la silueta y solicitó limpieza/integración. El código ejecutado por el producto es ahora `aplicaciones/probador-virtual/fuente/dominio/material-camiseta.ts` y su port `aplicaciones/android/lib/dominio/material_camiseta.dart`; material.py conserva una comparación de laboratorio y no define el resultado productivo. La separación de sombras es aproximada y puede atenuar bordados de contraste bajo.

`probar-cliente.ts` y `probar_cliente.dart` consumen los mismos bytes/pose/probabilidades locales ignorados en temporales: paridad2.461.440bytes, error0. Los datos de textura privada no se publican. El script físico `infraestructura/demostraciones/validar-material-android.py` ejecuta las integraciones offline y restaura main.dart/conexión por USB. Leer bitácora para resultados finales y aceptación pendientes; las frases históricas anteriores no certifican el estado actual.

## Resultado vigente y antecedentes

Los experimentos Python anteriores documentan hipótesis de laboratorio, no el algoritmo final. La realización vigente es el compositor puro TS/Dart y los adaptadores de cliente, descritos en docs/probador.md. No usar capturas antiguas como evidencia actual. Se probaron cuatro fotos privadas del usuario y una referencia pública; no se versionan imágenes personales. El pipeline de producto incorpora detección local de zonas de texto, preservando trazos originales con límites explícitos. Aceptación visual abierta.
