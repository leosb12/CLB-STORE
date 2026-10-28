/**
 * Modelo 3D de una prenda generado por el servidor al preparar su fotografía (worker de prendas, OpenCV).
 * Coordenadas normalizadas a la textura frontal de 768×1024; la espalda es otra imagen del mismo tamaño, ya reflejada
 * como se vería desde atrás. Llega por red: se valida como dato no confiable antes de construir geometría.
 */
export type Estacion = [x: number, y: number, radio: number];

export interface EjePrenda {
  lado: -1 | 1;
  eje: Estacion[];
}

export interface ModeloPrenda3D {
  version: 1;
  tipo: "superior" | "inferior" | "completo";
  espalda: "deducida" | "fotografiada";
  color: [number, number, number];
  superior?: {
    axila: number;
    /** [y superior, x izquierda, x derecha, y inferior] de la abertura del cuello. */
    cuello: [number, number, number, number];
    /** Filas del torso de los hombros al dobladillo: [y, x izquierda, x derecha]. */
    torso: [number, number, number][];
    mangas: (EjePrenda & { larga: boolean })[];
  };
  inferior?: {
    cintura: number;
    entrepierna: number;
    cadera: [number, number, number][];
    piernas: EjePrenda[];
  };
}

const numero = (v: unknown, max = 1) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const lista = (v: unknown, n: number, max = 1) => Array.isArray(v) && v.length === n && v.every((x) => numero(x, max));
const eje = (e: unknown) => {
  const d = e as EjePrenda;
  return !!d && (d.lado === -1 || d.lado === 1) && Array.isArray(d.eje) && d.eje.length === 8 && d.eje.every((s) => lista(s, 3));
};

export function validarModelo3D(datos: unknown): ModeloPrenda3D | null {
  const m = datos as ModeloPrenda3D;
  if (!m || m.version !== 1 || !lista(m.color, 3, 255) || (m.espalda !== "deducida" && m.espalda !== "fotografiada")) return null;
  if (m.tipo === "superior" || m.tipo === "completo") {
    const s = m.superior;
    if (!s || !numero(s.axila) || !lista(s.cuello, 4) || !Array.isArray(s.torso) || s.torso.length < 4 || s.torso.length > 32
      || !s.torso.every((f) => lista(f, 3)) || !Array.isArray(s.mangas) || s.mangas.length > 2
      || !s.mangas.every((g) => eje(g) && typeof g.larga === "boolean")) return null;
    return m;
  }
  if (m.tipo === "inferior") {
    const i = m.inferior;
    if (!i || !numero(i.cintura) || !numero(i.entrepierna) || !Array.isArray(i.cadera) || i.cadera.length < 2 || i.cadera.length > 8
      || !i.cadera.every((f) => lista(f, 3)) || !Array.isArray(i.piernas) || i.piernas.length !== 2 || !i.piernas.every(eje)) return null;
    return m;
  }
  return null;
}
