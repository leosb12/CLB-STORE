# Datos de prueba del probador

- `modelo-tallas.json`: modelo exportado por el servicio de IA (`GET /api/v1/tallas/modelo`) y las probabilidades que el mismo
  servicio devolvió para cuatro perfiles (`POST /api/v1/tallas/recomendacion`). Comprueba que la inferencia offline del navegador
  da las mismas cifras que Python. Si se reentrena el modelo, regenerar ambos desde el servicio.
- `persona.jpg`: «Unidentified man, facing front, standing next to chair, posing for full-length studio portrait», Library of
  Congress (LCCN 2015649998), **dominio público**, vía Wikimedia Commons (miniatura de 960 px). Persona de cuerpo entero y de
  frente para la prueba de pose en el navegador.

- persona-torso.jpg: recorte del mismo retrato público persona.jpg: caja (24 % ancho, 13 % alto)–(80 % ancho, 65 % alto), PIL JPEG. Incluye hombros, codos y caderas para evaluar articulación con mayor resolución. No se modificó la pose ni se generó una persona.
