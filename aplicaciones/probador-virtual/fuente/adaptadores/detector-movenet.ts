import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel, type GraphModel } from "@tensorflow/tfjs-converter";
import { PUNTOS, type Pose } from "../dominio/pose";
import type { DetectorPose, FuenteImagen } from "../aplicacion/casos-de-uso";

const LADO_ENTRADA = 192;

/**
 * MoveNet SinglePose Lightning v4 con TensorFlow.js, servido junto al probador (sin Internet). La imagen se procesa en la
 * GPU del navegador (WebGL) o en la CPU si WebGL no está disponible; nunca sale del dispositivo.
 */
export class DetectorMoveNet implements DetectorPose {
  readonly modelo = "MoveNet SinglePose Lightning v4 (TensorFlow.js, local)";
  // ponytail: el modelo y el contexto WebGL quedan en memoria toda la sesión para reabrir el probador al instante;
  // liberarlos con modelo.dispose() si la memoria del celular lo exige.
  private carga?: Promise<GraphModel>;

  constructor(private readonly urlModelo: string) {}

  static diagnosticoMemoria() {
    const m = tf.memory();
    return {tensores:m.numTensors,bytes:m.numBytes,inexacta:m.unreliable,backend:tf.getBackend()};
  }

  async preparar(): Promise<string> {
    await this.cargar();
    return tf.getBackend();
  }

  private cargar(): Promise<GraphModel> {
    this.carga ??= (async () => {
      tf.enableProdMode();
      if (!(await tf.setBackend("webgl").catch(() => false))) await tf.setBackend("cpu");
      await tf.ready();
      const modelo = await loadGraphModel(this.urlModelo);
      // Calentamiento: WebGL compila sus shaders en la primera ejecución (6–9 s medidos); así no la paga la foto del usuario.
      const vacia = tf.zeros([1, LADO_ENTRADA, LADO_ENTRADA, 3], "int32");
      const salida = modelo.execute(vacia) as tf.Tensor;
      await salida.data();
      tf.dispose([vacia, salida]);
      return modelo;
    })();
    // Si la carga falla (p. ej. sin red la primera vez), el siguiente intento vuelve a probar.
    this.carga.catch(() => (this.carga = undefined));
    return this.carga;
  }

  async detectar(imagen: FuenteImagen, ancho: number, alto: number): Promise<Pose> {
    const modelo = await this.cargar();
    // Se rellena a un cuadrado (abajo y a la derecha) para no deformar a la persona; así las coordenadas normalizadas
    // vuelven a píxeles multiplicando por el lado.
    const lado = Math.max(ancho, alto);
    const entrada = tf.tidy(() => {
      const píxeles = tf.browser.fromPixels(imagen);
      const cuadrado = tf.pad(píxeles, [[0, lado - alto], [0, lado - ancho], [0, 0]]);
      return tf.expandDims(tf.cast(tf.image.resizeBilinear(cuadrado, [LADO_ENTRADA, LADO_ENTRADA]), "int32"), 0);
    });
    let salida: tf.Tensor | undefined;
    try {
      salida = modelo.execute(entrada) as tf.Tensor; // [1, 1, 17, 3]: y, x, confianza
      const datos = await salida.data();
      return PUNTOS.map((_, i) => ({ y: datos[i * 3] * lado, x: datos[i * 3 + 1] * lado, confianza: datos[i * 3 + 2] }));
    } finally {
      tf.dispose(salida ? [entrada, salida] : entrada);
    }
  }
}
