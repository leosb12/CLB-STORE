// Banco de desarrollo de la vista local (MoveNet + capas 2D + cuello). No se publica.
// ?foto=…&prenda=polera-gris,vestido (encuadres SVG 420×460 de la web, como en el shell).
import { DetectorMoveNet } from "../fuente/adaptadores/detector-movenet";
import { calcularAjuste, tipoDePrenda } from "../fuente/dominio/pose";
import { cargarImagen, dibujar, prepararArticulacion, type Capa } from "../fuente/presentacion/lienzo";

const q = new URLSearchParams(location.search);
const foto = await cargarImagen(q.get("foto") ?? "../pruebas/fixtures/persona.jpg");
const detector = new DetectorMoveNet("/modelos/movenet-lightning-4/model.json");
await detector.preparar();
const pose = await detector.detectar(foto, foto.naturalWidth, foto.naturalHeight);
const capas: Capa[] = [];
for (const nombre of (q.get("prenda") ?? "polera-gris").split(",").filter(Boolean)) {
  const imagen = await cargarImagen(`/prendas/${nombre}.svg`);
  prepararArticulacion(imagen);
  const tipo = tipoDePrenda(nombre.startsWith("jean") ? "Pantalones" : nombre.startsWith("vestido") ? "Vestidos" : "Poleras");
  const a = calcularAjuste(pose, tipo, imagen.naturalWidth, imagen.naturalHeight);
  // ?sincuello: diagnóstico, dibuja como si fuera pantalón (sin capa de cuello).
  capas.push({ prenda: imagen, transformación: a.ajustado ? a.transformación : null, tipo: q.has("sincuello") ? "pantalon" : tipo });
}
const lienzo = document.getElementById("c") as HTMLCanvasElement;
dibujar(lienzo, { fuente: foto, ancho: foto.naturalWidth, alto: foto.naturalHeight, capas, pose, verPuntos: q.has("puntos") });
(window as unknown as Record<string, unknown>).resultado = { ...lienzo.dataset };
