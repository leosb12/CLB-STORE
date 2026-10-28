# Detector local de zonas de texto de prendas

PP-OCRv4, detector ONNX distribuido por RapidAI en rapidocr_onnxruntime1.4.4. Se extrae únicamente el detector, sin instalar ese paquete ni incorporar reconocimiento o generación de letras. Procedencia, URL fijada, tamaños y hashes en `microservicios/inteligencia-artificial/modelos-prendas/manifiesto-estampados.json`.

Licencia Apache-2.0: [declaración de RapidAI](https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/). Modelo original: [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR). El script de preparación verifica tanto el paquete como el ONNX; requiere red solo durante aprovisionamiento. Ejecutar `python microservicios/inteligencia-artificial/preparar-modelo-estampados.py` antes de habilitar el worker. Conservar licencia junto a cualquier redistribución de los pesos.

Los pesos locales `texto-prenda.onnx` son privados del despliegue e ignorados por Git. El worker los monta en solo lectura, verifica SHA-256, desactiva telemetría y falla explícitamente si faltan. Nunca descarga durante un trabajo. CPU, dos hilos; no afecta la inferencia TF.js/LiteRT de los clientes.

Inventario conserva `anclas.estampados` (hasta16 rectángulos normalizados referidos a la textura final). El detector señala zonas que deben conservar píxeles originales; no transcribe ni redibuja texto. Un array vacío declara análisis ejecutado sin texto detectado, no garantía de ausencia de gráficos. Bordados muy tenues, símbolos y dibujos sin letras pueden escapar; revisión de previsualización obligatoria. Los recursos método3 exigen el campo; métodos anteriores siguen siendo válidos pero no activan automáticamente transferencia de material.

La foto personal no entra en este pipeline: únicamente la foto del producto del administrador. Sin migración de bases, sin acceso a bases ajenas y sin servicios externos en ejecución.
