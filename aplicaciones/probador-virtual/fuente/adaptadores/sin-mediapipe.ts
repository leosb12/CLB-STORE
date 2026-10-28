// `@tensorflow-models/pose-detection` importa el runtime MediaPipe aunque solo se use el de TF.js. Este reemplazo vacío
// evita descargar su WASM desde Internet: el probador funciona sin red con los pesos locales de TensorFlow.
export class Pose {
  constructor() { throw new Error("Runtime MediaPipe deshabilitado: usar runtime tfjs."); }
}
export const POSE_CONNECTIONS: never[] = [];
