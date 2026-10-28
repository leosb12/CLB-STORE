// Anfitrión mínimo para desarrollar el probador sin el shell Angular (las prendas salen de la web local por el proxy).
import "./adaptadores/elemento-probador";
import type { PrendaProbador } from "./dominio/contrato";

const elemento = document.querySelector("clb-probador") as HTMLElement & { prenda: PrendaProbador | null; catalogo: PrendaProbador[] };
const prenda = (base: string, nombre: string, categoría: string): PrendaProbador => ({ identificador: base, sku: `DEV-${base}`, nombre, categoría, imagen: `/prendas/${base}.svg`, imagenFotografica: `/prendas/${base}.png`, tallas: ["S", "M", "L"] });
elemento.catalogo = [
  prenda("polera-gris", "Polera gris", "Poleras"),
  prenda("camisa", "Camisa negra", "Camisas"),
  prenda("vestido", "Vestido burdeos", "Vestidos"),
];
elemento.prenda = null;
elemento.addEventListener("probador-resultado", (e) => console.info("[CLB probador]", (e as CustomEvent).detail));
