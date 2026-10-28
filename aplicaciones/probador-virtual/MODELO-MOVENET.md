# MoveNet SinglePose Lightning v4 (TensorFlow.js) — `public/modelos/movenet-lightning-4/`

- Origen: Google, Kaggle Models `google/movenet`, variante `tfJs/singlepose-lightning/4`
  (`https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-lightning/4/download/<archivo>`), descargado el 2026-10-22.
  TF Hub ya no sirve estos archivos.
- Licencia: Apache 2.0.
- Entrada `int32 [1, 192, 192, 3]`; salida `[1, 1, 17, 3]` con (y, x, confianza) normalizados de 17 puntos COCO.
- Se versiona en el repo para que el probador funcione sin Internet. SHA-256 (también en `modelos.sha256`, que el Dockerfile verifica antes del build):

```
c65a3447162efa0c42af29498a4b151f4415b36ff3ae6fae2b28a32e840dcbfb  model.json
b42c3232bf13b0efc691d3f0693dd3fc74404f709b1deee0a271828af6dbbea2  group1-shard1of2.bin
8253ab965aa3122c08f331777ca395ce9ca19bb9e7cb278b99de1c46dbdeb6dc  group1-shard2of2.bin
```
