/**
 * Medidas del cuerpo real en la imagen: BlazePose 3D (33 puntos con profundidad) + máscara de la persona.
 * La prenda se ajusta a estas medidas, no a una plantilla: por eso tapa la ropa propia y sigue piernas y brazos.
 * Coordenadas de pantalla en píxeles; z en píxeles, positiva hacia la cámara.
 */
export interface Punto {
  x: number;
  y: number;
  z: number;
  c: number;
}

export interface Mascara {
  ancho: number;
  alto: number;
  /** Probabilidad de persona 0..255 por píxel. */
  datos: Uint8Array;
}

export interface Segmento {
  puntos: Punto[];
  radios: number[];
}

export interface Cuerpo {
  /** Giro alrededor del eje vertical: 0 de frente, ±π de espaldas, positivo cuando el hombro izquierdo se aleja. */
  giro: number;
  /** Ancho de hombros proyectado en la imagen (se acorta al girar). */
  anchoHombros: number;
  /** Ancho de hombros real (3D, en px): no cambia al girar; es la escala de todas las medidas. */
  anchoReal: number;
  /** Dirección del torso hacia abajo y su perpendicular hacia la derecha de la imagen (vectores unitarios). */
  abajo: { x: number; y: number };
  derecha: { x: number; y: number };
  /** Centro de los hombros y largo del torso (hombros → caderas) en píxeles. */
  hombros: Punto;
  largoTorso: number;
  /** Semiancho proyectado y centro del torso medidos en la máscara, muestreados de t = -0.2 a 1.4 del largo. */
  torso: { t: number; centro: { x: number; y: number }; semiancho: number }[];
  /** Hombro → codo → muñeca, izquierdo y derecho de la persona. */
  brazos: [Segmento, Segmento];
  /** Cadera → rodilla → tobillo. */
  piernas: [Segmento, Segmento] | null;
  caderas: Punto | null;
}

export const CONFIANZA = 0.5;
/** De costado el hombro lejano queda tapado; BlazePose igual predice su posición, que se acepta con esta confianza. */
export const CONFIANZA_OCULTO = 0.15;
const visible = (p: Punto | undefined, minimo = CONFIANZA): p is Punto => !!p && p.c >= minimo && Number.isFinite(p.x) && Number.isFinite(p.y);
/** Un par (hombros o caderas) sirve si un lado se ve bien y el otro, aunque tapado, fue predicho. */
const par = (a: Punto | undefined, b: Punto | undefined): boolean =>
  visible(a, CONFIANZA_OCULTO) && visible(b, CONFIANZA_OCULTO) && Math.max(a.c, b.c) >= CONFIANZA;
const medio = (a: Punto, b: Punto): Punto => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, c: Math.min(a.c, b.c) });
const distancia = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function enMascara(m: Mascara, x: number, y: number): boolean {
  const xi = Math.round(x), yi = Math.round(y);
  return xi >= 0 && yi >= 0 && xi < m.ancho && yi < m.alto && m.datos[yi * m.ancho + xi]! > 127;
}

function distanciaSegmento(p: { x: number; y: number }, a: Punto, b: Punto): number {
  const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Avanza desde `o` en la dirección `d` mientras haya persona y `seguir` lo permita; devuelve la distancia recorrida. */
function recorrer(m: Mascara, o: { x: number; y: number }, d: { x: number; y: number }, maximo: number, seguir: (p: { x: number; y: number }) => boolean = () => true): number {
  let r = 0;
  for (; r < maximo; r += 1) {
    const p = { x: o.x + d.x * r, y: o.y + d.y * r };
    if (!enMascara(m, p.x, p.y) || !seguir(p)) break;
  }
  return r;
}

/** Radio de una extremidad: corte perpendicular de la máscara a lo largo del hueso, sin invadir lo que `ajeno` marque. */
function radios(m: Mascara, pts: Punto[], tope: number, ajeno: (p: { x: number; y: number }) => boolean): number[] {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)]!, b = pts[Math.min(pts.length - 1, k + 1)]!;
    const l = distancia(a, b) || 1;
    const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    // Muestra un poco hacia dentro del hueso: en las articulaciones el corte puede salir del brazo.
    const o = k === 0 ? { x: p.x + (b.x - p.x) * 0.25, y: p.y + (b.y - p.y) * 0.25 } : k === pts.length - 1 ? { x: p.x + (a.x - p.x) * 0.15, y: p.y + (a.y - p.y) * 0.15 } : p;
    const izq = recorrer(m, o, n, tope, (q) => !ajeno(q)), der = recorrer(m, o, { x: -n.x, y: -n.y }, tope, (q) => !ajeno(q));
    const r = (izq + der) / 2;
    return Math.max(tope * 0.25, Math.min(tope, r || tope * 0.5));
  });
}

/**
 * `referencia`: la mayor proporción ancho de hombros / largo del torso vista en la sesión (de frente). Con ella el giro
 * sale de cuánto se acortan los hombros, más estable que la profundidad z sola. Es una proporción porque no cambia al
 * acercarse o alejarse de la cámara. Sin referencia (o sin caderas) se usa solo la z.
 */
export function medirCuerpo(p: Punto[], m: Mascara, referencia = 0): Cuerpo | null {
  if (p.length !== 33) return null;
  const hi = p[11], hd = p[12];
  if (!par(hi, hd)) return null;
  const anchoHombros = distancia(hi!, hd!);
  // Escala que no cambia al girar: de perfil el ancho proyectado tiende a 0, el real no.
  const anchoReal = Math.max(anchoHombros, Math.hypot(hi!.x - hd!.x, hi!.y - hd!.y, hi!.z - hd!.z));
  if (anchoReal < 20) return null;
  const hombros = medio(hi!, hd!);
  const ci = p[23], cd = p[24];
  const caderas = par(ci, cd) ? medio(ci!, cd!) : null;
  // Giro con la profundidad de los hombros (y de las caderas si se ven). De espaldas el orden en la imagen se invierte.
  const giroDe = (izq: Punto, der: Punto) => Math.atan2(-(izq.z - der.z), izq.x - der.x);
  let giro = giroDe(hi!, hd!);
  if (caderas) {
    const g2 = giroDe(ci!, cd!);
    giro = Math.atan2(Math.sin(giro) + Math.sin(g2), Math.cos(giro) + Math.cos(g2));
  }
  const proporcion = caderas ? anchoHombros / Math.max(1, distancia(hombros, caderas)) : 0;
  if (proporcion && referencia > proporcion) {
    // |cos giro| = proporción actual / la de frente; el signo (hacia qué lado y si está de espaldas) lo da la profundidad.
    const cos = Math.sign(Math.cos(giro) || 1) * (proporcion / referencia);
    const porAncho = Math.atan2(Math.sign(Math.sin(giro)) * Math.sqrt(1 - cos * cos), cos);
    giro = Math.atan2(Math.sin(giro) + Math.sin(porAncho), Math.cos(giro) + Math.cos(porAncho));
  }
  const fin = caderas ?? { x: hombros.x, y: hombros.y + anchoReal * 1.35, z: hombros.z, c: 0 };
  const largoTorso = Math.max(anchoReal * 0.8, distancia(hombros, fin));
  const abajo = { x: (fin.x - hombros.x) / distancia(hombros, fin), y: (fin.y - hombros.y) / distancia(hombros, fin) };
  const derecha = { x: abajo.y, y: -abajo.x };
  // `derecha` apunta a la derecha de la imagen; si el torso se inclina mucho, se corrige el signo con la x.
  if (derecha.x < 0) { derecha.x = -derecha.x; derecha.y = -derecha.y; }

  const brazo = (h: number, c: number, mu: number): Punto[] => {
    const pts = [p[h]!, p[c]!, p[mu]!];
    // Sin codo o muñeca visibles, el brazo cae al costado.
    if (!visible(pts[1])) pts[1] = { x: pts[0]!.x + derecha.x * anchoReal * 0.05 * (h === 11 ? 1 : -1) + abajo.x * anchoReal * 0.65, y: pts[0]!.y + abajo.y * anchoReal * 0.65, z: pts[0]!.z, c: 0 };
    if (!visible(pts[2])) pts[2] = { x: pts[1]!.x + abajo.x * anchoReal * 0.6, y: pts[1]!.y + abajo.y * anchoReal * 0.6, z: pts[1]!.z, c: 0 };
    return pts;
  };
  const bi = brazo(11, 13, 15), bd = brazo(12, 14, 16);
  const tope = anchoReal * 0.2;
  const ri = radios(m, bi, tope, () => false), rd = radios(m, bd, tope, () => false);
  // Solo tapan el torso los brazos con el hombro a la vista: de costado, el del hombro oculto está detrás del cuerpo.
  const delante = ([[bi, ri], [bd, rd]] as [Punto[], number[]][]).filter(([pts]) => pts[0]!.c >= CONFIANZA);
  const enBrazo = (q: { x: number; y: number }) =>
    delante.some(([pts, r]) => pts.slice(0, 2).some((a, k) => distanciaSegmento(q, a, pts[k + 1]!) < r[k]! * 1.05));

  const torso: Cuerpo["torso"] = [];
  for (let k = 0; k <= 32; k++) {
    const t = -0.2 + (1.6 * k) / 32;
    const eje = { x: hombros.x + abajo.x * largoTorso * t, y: hombros.y + abajo.y * largoTorso * t };
    // Cada lado se detiene en el borde del cuerpo o en un brazo. Centro en la línea del esqueleto; semiancho del lado
    // que llegó al borde (una mano en la cadera tapa solo un lado); si ambos chocan con brazos, el mayor.
    let brazoIzq = false, brazoDer = false;
    const izq = recorrer(m, eje, { x: -derecha.x, y: -derecha.y }, anchoReal, (q) => (enBrazo(q) && distancia(q, eje) > anchoReal * 0.12 ? ((brazoIzq = true), false) : true));
    const der = recorrer(m, eje, derecha, anchoReal, (q) => (enBrazo(q) && distancia(q, eje) > anchoReal * 0.12 ? ((brazoDer = true), false) : true));
    // De costado la línea del esqueleto no pasa por el centro de la silueta (pecho y espalda no son simétricos
    // respecto de los hombros): sin brazos de por medio, el centro es el del tramo medido.
    const perfil = Math.abs(Math.sin(giro)) > 0.5 && !brazoIzq && !brazoDer;
    const semiancho = brazoIzq === brazoDer ? (brazoIzq ? Math.max(izq, der) : (izq + der) / 2) : brazoIzq ? der : izq;
    const centro = perfil ? { x: eje.x + (derecha.x * (der - izq)) / 2, y: eje.y + (derecha.y * (der - izq)) / 2 } : eje;
    torso.push({ t, centro, semiancho });
  }
  // Filas sin medida fiable (fuera de la máscara o cortadas por un brazo): se interpolan de las vecinas.
  // El semiancho proyectado va de la media profundidad (de perfil) al medio ancho (de frente).
  const minimo = anchoReal * 0.15, maximo = anchoReal * 0.85;
  for (const f of torso) if (f.semiancho < minimo || f.semiancho > maximo) f.semiancho = NaN;
  // Perfil suave a lo alto: un pliegue o un objeto pegado no deben dejar escalones en la prenda.
  const crudo = torso.map((f) => f.semiancho);
  for (let k = 1; k < torso.length - 1; k++) {
    const v = [crudo[k - 1]!, crudo[k]!, crudo[k + 1]!].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (v.length === 3) torso[k]!.semiancho = v[1]!;
  }
  for (let k = 0; k < torso.length; k++) {
    if (!Number.isNaN(torso[k]!.semiancho)) continue;
    const a = torso.slice(0, k).reverse().find((f) => !Number.isNaN(f.semiancho)), b = torso.slice(k + 1).find((f) => !Number.isNaN(f.semiancho));
    torso[k]!.semiancho = a && b ? (a.semiancho + b.semiancho) / 2 : (a ?? b)?.semiancho ?? anchoReal * 0.5;
    if (!a && !b) torso[k]!.centro = { x: hombros.x + abajo.x * largoTorso * torso[k]!.t, y: hombros.y + abajo.y * largoTorso * torso[k]!.t };
  }

  let piernas: Cuerpo["piernas"] = null;
  if (caderas) {
    const pierna = (c: number, r: number, t: number): Punto[] => {
      const pts = [p[c]!, p[r]!, p[t]!];
      if (!visible(pts[1])) pts[1] = { x: pts[0]!.x + abajo.x * largoTorso * 0.9, y: pts[0]!.y + abajo.y * largoTorso * 0.9, z: pts[0]!.z, c: 0 };
      if (!visible(pts[2])) pts[2] = { x: pts[1]!.x + abajo.x * largoTorso * 0.85, y: pts[1]!.y + abajo.y * largoTorso * 0.85, z: pts[1]!.z, c: 0 };
      return pts;
    };
    const pi = pierna(23, 25, 27), pd = pierna(24, 26, 28);
    // Cada pernera solo mide hasta la mitad hacia la otra pierna.
    const masCerca = (q: { x: number; y: number }, propia: Punto[], otra: Punto[]) =>
      Math.min(distanciaSegmento(q, otra[0]!, otra[1]!), distanciaSegmento(q, otra[1]!, otra[2]!)) < Math.min(distanciaSegmento(q, propia[0]!, propia[1]!), distanciaSegmento(q, propia[1]!, propia[2]!));
    const topeP = anchoReal * 0.32;
    piernas = [
      { puntos: pi, radios: radios(m, pi, topeP, (q) => masCerca(q, pi, pd)) },
      { puntos: pd, radios: radios(m, pd, topeP, (q) => masCerca(q, pd, pi)) },
    ];
  }
  return { giro, anchoHombros, anchoReal, abajo, derecha, hombros, largoTorso, torso, brazos: [{ puntos: bi, radios: ri }, { puntos: bd, radios: rd }], piernas, caderas };
}

/** Medida del torso en una t arbitraria (interpolación lineal entre muestras). */
export function torsoEn(c: Cuerpo, t: number): { centro: { x: number; y: number }; semiancho: number } {
  const f = c.torso;
  const u = Math.max(0, Math.min(f.length - 1.0001, ((t - f[0]!.t) / (f[f.length - 1]!.t - f[0]!.t)) * (f.length - 1)));
  const k = Math.floor(u), w = u - k, a = f[k]!, b = f[k + 1]!;
  return { centro: { x: a.centro.x + (b.centro.x - a.centro.x) * w, y: a.centro.y + (b.centro.y - a.centro.y) * w }, semiancho: a.semiancho + (b.semiancho - a.semiancho) * w };
}
