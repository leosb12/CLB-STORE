// Cargar SOLO en Vite de laboratorio; no se incorpora al renderer público.
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import {RedSemantica} from './red-semantica.mjs';

const leer=async n=>{
 const r=await fetch('./'+n);if(!r.ok)throw new Error('Recurso no disponible: '+n);
 return new Uint8Array(await r.arrayBuffer());
};
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
window.prueba=(async()=>{
 await tf.setBackend('webgl');await tf.ready();
 const [descriptor,pesos,datos,ref,huellas]=await Promise.all(['operadores.json','pesos.bin','entrada.f32','salida-litert.f32','huellas-exportacion.json'].map(leer));
 const huella=JSON.parse(new TextDecoder().decode(huellas));
 for(const [n,b] of [['operadores.json',descriptor],['pesos.bin',pesos]])if(await hash(b)!==huella[n])throw new Error('Integridad: '+n);
 const red=new RedSemantica(tf,JSON.parse(new TextDecoder().decode(descriptor)),pesos);
 const entrada=tf.tensor(new Float32Array(datos.buffer),[1,256,256,3]);
 const esperado=new Float32Array(ref.buffer),mediciones=[];
 const memoriaInicial=tf.memory().numTensors;
 let informe;
 try{
  for(let repeticion=0;repeticion<3;repeticion++){
   const inicio=performance.now(),salida=await red.ejecutar(entrada);
   let max=0,suma=0,iguales=0;
   for(let i=0;i<salida.length;i++){const e=Math.abs(salida[i]-esperado[i]);max=Math.max(max,e);suma+=e;}
   for(let i=0;i<salida.length;i+=6){let a=0,b=0;for(let j=1;j<6;j++){if(salida[i+j]>salida[i+a])a=j;if(esperado[i+j]>esperado[i+b])b=j;}if(a===b)iguales++;}
   mediciones.push({segundos:(performance.now()-inicio)/1000,error_maximo:max,error_medio:suma/salida.length,acuerdo_clases:iguales/65536,tensores:tf.memory().numTensors});
  }
  informe={backend:tf.getBackend(),memoriaInicial,mediciones,webgl_float32:tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED'),agente:navigator.userAgent};
 }finally{entrada.dispose();red.cerrar();}
 informe.tensoresAlCerrar=tf.memory().numTensors;
 document.querySelector('#estado').textContent=JSON.stringify(informe,null,2);
 return informe;
})();
