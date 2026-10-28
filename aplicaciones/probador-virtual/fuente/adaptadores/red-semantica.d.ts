import type * as tf from '@tensorflow/tfjs-core';
/** Solo descriptor/pesos de la versión fija verificada por el adaptador. */
export class RedSemantica {
 constructor(tensorflow:typeof tf,descriptor:unknown,pesos:Uint8Array);
 ejecutar(entrada:tf.Tensor):Promise<Float32Array>;
 cerrar():void;
}
