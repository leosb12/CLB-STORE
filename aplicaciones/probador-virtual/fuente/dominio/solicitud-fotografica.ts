import type { PrendaProbador } from "./contrato";

/** Debe coincidir con `VERSION_MOTOR` del servidor y de Android: forma parte de la clave de idempotencia. */
export const VERSION_MOTOR = "catvton-7818397-residente-v12-24-2.5-768x1024";
export const MAXIMO_PENDIENTES = 4;
export const MAXIMO_RESULTADOS = 20;
/** Fallos del servidor seguidos antes de pedir un reintento manual; los cortes de red nunca agotan la solicitud. */
export const MAXIMO_FALLOS_SERVIDOR = 5;

/**
 * PENDIENTE: guardada en el dispositivo, espera red o su próximo intento. ENVIANDO: subida o generándose en el servidor.
 * LISTO: resultado guardado. ERROR: requiere decisión del usuario (foto no apta o reintentos agotados).
 */
export type EstadoSolicitud = "PENDIENTE" | "ENVIANDO" | "LISTO" | "ERROR";

export interface SolicitudFotografica {
  clave: string;
  titular: string;
  version: string;
  prenda: PrendaProbador;
  /** Originales: solo mientras la solicitud no tiene resultado. */
  persona?: Blob;
  ropa?: Blob;
  resultado?: Blob;
  estado: EstadoSolicitud;
  mensaje: string;
  /** Avance informado por el servidor mientras está ENVIANDO. */
  remoto?: "PENDIENTE" | "PROCESANDO";
  intentos: number;
  fallosServidor: number;
  proximo: number;
  creado: number;
  actualizado: number;
  /**
   * Conjunto (arriba + abajo): CatVTON viste una prenda por pasada. La primera solicitud guarda la segunda prenda y,
   * al quedar lista, se encola otra con su resultado como foto de la persona.
   */
  siguiente?: { prenda: PrendaProbador; ropa: Blob };
  /** Clave de la solicitud que continuó este conjunto. */
  continuacion?: string;
  /** Prenda que ya traía la foto (paso anterior del conjunto). */
  base?: PrendaProbador;
}

/** Misma especificación que `clave_resultado` del servidor: cambiar foto, prenda, categoría, cuenta o motor da otra clave. */
export function especificacionClave(titular: string, fotoHash: string, prenda: PrendaProbador, ropaHash: string): string {
  return JSON.stringify([VERSION_MOTOR, titular, fotoHash, prenda.identificador, ropaHash, prenda.categoría]);
}

/** Espera exponencial con jitter completo (AWS Architecture Blog, 2015): reparte los reintentos de varios clientes. */
export function esperaReintento(intento: number, azar: () => number = Math.random): number {
  const tope = Math.min(60_000, 5_000 * 2 ** Math.max(0, Math.min(intento, 8) - 1));
  return Math.max(1_000, Math.round(azar() * tope));
}

/** Una solicitud nacida con otro motor conserva su foto pero necesita otra clave. */
export function obsoleta(s: SolicitudFotografica): boolean {
  return s.version !== VERSION_MOTOR && s.estado !== "LISTO";
}
