# Segmentación de camiseta base

Google MediaPipe SelfieMulticlass 256×256 float32, versión1, licencia Apache2.0 según la ficha oficial. Uso local por fotografía; no es un modelo VTON ni un estimador de talla. Clases: fondo, cabello, piel corporal, piel de rostro, ropa y accesorios. Normalización `(RGB−127,5)/127,5`; salida de logits seguida de softmax, comprobadas en los metadatos embebidos.

- Fuente: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite
- Ficha/licencia: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
- Guía: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- TFLite: 16371837bytes, SHA256 `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0`.

Android incluye el modelo en assets, comprueba hash y ejecuta LiteRT en isolate, con dos hilos y cierre del intérprete por foto. Web incluye exportación fija de175operaciones y constantes, ejecutadas con TensorFlow.js4.22; verifica descriptor y pesos por SHA256 antes de construir. Huellas en `aplicaciones/probador-virtual/modelos-semanticos.sha256`; el Dockerfile también las verifica. No hay descargas desde Google durante ejecución.

La exportación proviene del script `investigacion/probador-realismo/exportar.py`, que comprueba el hash TFLite original. No se admite cargar modelos o descriptores aportados por un usuario. Las constantes solo se interpretan tras validar la versión fija.

El manifiesto del microfrontend incluye ambos archivos para su precarga mediante el Service Worker existente. El primer paquete requiere conexión al servidor local; la inferencia posterior no necesita red ni autenticación renovada. La persistencia del navegador continúa sujeta a cuotas/desalojo; el APK incluye los pesos desde la instalación.

La red no garantiza máscaras perfectas ni reconoce por sí sola que una camiseta es apropiada. Se exige base lisa, clara, ajustada, pose frontal y brazos separados. La composición conserva el corte de la base; bordados de contraste bajo pueden atenuarse al limpiar ruido. Estas limitaciones se muestran en ambos clientes. No se transmite la fotografía personal a ningún backend.
