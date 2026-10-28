/**
 * Contrato versión 1 entre el shell Angular y el probador (<clb-probador>). Mismos tipos que
 * `aplicaciones/probador-virtual/fuente/dominio/contrato.ts`: el shell no conoce React ni TensorFlow.js.
 */
export const VERSION_CONTRATO = 1;
export const EVENTO_RESULTADO = "probador-resultado";
/** Evento opcional: una vez por sesión de cámara de la RA, el rendimiento medido en este dispositivo. */
export const EVENTO_RENDIMIENTO = "probador-rendimiento";

export interface RendimientoProbador {
  contrato: 1;
  modo: "ra";
  /** Estimaciones de pose por segundo (mediana de 30 cuadros con el modelo definitivo de la sesión). */
  imagenesPorSegundo: number;
  modelo: "blazepose-full" | "blazepose-lite";
}

/**
 * Propiedad DOM `prenda` que fija el shell: la prenda con la que se abre el probador. La propiedad opcional `catalogo`
 * (lista de `PrendaProbador`) ofrece prendas para combinar con ella (una de arriba y una de abajo). Sin `catalogo`, el
 * probador funciona como antes, con una sola prenda.
 */
export interface PrendaProbador {
  recurso?: {color: string; anclas?: {izquierda: number; derecha: number; arriba: number; abajo: number; estampados?: number[][]}};
  identificador: string;
  sku: string;
  nombre: string;
  categoría: string;
  /** URL de la ilustración de la prenda con fondo transparente. */
  imagen: string;
  /** Fotografía PNG/WebP para difusión; la imagen local puede ser un SVG con anclas. */
  imagenFotografica?: string;
  /** Opcional: modelo 3D generado al preparar la foto y su espalda (deducida o fotografiada) para la realidad aumentada. */
  modelo3d?: { modelo: unknown; espalda: string };
  /** Tallas que tienen variante en esta prenda (vacío = desconocidas). */
  tallas: string[];
}

export interface ModelosUsados {
  pose: string;
  tallas: { versión: number; exactitud: number; origen: "red" | "guardado"; descargado: string } | null;
}

/**
 * Modos de prueba. Propiedad DOM opcional `modos`: el anfitrión limita los que se ofrecen (Android usa solo `ra` y
 * resuelve los otros dos de forma nativa). Sin `modos`, se ofrecen todos los disponibles.
 */
export type ModoProbador = "ra" | "fotografico" | "local";

/** Detalle del evento `probador-resultado`. Nunca incluye la imagen ni las medidas. */
export interface ResultadoProbador {
  contrato: typeof VERSION_CONTRATO;
  prenda: { identificador: string; sku: string };
  talla: string | null;
  probabilidades: Record<string, number>;
  /** null si el shell no informó las tallas de la prenda. */
  tallaDisponible: boolean | null;
  pose: { detectada: boolean; puntuación: number };
  modelos: ModelosUsados;
  fecha: string;
}
