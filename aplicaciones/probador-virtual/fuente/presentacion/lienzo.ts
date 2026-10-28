import { CONFIANZA_MINIMA, PUNTOS, regionCuello, type NombrePunto, type Pose, type TipoPrenda, type Transformacion } from "../dominio/pose";
import { analizarTextura, articularPrenda, type AnclasRegiones, type GeometriaPrenda, type MallaTextura } from "../dominio/prenda-articulada";

const geometrias = new WeakMap<HTMLImageElement, GeometriaPrenda>();
/** Capas cacheadas por lienzo, una por prenda del conjunto. */
const capas = new WeakMap<HTMLCanvasElement, { pose: Pose | null; t: Transformacion; imagen: HTMLImageElement; capa: HTMLCanvasElement; codos?: number }[]>();

/**
 * Estima anclas anatómicas normalizadas (cuello, sisa y basta) a partir del canal alfa.
 * Permite articular prendas fotográficas y del catálogo que no incluyan anclas vectoriales previas.
 */
export function estimarAnclasDesdeAlfa(alfa: Uint8Array, ancho: number, alto: number): AnclasRegiones | null {
  let minY = alto, maxY = 0, minX = ancho, maxX = 0;
  let cuenta = 0;
  for (let y = 0; y < alto; y++) {
    const offset = y * ancho;
    for (let x = 0; x < ancho; x++) {
      if (alfa[offset + x]! >= 128) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        cuenta++;
      }
    }
  }
  if (cuenta < 200 || maxY <= minY || maxX <= minX) return null;

  // Analizar el perfil de ancho en el tercio medio para ubicar el contorno del torso
  let mejorTorsoLeft = minX, mejorTorsoRight = maxX, minAncho = maxX - minX;
  for (let pct = 0.35; pct <= 0.65; pct += 0.05) {
    const y = Math.round(minY + (maxY - minY) * pct);
    const rowOffset = y * ancho;
    let l = ancho, r = 0;
    for (let x = 0; x < ancho; x++) {
      if (alfa[rowOffset + x]! >= 128) {
        if (x < l) l = x;
        if (x > r) r = x;
      }
    }
    const w = r - l;
    if (w > ancho * 0.15 && w < minAncho) {
      minAncho = w;
      mejorTorsoLeft = l;
      mejorTorsoRight = r;
    }
  }

  // Si los brazos cuelgan verticalmente (manga larga), estimar el torso central
  if (minAncho > (maxX - minX) * 0.72) {
    const centroX = (minX + maxX) / 2;
    const semiTorso = (maxX - minX) * 0.28;
    mejorTorsoLeft = Math.max(0, centroX - semiTorso);
    mejorTorsoRight = Math.min(ancho - 1, centroX + semiTorso);
  }

  return {
    izquierda: Math.max(0.05, Math.min(0.42, mejorTorsoLeft / (ancho - 1))),
    derecha: Math.max(0.58, Math.min(0.95, mejorTorsoRight / (ancho - 1))),
    arriba: Math.max(0.01, Math.min(0.25, (minY + (maxY - minY) * 0.05) / (alto - 1))),
    abajo: Math.max(0.70, Math.min(0.99, (maxY - (maxY - minY) * 0.03) / (alto - 1))),
  };
}

/** Leer alfa y contornos una sola vez al cambiar la fotografía de producto. */
export function prepararArticulacion(imagen: HTMLImageElement, anclas?: AnclasRegiones): void {
  const c = document.createElement("canvas");
  c.width = imagen.naturalWidth;
  c.height = imagen.naturalHeight;
  if (!c.width || !c.height) return;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(imagen, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const alfa = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alfa.length; i++) alfa[i] = rgba[i * 4 + 3]!;
  const anclasEfectivas = anclas ?? estimarAnclasDesdeAlfa(alfa, c.width, c.height);
  if (!anclasEfectivas) return;
  const g = analizarTextura(alfa, c.width, c.height, anclasEfectivas);
  if (g) geometrias.set(imagen, g);
}

/** Canvas2D: transformación afín local por triángulo, equivalente a drawVertices. */
function pintarMalla(ctx: CanvasRenderingContext2D, imagen: HTMLImageElement, m: MallaTextura): void {
  for (let i = 0; i < m.indices.length; i += 3) {
    const ids = m.indices.slice(i, i + 3);
    const s = ids.map((n) => ({ x: m.uv[n * 2]!, y: m.uv[n * 2 + 1]! }));
    const d = ids.map((n) => ({ x: m.vertices[n * 2]!, y: m.vertices[n * 2 + 1]! }));
    const [p, q, r] = s as [typeof s[0], typeof s[0], typeof s[0]];
    const [a, b, c] = d as [typeof d[0], typeof d[0], typeof d[0]];
    const det = (q!.x - p!.x) * (r!.y - p!.y) - (r!.x - p!.x) * (q!.y - p!.y);
    if (Math.abs(det) < 1e-6) continue;
    const xx = ((b!.x - a!.x) * (r!.y - p!.y) - (c!.x - a!.x) * (q!.y - p!.y)) / det;
    const xy = ((c!.x - a!.x) * (q!.x - p!.x) - (b!.x - a!.x) * (r!.x - p!.x)) / det;
    const yx = ((b!.y - a!.y) * (r!.y - p!.y) - (c!.y - a!.y) * (q!.y - p!.y)) / det;
    const yy = ((c!.y - a!.y) * (q!.x - p!.x) - (b!.y - a!.y) * (r!.x - p!.x)) / det;
    const centro = { x: (a!.x + b!.x + c!.x) / 3, y: (a!.y + b!.y + c!.y) / 3 };
    // Solape subpíxel para que el antialiasing del clip no abra costuras claras.
    const borde = d.map((p) => {
      const n = Math.hypot(p.x - centro.x, p.y - centro.y) || 1;
      return { x: p.x + ((p.x - centro.x) / n) * 0.35, y: p.y + ((p.y - centro.y) / n) * 0.35 };
    });
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(borde[0]!.x, borde[0]!.y);
    ctx.lineTo(borde[1]!.x, borde[1]!.y);
    ctx.lineTo(borde[2]!.x, borde[2]!.y);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(xx, yx, xy, yy, a!.x - xx * p!.x - xy * p!.y, a!.y - yx * p!.x - yy * p!.y);
    ctx.drawImage(imagen, 0, 0);
    ctx.restore();
  }
}

const HUESOS: [NombrePunto, NombrePunto][] = [
  ["hombro_izquierdo", "hombro_derecho"],
  ["hombro_izquierdo", "codo_izquierdo"],
  ["codo_izquierdo", "muñeca_izquierda"],
  ["hombro_derecho", "codo_derecho"],
  ["codo_derecho", "muñeca_derecha"],
  ["hombro_izquierdo", "cadera_izquierda"],
  ["hombro_derecho", "cadera_derecha"],
  ["cadera_izquierda", "cadera_derecha"],
  ["cadera_izquierda", "rodilla_izquierda"],
  ["rodilla_izquierda", "tobillo_izquierdo"],
  ["cadera_derecha", "rodilla_derecha"],
  ["rodilla_derecha", "tobillo_derecho"],
];

/** Lado mayor con el que se analiza y dibuja: suficiente para MoveNet (192 px) sin gastar memoria en fotos de 12 MP. */
export const LADO_MAXIMO = 960;

export function medidaAjustada(ancho: number, alto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

export function cargarImagen(url: string): Promise<HTMLImageElement> {
  const imagen = new Image();
  imagen.decoding = "async";
  imagen.src = url;
  return imagen.decode().then(() => imagen);
}

/** Una prenda del conjunto: la de abajo se dibuja primero y la de arriba tapa su cintura. */
export interface Capa {
  prenda: HTMLImageElement;
  transformación: Transformacion | null;
  tipo: TipoPrenda;
}

export interface Escena {
  fuente: CanvasImageSource;
  ancho: number;
  alto: number;
  capas: Capa[];
  pose: Pose | null;
  verPuntos: boolean;
  opacidad?: number;
}

const ORDEN: Record<TipoPrenda, number> = { pantalon: 0, vestido: 1, superior: 2 };

/** Capa de una prenda en un lienzo propio, rehecha solo si cambian la pose, la transformación o el tamaño. */
function capaPrenda(lienzo: HTMLCanvasElement, indice: number, c: Capa, pose: Pose | null, ancho: number, alto: number): { capa: HTMLCanvasElement; codos?: number } | null {
  const t = c.transformación;
  if (!t) return null;
  const lista = capas.get(lienzo) ?? [];
  capas.set(lienzo, lista);
  let cache = lista[indice];
  if (cache && cache.pose === pose && cache.t === t && cache.imagen === c.prenda && cache.capa.width === ancho && cache.capa.height === alto) return cache;
  const capa = cache?.capa ?? document.createElement("canvas");
  capa.width = ancho;
  capa.height = alto;
  const pincel = capa.getContext("2d")!;
  pincel.imageSmoothingEnabled = true;
  pincel.clearRect(0, 0, ancho, alto);
  const g = geometrias.get(c.prenda);
  // La malla articulada es de torso y mangas (anclada a los hombros): un pantalón va con el ajuste afín de cadera a tobillos.
  const m = g && pose && c.tipo !== "pantalon" ? articularPrenda(g, pose, t) : null;
  if (m) for (const region of m.regiones) pintarMalla(pincel, c.prenda, region);
  else {
    pincel.save();
    pincel.translate(t.x, t.y);
    pincel.rotate(t.ángulo);
    pincel.scale(t.escalaX, t.escalaY);
    pincel.drawImage(c.prenda, -t.origenX, -t.origenY, c.prenda.naturalWidth, c.prenda.naturalHeight);
    pincel.restore();
  }
  cache = { pose, t, imagen: c.prenda, capa, codos: m?.codosArticulados };
  lista[indice] = cache;
  return cache;
}

let lienzoCuello: HTMLCanvasElement | null = null;

/** Vuelve a poner el cuello y la cabeza de la imagen original encima de la prenda, con borde suave. */
function pintarCuello(ctx: CanvasRenderingContext2D, fuente: CanvasImageSource, ancho: number, alto: number, region: { x: number; y: number }[]): void {
  const c = (lienzoCuello ??= document.createElement("canvas"));
  if (c.width !== ancho) c.width = ancho;
  if (c.height !== alto) c.height = alto;
  const p = c.getContext("2d")!;
  p.clearRect(0, 0, ancho, alto);
  p.filter = `blur(${Math.max(1.5, ancho / 400)}px)`;
  p.beginPath();
  region.forEach((q, k) => (k ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  p.fill();
  p.filter = "none";
  p.globalCompositeOperation = "source-in";
  p.drawImage(fuente, 0, 0, ancho, alto);
  p.globalCompositeOperation = "source-over";
  ctx.drawImage(c, 0, 0);
}

export function dibujar(lienzo: HTMLCanvasElement, escena: Escena): void {
  lienzo.dataset.opacidad = String(escena.opacidad ?? 1);
  const { fuente, ancho, alto, pose } = escena;
  if (lienzo.width !== ancho) lienzo.width = ancho;
  if (lienzo.height !== alto) lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(fuente, 0, 0, ancho, alto);

  const ordenadas = [...escena.capas].sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo]);
  let articuladas = 0, dibujadas = 0, codos: number | undefined;
  ctx.save();
  ctx.globalAlpha = escena.opacidad ?? 1;
  ordenadas.forEach((c, k) => {
    const r = capaPrenda(lienzo, k, c, pose, ancho, alto);
    if (!r) return;
    ctx.drawImage(r.capa, 0, 0);
    dibujadas++;
    if (r.codos !== undefined) { articuladas++; if (c.tipo !== "pantalon") codos = r.codos; }
  });
  ctx.restore();
  const cuello = pose && ordenadas.some((c) => c.tipo !== "pantalon" && c.transformación) ? regionCuello(pose) : null;
  if (cuello) pintarCuello(ctx, fuente, ancho, alto, cuello);

  lienzo.dataset.render = articuladas ? "articulado" : dibujadas ? "afin" : "sin-prenda";
  lienzo.dataset.capas = String(dibujadas);
  lienzo.dataset.cuello = cuello ? "original" : "no";
  lienzo.dataset.sombreado = "referencia-srgb";
  lienzo.dataset.codosVisibles = String(pose ? [7, 8].filter((i) => (pose[i]?.confianza ?? 0) >= CONFIANZA_MINIMA).length : 0);
  if (codos === undefined) delete lienzo.dataset.codos;
  else lienzo.dataset.codos = String(codos);

  // 3. Esqueleto de articulaciones (si el usuario activó la vista de puntos)
  if (escena.verPuntos && pose) {
    const grosor = Math.max(2, ancho / 320);
    const visible = (n: NombrePunto) => {
      const p = pose[PUNTOS.indexOf(n)];
      return p && p.confianza >= CONFIANZA_MINIMA ? p : null;
    };
    ctx.lineWidth = grosor;
    ctx.strokeStyle = "rgba(248, 247, 243, 0.9)";
    for (const [a, b] of HUESOS) {
      const [p, q] = [visible(a), visible(b)];
      if (!p || !q) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.fillStyle = "#aa703b";
    for (const p of pose) {
      if (p.confianza < CONFIANZA_MINIMA) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, grosor * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
