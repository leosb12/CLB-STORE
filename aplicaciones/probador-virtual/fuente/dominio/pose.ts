/**
 * Pose corporal (17 puntos en el orden de MoveNet) y ajuste 2D de una ilustración de prenda sobre el cuerpo.
 * No hay simulación de tela: la ilustración se traslada, rota y escala para que sus anclas coincidan con el cuerpo.
 */
export const PUNTOS = [
  "nariz", "ojo_izquierdo", "ojo_derecho", "oreja_izquierda", "oreja_derecha",
  "hombro_izquierdo", "hombro_derecho", "codo_izquierdo", "codo_derecho", "muñeca_izquierda", "muñeca_derecha",
  "cadera_izquierda", "cadera_derecha", "rodilla_izquierda", "rodilla_derecha", "tobillo_izquierdo", "tobillo_derecho",
] as const;
export type NombrePunto = (typeof PUNTOS)[number];

/** Coordenadas en píxeles de la imagen analizada; confianza entre 0 y 1. */
export interface PuntoClave {
  x: number;
  y: number;
  confianza: number;
}
export type Pose = PuntoClave[];

export const CONFIANZA_MINIMA = 0.3;

export type TipoPrenda = "superior" | "vestido" | "pantalon";

export function tipoDePrenda(categoría: string): TipoPrenda {
  const nombre = categoría.toLocaleLowerCase("es");
  if (nombre.includes("pantal")) return "pantalon";
  if (nombre.includes("vestid")) return "vestido";
  return "superior";
}

interface Anclaje {
  /** Par de puntos del cuerpo donde va el borde superior de la prenda. */
  arriba: readonly [NombrePunto, NombrePunto];
  /** Par de puntos del cuerpo donde termina la prenda. */
  abajo: readonly [NombrePunto, NombrePunto];
  /** Anclas en la ilustración, como fracción de su ancho y alto (las ilustraciones CLB miden 420 × 460). */
  imagen: { izquierda: number; derecha: number; arriba: number; abajo: number };
  /** Ancho de la prenda respecto de la distancia entre las articulaciones (las articulaciones quedan dentro del cuerpo). */
  ensanche: number;
  /** Largo de la prenda respecto de la distancia entre las dos líneas del cuerpo. */
  alargue: number;
}

// ponytail: anclas promedio por tipo, medidas sobre las ilustraciones de la tienda; con fotos reales de producto cada
// imagen traería sus propias anclas en el contrato. `ensanche` y `alargue` son las perillas de calibración.
export const ANCLAJES: Record<TipoPrenda, Anclaje> = {
  superior: {
    arriba: ["hombro_izquierdo", "hombro_derecho"],
    abajo: ["cadera_izquierda", "cadera_derecha"],
    imagen: { izquierda: 155 / 420, derecha: 266 / 420, arriba: 96 / 460, abajo: 381 / 460 },
    ensanche: 1.15,
    alargue: 1.1,
  },
  vestido: {
    arriba: ["hombro_izquierdo", "hombro_derecho"],
    abajo: ["rodilla_izquierda", "rodilla_derecha"],
    imagen: { izquierda: 170 / 420, derecha: 250 / 420, arriba: 82 / 460, abajo: 379 / 460 },
    ensanche: 0.95,
    alargue: 1.0,
  },
  pantalon: {
    arriba: ["cadera_izquierda", "cadera_derecha"],
    abajo: ["tobillo_izquierdo", "tobillo_derecho"],
    imagen: { izquierda: 147 / 420, derecha: 273 / 420, arriba: 83 / 460, abajo: 379 / 460 },
    ensanche: 1.7,
    alargue: 1.03,
  },
};

/** Transformación para dibujar: trasladar a (x, y), rotar, escalar y dibujar la imagen desplazada por (−origenX, −origenY). */
export interface Transformacion {
  x: number;
  y: number;
  ángulo: number;
  escalaX: number;
  escalaY: number;
  origenX: number;
  origenY: number;
}

export type MotivoSinAjuste = "SIN_PUNTOS_SUPERIORES" | "PERSONA_MUY_PEQUEÑA" | "POSE_DE_PERFIL";

export type Ajuste =
  | { ajustado: true; transformación: Transformacion; puntuación: number; largoEstimado: boolean }
  | { ajustado: false; motivo: MotivoSinAjuste; puntuación: number };

const punto = (pose: Pose, nombre: NombrePunto) => pose[PUNTOS.indexOf(nombre)];
const visible = (p: PuntoClave | undefined): p is PuntoClave => !!p && p.confianza >= CONFIANZA_MINIMA;
const medio = (a: PuntoClave, b: PuntoClave) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ponytail: proporción media; perilla de calibración. MoveNet marca la articulación del hombro, que queda por debajo
// del contorno del hombro y de la base del cuello: anclar ahí dejaba el cuello de la foto plana sobre el pecho.
/** Cuánto sube el borde superior de una prenda de hombros sobre la línea de articulaciones, en anchos de hombros. */
export const SOBRE_HOMBROS = 0.2;

/** Menos de este ancho entre articulaciones (px) no permite ubicar una prenda de forma creíble. */
const ANCHO_MINIMO = 12;
/** Con la línea de hombros (o de cadera) más inclinada que esto la inclinación es excesiva para este ajuste; no mide el giro del torso. */
const INCLINACIÓN_MÁXIMA = Math.PI / 4;

export function calcularAjuste(pose: Pose, tipo: TipoPrenda, anchoImagen: number, altoImagen: number, textura?: {izquierda: number; derecha: number; arriba: number; abajo: number}): Ajuste {
  const base = ANCLAJES[tipo];
  const valida = textura && [textura.izquierda,textura.derecha,textura.arriba,textura.abajo].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
    && textura.derecha-textura.izquierda > .05 && textura.abajo-textura.arriba > .05;
  const anclaje = valida ? {...base, imagen: textura, ensanche: 1, alargue: 1} : base;
  const [a, b] = anclaje.arriba.map((n) => punto(pose, n));
  const [c, d] = anclaje.abajo.map((n) => punto(pose, n));
  const requeridos = [a, b, c, d].filter(visible);
  const puntuación = requeridos.length ? requeridos.reduce((s, p) => s + p.confianza, 0) / 4 : 0;
  if (!visible(a) || !visible(b)) return { ajustado: false, motivo: "SIN_PUNTOS_SUPERIORES", puntuación };

  // Izquierda y derecha de la imagen, no del cuerpo: así da igual si la persona mira a la cámara o está de espaldas.
  const [izquierda, derecha] = a.x <= b.x ? [a, b] : [b, a];
  const anchoCuerpo = Math.hypot(derecha.x - izquierda.x, derecha.y - izquierda.y);
  if (anchoCuerpo < ANCHO_MINIMO) return { ajustado: false, motivo: "PERSONA_MUY_PEQUEÑA", puntuación };
  const ángulo = Math.atan2(derecha.y - izquierda.y, derecha.x - izquierda.x);
  if (Math.abs(ángulo) > INCLINACIÓN_MÁXIMA) return { ajustado: false, motivo: "POSE_DE_PERFIL", puntuación };

  const { imagen } = anclaje;
  const anchoAncla = (imagen.derecha - imagen.izquierda) * anchoImagen;
  const altoAncla = (imagen.abajo - imagen.arriba) * altoImagen;
  const escalaX = (anchoCuerpo * anclaje.ensanche) / anchoAncla;
  const articulaciones = medio(izquierda, derecha);
  // Prendas de hombros: el borde superior va sobre el contorno del hombro (perpendicular a la línea, hacia la cabeza).
  const sobre = tipo === "pantalon" ? 0 : SOBRE_HOMBROS * anchoCuerpo;
  const superior = { x: articulaciones.x + Math.sin(ángulo) * sobre, y: articulaciones.y - Math.cos(ángulo) * sobre };
  const conLargo = visible(c) && visible(d);
  // Sin la línea inferior (persona cortada en la foto) se conserva la proporción de la ilustración.
  // El largo se mide perpendicular a la línea superior: con el torso inclinado la prenda no se estira de más.
  const largo = conLargo ? Math.max(0, -(medio(c, d).x - superior.x) * Math.sin(ángulo) + (medio(c, d).y - superior.y) * Math.cos(ángulo)) : 0;
  const escalaY = largo > 0 ? (largo * anclaje.alargue) / altoAncla : escalaX;
  return {
    ajustado: true,
    puntuación,
    largoEstimado: !(largo > 0),
    transformación: {
      x: superior.x,
      y: superior.y,
      ángulo,
      escalaX,
      escalaY,
      origenX: ((imagen.izquierda + imagen.derecha) / 2) * anchoImagen,
      origenY: imagen.arriba * altoImagen,
    },
  };
}

/** Suaviza el temblor entre cuadros de video (promedio exponencial); con `peso` = 1 no suaviza. */
export function suavizar(anterior: Transformacion | undefined, nueva: Transformacion, peso = 0.45): Transformacion {
  if (!anterior) return nueva;
  const mezcla = (x: number, y: number) => x + (y - x) * peso;
  return {
    x: mezcla(anterior.x, nueva.x),
    y: mezcla(anterior.y, nueva.y),
    ángulo: mezcla(anterior.ángulo, nueva.ángulo),
    escalaX: mezcla(anterior.escalaX, nueva.escalaX),
    escalaY: mezcla(anterior.escalaY, nueva.escalaY),
    origenX: nueva.origenX,
    origenY: nueva.origenY,
  };
}

/** Suaviza posiciones visibles sin conservar ni aumentar una confianza perdida. */
export function suavizarPose(anterior: Pose | null, nueva: Pose, peso = 0.45): Pose {
  if (!anterior) return nueva;
  return nueva.map((p,i) => {
    const previo=anterior[i];
    return visible(p)&&visible(previo)
      ? {...p,x:previo.x+(p.x-previo.x)*peso,y:previo.y+(p.y-previo.y)*peso}
      : p;
  });
}

// ponytail: proporciones medias respecto del ancho entre hombros (W); son las perillas de calibración del escote.
/** Semiancho de la abertura del cuello, profundidad del escote bajo la línea de hombros y alto de la franja hacia la cabeza. */
export const CUELLO = { semiancho: 0.2, escote: 0.1, alto: 0.6 } as const;

/**
 * Polígono del cuello y la cabeza sobre el que se vuelve a dibujar la imagen original: la fotografía plana de la prenda
 * trae el cuello interior trasero, que tapaba el cuello real. Curva en U entre los puntos del cuello, sobre el borde
 * superior de la prenda (`SOBRE_HOMBROS`), que baja `escote` y sube `alto` hacia la cabeza. null sin los dos hombros.
 */
export function regionCuello(pose: Pose): { x: number; y: number }[] | null {
  const a = punto(pose, "hombro_izquierdo"), b = punto(pose, "hombro_derecho");
  if (!visible(a) || !visible(b)) return null;
  const [izquierda, derecha] = a.x <= b.x ? [a, b] : [b, a];
  const w = Math.hypot(derecha.x - izquierda.x, derecha.y - izquierda.y);
  if (w < ANCHO_MINIMO) return null;
  const c = medio(izquierda, derecha);
  const e = { x: (derecha.x - izquierda.x) / w, y: (derecha.y - izquierda.y) / w };
  // Perpendicular hacia la cabeza (y decrece hacia arriba en la imagen).
  const n = { x: e.y, y: -e.x };
  const en = (u: number, v: number) => ({ x: c.x + e.x * u * w + n.x * v * w, y: c.y + e.y * u * w + n.y * v * w });
  const { semiancho: s, escote: d, alto: h } = CUELLO;
  const curva = Array.from({ length: 9 }, (_, k) => {
    const u = s - (2 * s * k) / 8;
    return en(u, SOBRE_HOMBROS - d * (1 - (u / s) ** 2));
  });
  return [en(-s, SOBRE_HOMBROS + h), en(s, SOBRE_HOMBROS + h), ...curva];
}
