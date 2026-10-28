import { validarModelo } from "../dominio/tallas";
import type { ResultadoProbador } from "../dominio/contrato";
import type { FuenteModeloTallas, ModeloObtenido, RegistroPruebas } from "../aplicacion/casos-de-uso";

const CLAVE_MODELO = "clb_probador_modelo_tallas";
const CLAVE_REGISTRO = "clb_probador_registro";
const MAXIMO_REGISTRO = 20;

/** localStorage puede no existir o lanzar (modo privado, cuota): el probador sigue funcionando sin copia local. */
function leer(clave: string): unknown {
  try {
    const texto = localStorage.getItem(clave);
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}
function escribir(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento: se pierde solo la copia local */
  }
}

/**
 * Modelo de tallas de la fase 8 (GET público, sin datos personales). Con red se descarga y se guarda; sin red se usa la
 * última copia guardada. Ambas se validan antes de usarse.
 */
export class ModeloTallasRest implements FuenteModeloTallas {
  constructor(
    private readonly url: string,
    private readonly espera = 4000,
  ) {}

  async obtener(): Promise<ModeloObtenido | null> {
    try {
      const respuesta = await fetch(this.url, { cache: "no-store", signal: AbortSignal.timeout(this.espera) });
      if (!respuesta.ok) throw new Error(String(respuesta.status));
      const obtenido: ModeloObtenido = { modelo: validarModelo(await respuesta.json()), origen: "red", descargado: new Date().toISOString() };
      escribir(CLAVE_MODELO, { modelo: obtenido.modelo, descargado: obtenido.descargado });
      return obtenido;
    } catch {
      return this.guardado();
    }
  }

  private guardado(): ModeloObtenido | null {
    const copia = leer(CLAVE_MODELO) as { modelo?: unknown; descargado?: unknown } | null;
    try {
      const válida = copia && typeof copia.descargado === "string" && !Number.isNaN(Date.parse(copia.descargado));
      return válida ? { modelo: validarModelo(copia.modelo), origen: "guardado", descargado: copia.descargado as string } : null;
    } catch {
      return null;
    }
  }
}

/** Lo que queda de cada prueba en el dispositivo: qué modelos se usaron y cuándo. */
export type EntradaRegistro = Pick<ResultadoProbador, "contrato" | "prenda" | "pose" | "modelos" | "fecha"> & { tallaCalculada: boolean };

/**
 * Últimas pruebas en este dispositivo. Ni la imagen ni las medidas, y tampoco la talla ni sus probabilidades: en un equipo
 * compartido revelarían la complexión de quien lo usó.
 */
export class RegistroLocal implements RegistroPruebas {
  guardar(r: ResultadoProbador): void {
    const anteriores = leer(CLAVE_REGISTRO);
    const entrada: EntradaRegistro = { contrato: r.contrato, prenda: r.prenda, pose: r.pose, modelos: r.modelos, fecha: r.fecha, tallaCalculada: r.talla !== null };
    escribir(CLAVE_REGISTRO, [entrada, ...(Array.isArray(anteriores) ? anteriores : [])].slice(0, MAXIMO_REGISTRO));
  }

  listar(): EntradaRegistro[] {
    const registro = leer(CLAVE_REGISTRO);
    return Array.isArray(registro) ? registro : [];
  }
}
