import { calcularAjuste, tipoDePrenda, type Ajuste, type Pose } from "../dominio/pose";
import { inferirTalla, validarMedidas, type Medidas, type ModeloTallas, type RecomendacionTalla } from "../dominio/tallas";
import { VERSION_CONTRATO, type PrendaProbador, type ResultadoProbador } from "../dominio/contrato";
import type { Mascara, Punto } from "../dominio/ra/cuerpo";
import type { EscenaRA } from "../dominio/ra/malla-ra";

/** Fuente de imagen que entiende el detector (foto, cuadro de video o lienzo). */
export type FuenteImagen = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap;

/** Puerto de segmentación local por fotografía; no recibe destino de red. */
export interface SegmentadorTejido {
  segmentar(foto:HTMLCanvasElement):Promise<Float32Array>;
  cerrar():void;
}

/** Puerto de composición continua, sin destinos de red ni estado comercial. */
export interface CompositorVideo {
  componer(fuente:HTMLCanvasElement,analisis:HTMLCanvasElement,probabilidades:Float32Array,pose:Pose):Promise<HTMLCanvasElement>;
  cerrar():void;
}
export class FotogramaNoApto extends Error {}

export interface DetectorPose {
  /** Nombre y versión del modelo, para el registro. */
  readonly modelo: string;
  /** Carga el modelo una sola vez; devuelve el backend usado (webgl o cpu). */
  preparar(): Promise<string>;
  detectar(imagen: FuenteImagen, ancho: number, alto: number): Promise<Pose>;
}

export interface ModeloObtenido {
  modelo: ModeloTallas;
  origen: "red" | "guardado";
  descargado: string;
}

export interface FuenteModeloTallas {
  /** Intenta la red y, si falla, la copia guardada; null si nunca se descargó. */
  obtener(): Promise<ModeloObtenido | null>;
}

export interface RegistroPruebas {
  guardar(resultado: ResultadoProbador): void;
}

export class MedidasInvalidas extends Error {}

const normalizar = (talla: string) => talla.trim().toLocaleUpperCase("es");

/**
 * Caso de uso del probador: detectar la pose y ajustar la prenda (DL), recomendar la talla (ML) y dejar constancia de qué
 * modelos se usaron en cada prueba, sin la imagen ni las medidas.
 */
export class ProbarPrenda {
  private inferencia?: Promise<Pose>;
  constructor(
    private readonly detector: DetectorPose,
    private readonly registro: RegistroPruebas,
    private readonly ahora: () => Date = () => new Date(),
  ) {}

  async ajustar(imagen: FuenteImagen, ancho: number, alto: number, prenda: PrendaProbador, ilustración: { ancho: number; alto: number }): Promise<{ pose: Pose; ajuste: Ajuste }> {
    const anterior = this.inferencia?.catch(() => undefined) ?? Promise.resolve();
    const actual = anterior.then(() => this.detector.detectar(imagen,ancho,alto));
    this.inferencia = actual;
    let pose: Pose;
    try { pose = await actual; }
    finally { if (this.inferencia === actual) this.inferencia = undefined; }
    return { pose, ajuste: calcularAjuste(pose, tipoDePrenda(prenda.categoría), ilustración.ancho, ilustración.alto, prenda.recurso?.anclas) };
  }

  /** Registra una prueba de la prenda (foto analizada o primera pose ajustada de la cámara). */
  registrarPrueba(prenda: PrendaProbador, ajuste: Ajuste, modeloTallas: ModeloObtenido | null): ResultadoProbador {
    return this.guardar(prenda, null, ajuste, modeloTallas);
  }

  recomendarTalla(modeloTallas: ModeloObtenido, medidas: Medidas, prenda: PrendaProbador, ajuste: Ajuste | null): { recomendación: RecomendacionTalla; resultado: ResultadoProbador } {
    const error = validarMedidas(medidas);
    if (error) throw new MedidasInvalidas(error);
    const recomendación = inferirTalla(modeloTallas.modelo, medidas);
    return { recomendación, resultado: this.guardar(prenda, recomendación, ajuste, modeloTallas) };
  }

  private guardar(prenda: PrendaProbador, r: RecomendacionTalla | null, ajuste: Ajuste | null, obtenido: ModeloObtenido | null): ResultadoProbador {
    const resultado: ResultadoProbador = {
      contrato: VERSION_CONTRATO,
      prenda: { identificador: prenda.identificador, sku: prenda.sku },
      talla: r?.talla ?? null,
      probabilidades: r?.probabilidades ?? {},
      tallaDisponible: r && (prenda.tallas.length || prenda.recurso) ? prenda.tallas.some((t) => normalizar(t) === normalizar(r.talla)) : null,
      pose: { detectada: !!ajuste?.ajustado, puntuación: Math.round((ajuste?.puntuación ?? 0) * 1000) / 1000 },
      modelos: {
        pose: this.detector.modelo,
        tallas: obtenido && { versión: obtenido.modelo.version, exactitud: obtenido.modelo.metricas.exactitud, origen: obtenido.origen, descargado: obtenido.descargado },
      },
      fecha: this.ahora().toISOString(),
    };
    this.registro.guardar(resultado);
    return resultado;
  }
}

/** Realidad aumentada: seguimiento corporal 3D con máscara (TF.js local) y composición de la prenda sobre el video. */
export interface SeguidorCuerpo {
  preparar(): Promise<unknown>;
  /** Libera el modelo (GPU); opcional. */
  destruir?(): void;
  estimar(fuente: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, ancho: number, alto: number, marca?: number): Promise<{ puntos: Punto[]; mascara: Mascara } | null>;
}
export interface PintorRA {
  /** Prendas del conjunto, en el mismo orden que los modelos de la escena. */
  ponerPrendas(lista: { frente: CanvasImageSource; espalda: CanvasImageSource }[]): void;
  dibujar(fuente: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, ancho: number, alto: number, mascara?: Mascara | null, escena?: EscenaRA | null): void;
  destruir(): void;
}
