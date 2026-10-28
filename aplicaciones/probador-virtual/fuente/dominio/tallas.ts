/**
 * Talla orientativa con el modelo supervisado de la fase 8 (regresión logística multinomial exportada a JSON por el
 * servicio de IA). La inferencia es la misma fórmula que declara el modelo, sin librerías, para que funcione sin conexión.
 */
export const CARACTERISTICAS = ["altura_cm", "peso_kg", "pecho_cm", "cintura_cm"] as const;
export type Caracteristica = (typeof CARACTERISTICAS)[number];
export type Medidas = Record<Caracteristica, number>;

/** Los mismos límites que validan el perfil de Clientes y el servicio de IA. */
export const LIMITES: Record<Caracteristica, readonly [number, number]> = {
  altura_cm: [100, 230],
  peso_kg: [30, 250],
  pecho_cm: [50, 200],
  cintura_cm: [40, 200],
};

/**
 * Tabla de tallas de referencia (la misma de `inteligencia-artificial/fuente/dominio/tallas.py`). Solo se muestra cuando el
 * modelo nunca llegó al dispositivo: el cliente puede guiarse con una cinta métrica sin que se invente una talla.
 */
export const TABLA_REFERENCIA: Record<string, Record<Caracteristica, [number, number]>> = {
  XS: { altura_cm: [150, 162], peso_kg: [42, 55], pecho_cm: [78, 86], cintura_cm: [62, 70] },
  S: { altura_cm: [158, 170], peso_kg: [52, 64], pecho_cm: [86, 94], cintura_cm: [70, 78] },
  M: { altura_cm: [165, 177], peso_kg: [62, 75], pecho_cm: [94, 102], cintura_cm: [78, 86] },
  L: { altura_cm: [170, 182], peso_kg: [72, 88], pecho_cm: [102, 110], cintura_cm: [86, 96] },
  XL: { altura_cm: [175, 190], peso_kg: [85, 105], pecho_cm: [110, 120], cintura_cm: [96, 108] },
};

/** Por debajo de esta probabilidad la talla se presenta como «entre dos tallas». */
export const PROBABILIDAD_SEGURA = 0.6;

export interface ModeloTallas {
  version: number;
  tipo: "regresion_logistica_multinomial";
  caracteristicas: Caracteristica[];
  clases: string[];
  media: number[];
  escala: number[];
  coeficientes: number[][];
  intercepto: number[];
  metricas: { exactitud: number };
  tabla: Record<string, Record<Caracteristica, [number, number]>>;
  aviso: string;
}

export interface RecomendacionTalla {
  talla: string;
  probabilidades: Record<string, number>;
  /** Segunda talla más probable cuando la primera no supera PROBABILIDAD_SEGURA. */
  alternativa: string | null;
  tallaPorTabla: string;
}

export class ModeloTallasInvalido extends Error {}

const esNúmero = (valor: unknown): valor is number => typeof valor === "number" && Number.isFinite(valor);
const vector = (valor: unknown, largo: number) => Array.isArray(valor) && valor.length === largo && valor.every(esNúmero);
// Un coeficiente de este tamaño desborda exp() y vuelve arbitraria la recomendación.
const acotado = (valor: number) => Math.abs(valor) < 1000;
const rango = (valor: unknown) => vector(valor, 2) && (valor as number[])[0] <= (valor as number[])[1];

/** El modelo llega por red o desde el almacenamiento local: se valida su forma completa antes de usarlo. */
export function validarModelo(datos: unknown): ModeloTallas {
  const m = datos as Partial<ModeloTallas> | null;
  const n = CARACTERISTICAS.length;
  const clases = m?.clases;
  const válido =
    !!m &&
    m.tipo === "regresion_logistica_multinomial" &&
    esNúmero(m.version) &&
    Array.isArray(m.caracteristicas) &&
    m.caracteristicas.join() === CARACTERISTICAS.join() &&
    Array.isArray(clases) &&
    clases.length >= 2 &&
    clases.every((c) => typeof c === "string" && c.length > 0 && c.length <= 8) &&
    new Set(clases).size === clases.length &&
    vector(m.media, n) &&
    vector(m.escala, n) &&
    (m.escala as number[]).every((s) => s > 0) &&
    vector(m.intercepto, clases.length) &&
    Array.isArray(m.coeficientes) &&
    m.coeficientes.length === clases.length &&
    m.coeficientes.every((fila) => vector(fila, n) && fila.every(acotado)) &&
    (m.intercepto as number[]).every(acotado) &&
    esNúmero(m.metricas?.exactitud) &&
    m.metricas.exactitud >= 0 &&
    m.metricas.exactitud <= 1 &&
    typeof m.aviso === "string" &&
    !!m.tabla &&
    clases.every((c) => CARACTERISTICAS.every((k) => rango(m.tabla?.[c]?.[k])));
  if (!válido) throw new ModeloTallasInvalido("El modelo de tallas no tiene la forma esperada.");
  return m as ModeloTallas;
}

/** Devuelve el mensaje del primer campo fuera de rango, o null si las medidas son válidas. */
export function validarMedidas(medidas: Partial<Record<Caracteristica, number>>): string | null {
  for (const nombre of CARACTERISTICAS) {
    const valor = medidas[nombre];
    const [mínimo, máximo] = LIMITES[nombre];
    if (!esNúmero(valor) || valor < mínimo || valor > máximo) return `${nombre} debe estar entre ${mínimo} y ${máximo}.`;
  }
  return null;
}

/** softmax(coeficientes · ((x − media) / escala) + intercepto), con la resta del máximo para estabilidad numérica. */
export function inferirTalla(modelo: ModeloTallas, medidas: Medidas): RecomendacionTalla {
  const z = CARACTERISTICAS.map((c, i) => (medidas[c] - modelo.media[i]) / modelo.escala[i]);
  const puntajes = modelo.coeficientes.map((fila, k) => fila.reduce((suma, w, i) => suma + w * z[i], modelo.intercepto[k]));
  const máximo = Math.max(...puntajes);
  const exponentes = puntajes.map((p) => Math.exp(p - máximo));
  const total = exponentes.reduce((a, b) => a + b, 0);
  const probabilidades = Object.fromEntries(modelo.clases.map((c, k) => [c, exponentes[k] / total]));
  const orden = [...modelo.clases].sort((a, b) => probabilidades[b] - probabilidades[a]);
  return {
    talla: orden[0],
    probabilidades,
    alternativa: probabilidades[orden[0]] < PROBABILIDAD_SEGURA ? orden[1] : null,
    tallaPorTabla: tallaPorTabla(modelo, medidas),
  };
}

/** Talla cuyo centro de pecho está más cerca: la referencia que el cliente comprueba con una cinta (igual que en IA). */
export function tallaPorTabla(modelo: Pick<ModeloTallas, "clases" | "tabla">, medidas: Pick<Medidas, "pecho_cm">): string {
  let mejor = modelo.clases[0];
  let distancia = Infinity;
  for (const talla of modelo.clases) {
    const [mínimo, máximo] = modelo.tabla[talla].pecho_cm;
    const d = Math.abs((mínimo + máximo) / 2 - medidas.pecho_cm);
    if (d < distancia) [mejor, distancia] = [talla, d];
  }
  return mejor;
}
