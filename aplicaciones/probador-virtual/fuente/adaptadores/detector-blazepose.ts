import "@tensorflow/tfjs-backend-webgl";
import * as tf from "@tensorflow/tfjs-core";
import * as pd from "@tensorflow-models/pose-detection";
import type { Mascara, Punto } from "../dominio/ra/cuerpo";

/**
 * Lado mayor del cuadro que entra a pose-detection. Sus modelos trabajan a 224/256 px: pasar el cuadro de 960 px solo
 * encarece la conversión a tensor. Medido en un Galaxy S23: 960 px → 6 img/s; 640 px o menos → ~10 img/s.
 */
const ANALISIS_MAXIMO = 640;

export interface Observacion {
  puntos: Punto[];
  mascara: Mascara;
}

/**
 * BlazePose 3D (TF.js, pesos locales en `modelos/blazepose-3d/`): 33 puntos con profundidad y máscara de la persona.
 * Nada sale del dispositivo. La profundidad se pasa a píxeles con la escala del torso en la imagen.
 */
export class DetectorBlazePose {
  private detector?: Promise<pd.PoseDetector>;
  private lienzo = document.createElement("canvas");
  private reducido = document.createElement("canvas");

  constructor(private readonly base: string, private readonly variante: "full" | "lite" = "full") {}

  preparar(): Promise<pd.PoseDetector> {
    this.detector ??= (async () => {
      if (!(await tf.setBackend("webgl").catch(() => false))) await tf.setBackend("cpu");
      await tf.ready();
      const d = await pd.createDetector(pd.SupportedModels.BlazePose, {
        runtime: "tfjs", modelType: this.variante, enableSmoothing: true, enableSegmentation: true, smoothSegmentation: true,
        detectorModelUrl: this.base + "detector/model.json", landmarkModelUrl: this.base + `landmark-${this.variante}/model.json`,
      });
      // Calentamiento: WebGL compila los shaders en la primera estimación (~10 s); no la paga el primer cuadro real.
      const vacio = document.createElement("canvas");
      vacio.width = vacio.height = 256;
      await d.estimatePoses(vacio).catch(() => []);
      return d;
    })();
    this.detector.catch(() => (this.detector = undefined));
    return this.detector;
  }

  async estimar(fuente: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, ancho: number, alto: number, marca?: number): Promise<Observacion | null> {
    const d = await this.preparar();
    // pose-detection mide la entrada con `width`/`height`; en un <video> son atributos que valen 0 si no se fijan.
    if (fuente instanceof HTMLVideoElement && (fuente.width !== fuente.videoWidth || fuente.height !== fuente.videoHeight)) {
      fuente.width = fuente.videoWidth;
      fuente.height = fuente.videoHeight;
    }
    // Se analiza una copia reducida; los puntos vuelven a las coordenadas del cuadro (`ancho` × `alto`).
    const f = Math.min(1, ANALISIS_MAXIMO / Math.max(ancho, alto));
    let entrada: typeof fuente = fuente;
    if (f < 1) {
      this.reducido.width = Math.round(ancho * f);
      this.reducido.height = Math.round(alto * f);
      this.reducido.getContext("2d")!.drawImage(fuente, 0, 0, this.reducido.width, this.reducido.height);
      entrada = this.reducido;
    }
    const [pose] = await d.estimatePoses(entrada, { flipHorizontal: false }, marca);
    if (pose && entrada !== fuente) {
      const sx = ancho / this.reducido.width, sy = alto / this.reducido.height;
      for (const p of pose.keypoints) { p.x *= sx; p.y *= sy; }
    }
    // La máscara es un tensor nuevo por cuadro que pose-detection no libera: sin esto la GPU crece cientos de MB por minuto.
    try { return pose?.keypoints3D && pose.segmentation ? await this.observar(pose, ancho, alto) : null; }
    finally { if (pose?.segmentation) tf.dispose((await pose.segmentation.mask.toTensor()) as tf.Tensor); }
  }

  private async observar(pose: pd.Pose, ancho: number, alto: number): Promise<Observacion> {
    if (!pose.keypoints3D || !pose.segmentation) throw new Error("Pose sin profundidad ni máscara");
    const k2 = pose.keypoints, k3 = pose.keypoints3D;
    // Escala metros → píxeles con el torso (estable al girar); sin caderas, con los hombros.
    const mid = (a: number, b: number, eje: "x" | "y") => (k2[a]![eje] + k2[b]![eje]) / 2;
    const mid3 = (a: number, b: number, eje: "x" | "y" | "z") => ((k3[a]![eje] ?? 0) + (k3[b]![eje] ?? 0)) / 2;
    const torso2 = Math.hypot(mid(11, 12, "x") - mid(23, 24, "x"), mid(11, 12, "y") - mid(23, 24, "y"));
    const torso3 = Math.hypot(mid3(11, 12, "x") - mid3(23, 24, "x"), mid3(11, 12, "y") - mid3(23, 24, "y"));
    const hombros2 = Math.hypot(k2[11]!.x - k2[12]!.x, k2[11]!.y - k2[12]!.y);
    const hombros3 = Math.hypot((k3[11]!.x - k3[12]!.x), (k3[11]!.y - k3[12]!.y), (k3[11]!.z ?? 0) - (k3[12]!.z ?? 0));
    const escala = torso3 > 0.05 ? torso2 / torso3 : hombros2 / Math.max(0.05, hombros3);
    const zRef = mid3(11, 12, "z");
    const puntos = k2.map((p, i) => ({ x: p.x, y: p.y, z: -((k3[i]!.z ?? 0) - zRef) * escala, c: p.score ?? 0 }));
    // La máscara se lleva a la resolución del cuadro para medir el cuerpo en píxeles de pantalla.
    this.lienzo.width = ancho;
    this.lienzo.height = alto;
    const ctx = this.lienzo.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, ancho, alto);
    ctx.drawImage((await pose.segmentation.mask.toCanvasImageSource()) as CanvasImageSource, 0, 0, ancho, alto);
    const rgba = ctx.getImageData(0, 0, ancho, alto).data;
    const datos = new Uint8Array(ancho * alto);
    // La máscara de BlazePose trae la probabilidad en los canales de color.
    for (let i = 0; i < datos.length; i++) datos[i] = Math.max(rgba[i * 4]!, rgba[i * 4 + 3]! < 255 ? rgba[i * 4 + 3]! : 0);
    return { puntos, mascara: { ancho, alto, datos } };
  }

  destruir(): void {
    void this.detector?.then((d) => d.dispose());
    this.detector = undefined;
  }
}
