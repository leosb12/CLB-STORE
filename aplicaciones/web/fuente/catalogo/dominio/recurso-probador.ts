export interface AnclasTextura {
  izquierda: number; derecha: number; arriba: number; abajo: number;
  cuello: [number, number]; pecho: number; calidad: number;
  estampados?: number[][];
}
interface RecursoBase {
  version: number; vista: "frontal"; mime: "image/png";
  sha256: string; ruta: string; bytes: number; ancho: number; alto: number;
  color: string;
}
/** Informe del estándar de calidad de la foto (servicio de IA). `con_avisos` se publicó aceptando sus avisos. */
export interface InformeCalidad {
  nivel: "apta" | "con_avisos" | "no_apta";
  puntuacion: number;
  comprobaciones: {codigo: string; nivel: "ok" | "aviso" | "bloqueo"; mensaje: string; valor: number | null; umbral: string}[];
}
/** Espalda deducida del modelo 3D: otra textura de 768 × 1024, descargada y verificada como la frontal. */
export interface EspaldaProbador { sha256: string; bytes: number; ruta: string }
export type RecursoProbador = RecursoBase & ({esquema: 1; tipo: 'superior'; anclas: AnclasTextura}
  | {esquema: 2; tipo: 'superior' | 'inferior' | 'completo'; modelo3d?: unknown; espalda?: EspaldaProbador; calidad?: InformeCalidad});
export interface TexturaGuardada { sha256: string; blob: Blob }

export function validarRecurso(valor: unknown): asserts valor is RecursoProbador {
  const r = valor as RecursoProbador | null;
  if (!r || ![1,2].includes(r.esquema) || !Number.isSafeInteger(r.version) || r.version < 1 || !['superior','inferior','completo'].includes(r.tipo)
    || r.vista !== "frontal" || r.mime !== "image/png" || !/^[a-f0-9]{64}$/.test(r.sha256)
    || r.ruta !== `/api/v1/recursos-probador/${r.sha256}.png` || typeof r.color !== "string" || !r.color.trim()
    || r.color.length > 80 || !Number.isSafeInteger(r.bytes) || r.bytes < 26 || r.bytes > 10*1024*1024
    || ![r.ancho,r.alto].every(v => Number.isSafeInteger(v) && v >= 128 && v <= 1024))
    throw new Error("El recurso fotográfico no cumple el contrato.");
  if (r.esquema === 2) {
    if (r.ancho !== 768 || r.alto !== 1024) throw new Error('El recurso generativo debe medir 768 × 1024.');
    const e = r.espalda;
    if (e !== undefined && (!e || !/^[a-f0-9]{64}$/.test(e.sha256) || e.ruta !== `/api/v1/recursos-probador/${e.sha256}.png`
      || !Number.isSafeInteger(e.bytes) || e.bytes < 26 || e.bytes > 10*1024*1024 || r.modelo3d === undefined))
      throw new Error('La espalda del modelo 3D no cumple el contrato.');
    if (r.calidad !== undefined && !['apta','con_avisos','no_apta'].includes(r.calidad?.nivel)) throw new Error('El informe de calidad no cumple el contrato.');
    return;
  }
  if (r.tipo !== 'superior') throw new Error('El recurso local debe ser superior.');
  const a = r.anclas;
  if (!a || !Array.isArray(a.cuello) || a.cuello.length !== 2
    || ![a.izquierda,a.derecha,a.arriba,a.abajo,a.pecho,a.calidad,...a.cuello].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
    || !(a.izquierda < a.cuello[0] && a.cuello[0] < a.derecha && a.arriba < a.pecho && a.pecho < a.abajo) || a.calidad < .8 || a.derecha-a.izquierda <= .05 || a.abajo-a.arriba <= .05)
    throw new Error("Las anclas fotográficas no son válidas.");
  if (a.estampados !== undefined && (!Array.isArray(a.estampados) || a.estampados.length > 16 || a.estampados.some(z => !Array.isArray(z) || z.length !== 4 || !z.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) || z[0] >= z[2] || z[1] >= z[3])))
    throw new Error('Las zonas de estampado no cumplen el contrato.');
}
