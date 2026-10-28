/**
 * Malla de la prenda sobre el cuerpo medido. El torso es un cilindro elíptico: cada punto sabe si mira a la cámara,
 * así que al girarse se ven el costado y la espalda. Mangas y perneras son tubos a lo largo de los huesos.
 * UV en un atlas 2:1 — mitad izquierda frente, mitad derecha espalda (ya reflejada); v crece hacia abajo.
 */
import type { Cuerpo, Punto } from "./cuerpo";
import { torsoEn } from "./cuerpo";
import type { EjePrenda, ModeloPrenda3D } from "./modelo-prenda";

export const ANCHO_TEXTURA = 768;
export const ALTO_TEXTURA = 1024;
/** Profundidad del torso relativa a su ancho (sección elíptica). */
const PROFUNDIDAD = 0.62;
const SEGMENTOS = 16;

export interface PiezaMalla {
  /** Índice de la prenda del conjunto a la que pertenece (su atlas). */
  prenda: number;
  posiciones: number[];
  uv: number[];
  luz: number[];
  indices: number[];
}

export interface EscenaRA {
  piezas: PiezaMalla[];
  /** Línea superior del cuello en pantalla: por encima, la cabeza real se dibuja sobre la prenda. */
  cuello: { x: number; y: number }[];
  /** Manos reales delante de la prenda. */
  manos: { x: number; y: number; r: number }[];
}

type P2 = { x: number; y: number };

function nueva(prenda: number): PiezaMalla {
  return { prenda, posiciones: [], uv: [], luz: [], indices: [] };
}

/** Cuadrícula de `filas` × (SEGMENTOS + 1) vértices; `vertice` devuelve posición, uv y luz. */
function rejilla(pieza: PiezaMalla, filas: number, vertice: (fila: number, j: number) => { p: [number, number, number]; uv: [number, number]; luz: number }) {
  const base = pieza.posiciones.length / 3;
  for (let f = 0; f < filas; f++) {
    for (let j = 0; j <= SEGMENTOS; j++) {
      const v = vertice(f, j);
      pieza.posiciones.push(...v.p);
      pieza.uv.push(...v.uv);
      pieza.luz.push(v.luz);
    }
  }
  for (let f = 0; f < filas - 1; f++) {
    for (let j = 0; j < SEGMENTOS; j++) {
      const a = base + f * (SEGMENTOS + 1) + j, b = a + 1, c = a + SEGMENTOS + 1, d = c + 1;
      pieza.indices.push(a, c, b, b, c, d);
    }
  }
}

const luzDe = (z: number, radio: number) => 0.72 + 0.28 * Math.max(0, Math.min(1, z / Math.max(1, radio)));
const uvFrente = (x: number, y: number): [number, number] => [(x / ANCHO_TEXTURA) * 0.5, y / ALTO_TEXTURA];
const uvEspalda = (x: number, y: number): [number, number] => [0.5 + (x / ANCHO_TEXTURA) * 0.5, y / ALTO_TEXTURA];

/** Semieje frontal real a partir del semiancho proyectado medido (la sección elíptica girada). */
function semiejeReal(semiancho: number, giro: number): number {
  return semiancho / Math.sqrt(Math.cos(giro) ** 2 + PROFUNDIDAD ** 2 * Math.sin(giro) ** 2);
}

function anillo(c: Cuerpo, centro: P2, a: number, theta: number, z0 = 0) {
  const b = a * PROFUNDIDAD, cg = Math.cos(c.giro), sg = Math.sin(c.giro);
  const lx = a * Math.sin(theta), lz = b * Math.cos(theta);
  const x = lx * cg + lz * sg, z = -lx * sg + lz * cg;
  return { p: [centro.x + c.derecha.x * x, centro.y + c.derecha.y * x, z0 + z] as [number, number, number], luz: luzDe(z, Math.max(a, b)) };
}

/** Punto a una fracción `f` del largo de una polilínea, con su profundidad interpolada. */
function sobre(pts: Punto[], f: number): Punto {
  const largos = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k]!.x, p.y - pts[k]!.y));
  let resto = Math.max(0, f) * largos.reduce((s, l) => s + l, 0);
  for (let k = 0; k < largos.length; k++) {
    if (resto <= largos[k]! || k === largos.length - 1) {
      const w = Math.min(1, resto / (largos[k]! || 1)), a = pts[k]!, b = pts[k + 1]!;
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w, c: 1 };
    }
    resto -= largos[k]!;
  }
  return pts[pts.length - 1]!;
}

const largo = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - pts[k]!.x, p.y - pts[k]!.y), 0);

/**
 * Tubo de una manga o pernera. `estaciones` son las de la prenda (px de textura); `hueso` la extremidad del cuerpo
 * desde `desde` hasta `hasta` (fracciones de su largo). El radio nunca es menor que el del cuerpo medido.
 */
function tubo(pieza: PiezaMalla, c: Cuerpo, eje: EjePrenda, hueso: Punto[], radiosCuerpo: number[], desde: number, hasta: number, escala: number, z0: number, radioInicial = 0) {
  const est = eje.eje.map(([x, y, r]) => ({ x: x * ANCHO_TEXTURA, y: y * ALTO_TEXTURA, r: r * ANCHO_TEXTURA }));
  const centroTextura = ANCHO_TEXTURA / 2;
  const fracs = est.map((_, k) => k / (est.length - 1));
  const radioCuerpo = (f: number) => {
    const u = Math.max(0, Math.min(radiosCuerpo.length - 1.0001, f * (radiosCuerpo.length - 1)));
    const k = Math.floor(u);
    return radiosCuerpo[k]! + (radiosCuerpo[k + 1]! - radiosCuerpo[k]!) * (u - k);
  };
  const torso = torsoEn(c, 0.5).centro;
  const filas = est.map((s, k) => {
    const f = desde + (hasta - desde) * fracs[k]!;
    const p = sobre(hueso, f), q = sobre(hueso, Math.min(1, f + 0.02)), o = sobre(hueso, Math.max(0, f - 0.02));
    const l = Math.hypot(q.x - o.x, q.y - o.y) || 1;
    let n = { x: -(q.y - o.y) / l, y: (q.x - o.x) / l };
    if ((p.x - torso.x) * n.x + (p.y - torso.y) * n.y < 0) n = { x: -n.x, y: -n.y }; // hacia fuera del cuerpo
    const cuerpo = radioCuerpo(f);
    // `radioInicial`: la pernera arranca con el ancho de media pelvis y se funde hacia su propio ancho.
    const r = Math.max(cuerpo * 1.1, Math.min(s.r * escala, cuerpo * 1.6), radioInicial * Math.max(0, 1 - fracs[k]! * 3));
    // Normal de la prenda en la textura, también hacia fuera (lejos del centro de la prenda).
    const a = est[Math.max(0, k - 1)]!, b = est[Math.min(est.length - 1, k + 1)]!, lt = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nt = { x: -(b.y - a.y) / lt, y: (b.x - a.x) / lt };
    if ((s.x - centroTextura) * nt.x < 0) nt = { x: -nt.x, y: -nt.y };
    return { p, n, r, s, nt };
  });
  for (const cara of [0, 1]) {
    rejilla(pieza, filas.length, (k, j) => {
      const { p, n, r, s, nt } = filas[k]!;
      const phi = (cara === 0 ? -Math.PI / 2 : Math.PI / 2) + (Math.PI * j) / SEGMENTOS;
      const z = z0 + p.z + r * Math.cos(phi);
      const posicion: [number, number, number] = [p.x + n.x * r * Math.sin(phi), p.y + n.y * r * Math.sin(phi), z];
      const uv = cara === 0
        ? uvFrente(s.x + nt.x * s.r * Math.sin(phi), s.y + nt.y * s.r * Math.sin(phi))
        : uvEspalda(ANCHO_TEXTURA - s.x - nt.x * s.r * Math.sin(phi), s.y + nt.y * s.r * Math.sin(phi));
      return { p: posicion, uv, luz: luzDe(r * Math.cos(phi), r) };
    });
  }
}

function manos(c: Cuerpo, p: Punto[]): EscenaRA["manos"] {
  const salida: EscenaRA["manos"] = [];
  for (const [mu, indice, menique] of [[15, 19, 17], [16, 20, 18]] as const) {
    const w = p[mu], i = p[indice], m = p[menique];
    if (!w || w.c < 0.5) continue;
    const punta = i && i.c > 0.3 ? i : m && m.c > 0.3 ? m : null;
    // Desde la muñeca hacia los dedos: el puño de la ropa propia queda bajo la manga.
    const centro = punta ? { x: w.x + (punta.x - w.x) * 0.7, y: w.y + (punta.y - w.y) * 0.7 } : { x: w.x, y: w.y };
    const r = punta ? Math.max(c.anchoReal * 0.07, Math.hypot(punta.x - w.x, punta.y - w.y) * 0.75) : c.anchoReal * 0.1;
    salida.push({ ...centro, r });
  }
  return salida;
}

/** Semieje real de la cadera: torso medido o distancia 3D entre caderas (no se acorta al girar). */
function caderaDe(c: Cuerpo): number {
  if (!c.piernas) return semiejeReal(torsoEn(c, 1).semiancho, c.giro);
  const [ci, cd] = [c.piernas[0].puntos[0]!, c.piernas[1].puntos[0]!];
  return Math.max(semiejeReal(torsoEn(c, 1).semiancho, c.giro), Math.hypot(ci.x - cd.x, ci.y - cd.y, ci.z - cd.z));
}

/** Tope del pantalón sobre la cadera. */
const HOLGURA_PANTALON = 1.12;

/**
 * Escena con una o varias prendas (lo normal: una de arriba y una de abajo). Cada pieza lleva el índice de su prenda.
 * Con un pantalón en el conjunto, el torso de la prenda de arriba se ensancha desde la cintura para taparlo.
 */
export function construirEscena(modelos: ModeloPrenda3D[], c: Cuerpo, puntos: Punto[]): EscenaRA {
  const piezas: PiezaMalla[] = [];
  let cuello: P2[] = [];
  // Primero los pantalones: su contorno real en la cintura decide por dónde pasa la prenda de arriba.
  const pantalon: Perfil = [];
  modelos.forEach((modelo, indice) => pantalon.push(...agregarInferior(piezas, modelo, c, indice)));
  pantalon.sort((a, b) => a.t - b.t);
  modelos.forEach((modelo, indice) => agregarSuperior(piezas, modelo, c, indice, pantalon, (linea) => (cuello = linea)));
  return { piezas, cuello, manos: manos(c, puntos) };
}

/** Semieje del pantalón por altura del torso (t), para pasar por fuera de él. */
type Perfil = { t: number; a: number }[];

/** Semieje del pantalón en `t` (interpolado; 0 por encima de su cintura y el último valor por debajo). */
function semiejeEn(perfil: Perfil, t: number): number {
  if (!perfil.length || t < perfil[0]!.t) return 0;
  const k = perfil.findIndex((f) => f.t >= t);
  if (k < 0) return perfil[perfil.length - 1]!.a;
  if (k === 0) return perfil[0]!.a;
  const a = perfil[k - 1]!, b = perfil[k]!, w = (t - a.t) / (b.t - a.t || 1);
  return a.a + (b.a - a.a) * w;
}

function agregarSuperior(piezas: PiezaMalla[], modelo: ModeloPrenda3D, c: Cuerpo, indice: number, pantalon: Perfil, ponerCuello: (linea: P2[]) => void): void {
  const s = modelo.superior;
  if (s) {
    const cuello: P2[] = [];
    const torso = nueva(indice);
    const filas = s.torso.map(([y, xi, xd]) => ({ y: y * ALTO_TEXTURA, xi: xi * ANCHO_TEXTURA, xd: xd * ANCHO_TEXTURA }));
    const ancho = filas.slice(0, 4).reduce((t, f) => t + (f.xd - f.xi), 0) / 4;
    // El torso medido junto a brazos pegados sale angosto: la escala sale del ancho entre hombros (los deltoides
    // sobresalen ~0,6 de esa distancia a cada lado del centro), corregido por el giro.
    const hombroReal = Math.max(semiejeReal(torsoEn(c, 0.12).semiancho, c.giro), 0.6 * c.anchoReal);
    const escala = (2 * hombroReal) / ancho;
    const y0 = filas[0]!.y;
    // La fila del hombro de la prenda va sobre el contorno del hombro, por encima de la articulación.
    const sobreHombro = (0.26 * c.anchoReal) / c.largoTorso;
    // Largo de la prenda con sus proporciones; una prenda normal llega al menos a las caderas (tapa la ropa propia).
    let porT = escala / c.largoTorso;
    const dobladillo = (filas[filas.length - 1]!.y - y0) * porT - sobreHombro;
    // Una prenda superior termina entre la cadera y un poco más abajo: la foto plana no da el largo real puesto.
    // Un vestido (completo) conserva su largo.
    if (modelo.tipo === "superior") porT *= (Math.min(1.15, Math.max(1.02, dobladillo)) + sobreHombro) / (dobladillo + sobreHombro);
    const filaT = (y: number) => (y - y0) * porT - sobreHombro;
    // Las proporciones de la prenda mandan; nunca más angosta que el cuerpo medido.
    // En los hombros manda el ancho de la prenda; hacia la cintura la tela se acerca al cuerpo (una foto plana mide
    // media circunferencia, más que el ancho visto de frente). Nunca más angosta que el cuerpo medido.
    // Sobre un pantalón: apenas por fuera de su contorno en cada altura, así la prueba de profundidad la deja delante.
    const semieje = (t: number, f: { xi: number; xd: number }) => {
      const cuerpo = semiejeReal(torsoEn(c, t).semiancho, c.giro), prenda = ((f.xd - f.xi) / 2) * escala;
      const k = Math.max(0, Math.min(1, (t - 0.1) / 0.35));
      return Math.max(cuerpo * 1.05, prenda * (1 - 0.14 * k), semiejeEn(pantalon, t) * 1.03);
    };
    // Cuello: dos filas sobre los hombros que se estrechan hasta el cuello real; la abertura de la textura es transparente.
    const [cy0, cxi, cxd] = s.cuello;
    const alturaCuello = Math.max(8, (y0 - cy0 * ALTO_TEXTURA) * escala);
    const semiCuello = Math.max(hombroReal * 0.34, ((cxd - cxi) * ANCHO_TEXTURA * 0.5 + 18) * escala);
    const centroHombros = torsoEn(c, -sobreHombro).centro;
    const anilloCuello = [
      { y: cy0 * ALTO_TEXTURA, xi: (cxi * ANCHO_TEXTURA + filas[0]!.xi) / 2 - 20, xd: (cxd * ANCHO_TEXTURA + filas[0]!.xd) / 2 + 20, centro: { x: centroHombros.x - c.abajo.x * alturaCuello, y: centroHombros.y - c.abajo.y * alturaCuello }, a: semiCuello },
    ];
    for (const cara of [0, 1]) {
      const todas = [
        ...(cara === 0 ? anilloCuello : []), // atrás no hay abertura: el cuello trasero queda tapado por la cabeza
        ...filas.map((f) => { const t = filaT(f.y); return { ...f, centro: torsoEn(c, t).centro, a: semieje(t, f) }; }),
      ];
      rejilla(torso, todas.length, (k, j) => {
        const f = todas[k]!;
        const theta = (cara === 0 ? -Math.PI / 2 : Math.PI / 2) + (Math.PI * j) / SEGMENTOS;
        const v = anillo(c, f.centro, f.a, theta);
        const centroT = (f.xi + f.xd) / 2, mitad = (f.xd - f.xi) / 2;
        const uv = cara === 0 ? uvFrente(centroT + mitad * Math.sin(theta), f.y) : uvEspalda(ANCHO_TEXTURA - centroT - mitad * Math.sin(theta), f.y);
        return { p: v.p, uv, luz: v.luz };
      });
    }
    piezas.push(torso);
    for (let j = 0; j <= 8; j++) {
      const v = anillo(c, anilloCuello[0]!.centro, semiCuello, -Math.PI / 2 + (Math.PI * j) / 8);
      cuello.push({ x: v.p[0], y: v.p[1] });
    }
    ponerCuello(cuello);
    const mangas = nueva(indice);
    for (const manga of s.mangas) {
      // La manga de la izquierda de la foto frontal es la derecha de quien la viste.
      const original = c.brazos[manga.lado < 0 ? 1 : 0];
      const raiz = original.puntos[0]!;
      const brazo = { ...original, puntos: [{ ...raiz, x: raiz.x - c.abajo.x * c.anchoReal * 0.2, y: raiz.y - c.abajo.y * c.anchoReal * 0.2 }, ...original.puntos.slice(1)] };
      const largoPrenda = largo(manga.eje.map(([x, y]) => ({ x: x * ANCHO_TEXTURA, y: y * ALTO_TEXTURA })));
      const largoBrazo = largo(brazo.puntos);
      const hasta = manga.larga ? 1 : Math.min(0.95, (largoPrenda * escala) / largoBrazo);
      // La profundidad estimada del brazo es ruidosa: un sesgo hacia la cámara evita que una manga pegada al cuerpo
      // quede escondida tras el torso. Solo un brazo claramente detrás de la espalda queda oculto.
      tubo(mangas, c, manga, brazo.puntos, brazo.radios, 0, Math.max(0.2, hasta), escala, hombroReal * PROFUNDIDAD * 0.6);
    }
    piezas.push(mangas);
  }
}

function agregarInferior(piezas: PiezaMalla[], modelo: ModeloPrenda3D, c: Cuerpo, indice: number): Perfil {
  const i = modelo.inferior;
  const perfil: Perfil = [];
  if (i && c.piernas && c.caderas) {
    const pelvis = nueva(indice);
    const filas = i.cadera.map(([y, xi, xd]) => ({ y: y * ALTO_TEXTURA, xi: xi * ANCHO_TEXTURA, xd: xd * ANCHO_TEXTURA }));
    const anchoCadera = Math.max(...filas.map((f) => f.xd - f.xi));
    // La mano junto a la cadera recorta la medida: piso con la distancia entre caderas (articulaciones) del esqueleto.
    const caderaReal = caderaDe(c);
    const escala = (2 * caderaReal * 1.04) / anchoCadera;
    const yc = i.cintura * ALTO_TEXTURA, ye = i.entrepierna * ALTO_TEXTURA;
    const filaT = (y: number) => 0.82 + (0.28 * (y - yc)) / Math.max(1, ye - yc);
    for (const cara of [0, 1]) {
      rejilla(pelvis, filas.length, (k, j) => {
        const f = filas[k]!, t = filaT(f.y);
        const cuerpo = semiejeReal(torsoEn(c, t).semiancho, c.giro);
        const a = Math.max(cuerpo * 1.04, Math.min(((f.xd - f.xi) / 2) * escala, caderaReal * HOLGURA_PANTALON));
        if (cara === 0 && j === 0) perfil.push({ t, a });
        const theta = (cara === 0 ? -Math.PI / 2 : Math.PI / 2) + (Math.PI * j) / SEGMENTOS;
        const v = anillo(c, torsoEn(c, t).centro, a, theta);
        const centroT = (f.xi + f.xd) / 2, mitad = (f.xd - f.xi) / 2;
        const uv = cara === 0 ? uvFrente(centroT + mitad * Math.sin(theta), f.y) : uvEspalda(ANCHO_TEXTURA - centroT - mitad * Math.sin(theta), f.y);
        return { p: v.p, uv, luz: v.luz };
      });
    }
    piezas.push(pelvis);
    const perneras = nueva(indice);
    for (const pierna of i.piernas) {
      const segmento = c.piernas[pierna.lado < 0 ? 1 : 0];
      const pts = segmento.puntos;
      const largoPierna = largo(pts);
      // Empieza a la altura de la entrepierna del cuerpo; un jean llega al tobillo, un short se queda en su proporción.
      // Empieza donde termina la pelvis (su última fila es la entrepierna de la textura): sin escalón de textura.
      const fin = torsoEn(c, 1.08).centro;
      const desde = Math.max(0, Math.min(0.4, ((fin.x - pts[0]!.x) * c.abajo.x + (fin.y - pts[0]!.y) * c.abajo.y) / largoPierna));
      const semiPelvis = semiejeReal(torsoEn(c, 1.1).semiancho, c.giro);
      const largoPrenda = largo(pierna.eje.map(([x, y]) => ({ x: x * ANCHO_TEXTURA, y: y * ALTO_TEXTURA })));
      // Largo por las proporciones del propio pantalón: pernera / ancho de cadera > 1,8 es largo (llega al tobillo).
      const proporcion = largoPrenda / anchoCadera;
      const hasta = proporcion > 1.15 ? 1 : Math.min(1, desde + (1 - desde) * (proporcion / 1.6));
      tubo(perneras, c, pierna, pts, segmento.radios, desde, hasta, escala, 0, semiPelvis * 0.55);
    }
    piezas.push(perneras);
  }
  return perfil;
}
