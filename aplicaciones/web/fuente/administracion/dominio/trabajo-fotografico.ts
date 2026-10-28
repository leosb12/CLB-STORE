import type { InformeCalidad, RecursoProbador } from "../../catalogo/dominio/recurso-probador";

export interface TrabajoFotografico {
  identificador: string;
  estado: "PENDIENTE" | "PROCESANDO" | "LISTO" | "REQUIERE_REVISION" | "ERROR" | "PUBLICADO";
  color: string;
  mensaje: string;
  recurso?: RecursoProbador;
  /** Estándar de calidad: en LISTO trae los avisos que hay que aceptar; en REQUIERE_REVISION, los motivos del rechazo. */
  calidad?: InformeCalidad | null;
}
