// Puente entre la app Android y <clb-probador> (contrato v1): Dart llama a clbAbrir/clbPausar/clbReanudar y escucha
// el canal ClbProbador.
import "./probador.js";

const canal = (mensaje) => window.ClbProbador?.postMessage(JSON.stringify(mensaje));
let datos = null;
let probador = null;

function montar() {
  probador = document.createElement("clb-probador");
  probador.addEventListener("probador-resultado", (e) => canal({ tipo: "resultado", detalle: e.detail }));
  probador.addEventListener("probador-rendimiento", (e) => canal({ tipo: "rendimiento", detalle: e.detail }));
  probador.modos = datos.modos;
  probador.catalogo = datos.catalogo;
  probador.prenda = datos.prenda;
  document.body.append(probador);
}

window.clbAbrir = (nuevos) => {
  datos = nuevos;
  probador?.remove();
  montar();
};
// Quitar el elemento lo desmonta: el componente apaga la cámara y detiene el análisis de pose.
window.clbPausar = () => {
  probador?.remove();
  probador = null;
};
window.clbReanudar = () => {
  if (datos && !probador) montar();
};
// Sin WebGL no hay RA: la app ofrece la vista rápida nativa en su lugar.
const lienzo = document.createElement("canvas");
canal({ tipo: "listo", webgl: !!(lienzo.getContext("webgl2") || lienzo.getContext("webgl")) });
