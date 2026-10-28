# Probador virtual — microfrontend React

Web Component `<clb-probador>` (React 19 + TypeScript + Vite 8 en modo biblioteca) que el shell Angular carga dentro de la
tienda. La vista local usa **TensorFlow.js + MoveNet**, superposición 2D o aproximación frontal 3D
y recomendación de talla con el **modelo supervisado de la fase 8**. Funciona sin conexión y
no envía la fotografía. El modo opcional **Fotografía con IA** sí envía foto y prenda al servidor
CatVTON configurado al pulsar «Generar imagen»; requiere conexión para generar.
Especificación vigente: [probador](../../docs/probador.md) e [ICONIX](../../docs/iconix/LEEME.md).

## Arquitectura (por funcionalidad, igual que Angular)
- `fuente/dominio/`: `tallas.ts` (validación del modelo exportado y softmax equivalente al servicio de IA), `pose.ts` (17 puntos,
  anclas por tipo de prenda y transformación afín), `contrato.ts` (contrato v1 con el shell).
- `fuente/aplicacion/`: `ProbarPrenda` (ajustar, recomendar talla, registrar la prueba) y sus puertos `DetectorPose`,
  `FuenteModeloTallas`, `RegistroPruebas`.
- `fuente/adaptadores/`: MoveNet con TF.js (WebGL o CPU), modelo de tallas por REST con copia en `localStorage`, registro local
  de las últimas 20 pruebas, y `elemento-probador.tsx` (custom element + `precargar()`), la integración con el shell.
- `fuente/presentacion/`: componente React, dibujo en `<canvas>` y CSS inyectado en el Shadow DOM (hereda los tokens del shell).

## Contrato con el shell (v1)
- `manifiesto.json` lista los archivos publicados: el shell los descarga al arrancar, sin ejecutarlos, para que su Service
  Worker los guarde.
- `import("/probador/probador.js")` registra `<clb-probador>` y exporta `precargar()`, que guarda el modelo de tallas (el shell
  la llama en el detalle de una prenda).
- Entrada: propiedad `prenda = { identificador, sku, nombre, categoría, imagen, tallas[] }`.
- Salida: evento `probador-resultado` (`bubbles`, `composed`) con `{ contrato: 1, prenda, talla, probabilidades,
  tallaDisponible, pose, modelos, fecha }`. Nunca incluye la imagen ni las medidas.

## Uso
```bash
npm ci
npm test          # pruebas del probador, incluida la equivalencia con el servicio de IA
npm run build     # dist/probador.js + modelos + manifiesto.json
npm run dev       # 127.0.0.1:14300, anfitrión mínimo sin Angular (el modelo de tallas sale de la pasarela 18000)
```
Despliegue: contenedor `clb_frontend_probador_react` (Compose, sin puerto publicado). La web lo publica en `/probador/`.
Prueba de navegador de punta a punta: `npm run pruebas:probador` en `aplicaciones/web` con el stack de Docker levantado
(usa ffmpeg para la cámara simulada; sin ffmpeg esa prueba se omite).

## Calibración
`ANCLAJES` en `fuente/dominio/pose.ts`: anclas medidas sobre las ilustraciones de la tienda (420 × 460) y dos perillas por tipo
de prenda, `ensanche` (ancho respecto de las articulaciones) y `alargue` (largo respecto de la línea inferior del cuerpo).

## Documentación vigente

- [Probador: estado, operación y límites](../../docs/probador.md): modos, conjuntos, RA de costado, cuello, preparación
  de prendas, matriz de aceptación y límites para la defensa.
- [Operación CatVTON](../../microservicios/inteligencia-artificial/VTON.md): GPU, versiones, privacidad y licencia.

Las auditorías y planes anteriores se consolidaron en `docs/probador.md`; los originales siguen en el historial de git
(commit `6999437`, carpeta `docs/planes/`).
