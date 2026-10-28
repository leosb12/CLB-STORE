import * as tf from '@tensorflow/tfjs-core';
import {RedSemantica} from './red-semantica';
import type {SegmentadorTejido} from '../aplicacion/casos-de-uso';

const HUELLAS={
 'operadores.json':'59e89a552032283a532862f04fe90994f0dabea0f91caa018d8cfe5435498637',
 'pesos.bin':'c9305cc5ce4515c7c0fb9827da55acbdde4aa11fe7eed31a122bc03007ccf4fc',
};
async function verificar(bytes:ArrayBuffer,esperado:string):Promise<void>{
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==esperado)throw new Error('El modelo de camiseta no pasó la comprobación de integridad.');
}

/** Modelo local fijo. Nunca envía la fotografía; libera constantes al salir. */
export class SegmentadorCamiseta implements SegmentadorTejido {
 private carga?:Promise<RedSemantica>;
 private generacion=0;
 private ocupado=false;
 constructor(private readonly base:string){}
 private cargar():Promise<RedSemantica>{
  const generacion=this.generacion;
  this.carga??=(async()=>{
   const valores=await Promise.all(Object.entries(HUELLAS).map(async([nombre,hash])=>{
    const r=await fetch(new URL(nombre,this.base));if(!r.ok)throw new Error('Descarga el probador con conexión antes de usar el modo camiseta.');
    const bytes=await r.arrayBuffer();await verificar(bytes,hash);return bytes;
   }));
   if(generacion!==this.generacion)throw new Error('La vista se cerró.');
   return new RedSemantica(tf,JSON.parse(new TextDecoder().decode(valores[0])),new Uint8Array(valores[1]));
  })();
  const carga=this.carga;void carga.catch(()=>{if(this.carga===carga)this.carga=undefined;});return carga;
 }
 async segmentar(foto:HTMLCanvasElement):Promise<Float32Array>{
  if(this.ocupado)throw new Error('Espera a que termine el análisis de la camiseta.');
  this.ocupado=true;let entrada:tf.Tensor|undefined;
  try{
   const red=await this.cargar();
   entrada=tf.tidy(()=>tf.expandDims(tf.div(tf.sub(tf.image.resizeBilinear(tf.browser.fromPixels(foto),[256,256]),127.5),127.5),0));
   const logits=await red.ejecutar(entrada),salida=new Float32Array(logits.length);
   for(let i=0;i<logits.length;i+=6){let max=-Infinity,suma=0;for(let k=0;k<6;k++)max=Math.max(max,logits[i+k]);for(let k=0;k<6;k++){salida[i+k]=Math.exp(logits[i+k]-max);suma+=salida[i+k];}for(let k=0;k<6;k++)salida[i+k]/=suma;}
   return salida;
  }finally{entrada?.dispose();this.ocupado=false;}
 }
 cerrar():void{
  this.generacion++;const carga=this.carga;this.carga=undefined;
  // Si está leyendo la GPU, liberar después de terminar la tarea, no durante invoke.
  const liberar=async()=>{const red=await carga?.catch(()=>undefined);if(!red)return;if(this.ocupado){setTimeout(()=>void liberar(),50);return;}red.cerrar();};void liberar();
 }
}
