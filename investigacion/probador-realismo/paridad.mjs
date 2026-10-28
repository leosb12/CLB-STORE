// Laboratorio: misma red, inferencia REAL con operadores TensorFlow.js CPU.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../aplicaciones/probador-virtual/package.json',import.meta.url));
const tf=require('@tensorflow/tfjs-core');require('@tensorflow/tfjs-backend-cpu');
await tf.setBackend('cpu');await tf.ready();
const laboratorio=new URL('../../temporales/laboratorio-realismo/',import.meta.url);
const leer=n=>readFileSync(new URL(n,laboratorio));
const d=JSON.parse(leer('operadores.json')),pesos=leer('pesos.bin');
const constantes=new Map(),filtros=new Map();
for(const [id,t] of Object.entries(d.tensores))if(t.bytes){
 const bytes=pesos.subarray(t.offset,t.offset+t.bytes),copia=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 constantes.set(+id,tf.tensor(t.dtype==='int32'?new Int32Array(copia):new Float32Array(copia),t.forma,t.dtype));
}
const usar=(o,j)=>constantes.get(o.entradas[j]);
for(const o of d.ops)if(['CONV_2D','DEPTHWISE_CONV_2D','TRANSPOSE_CONV'].includes(o.tipo)){
 const clave=o.tipo+':'+o.entradas[1];if(filtros.has(clave))continue;
 const w=usar(o,1);
 filtros.set(clave,tf.tidy(()=>o.tipo==='CONV_2D'?tf.transpose(w,[1,2,3,0]):o.tipo==='TRANSPOSE_CONV'?tf.transpose(w,[1,2,0,3]):tf.reshape(w,[w.shape[1],w.shape[2],w.shape[3]/o.opciones.DepthMultiplier,o.opciones.DepthMultiplier])));
}
const inicial=leer('entrada.f32'),entrada=tf.tensor(new Float32Array(inicial.buffer.slice(inicial.byteOffset,inicial.byteOffset+inicial.byteLength)),d.tensores[d.entrada].forma);
const valores=new Map(constantes);valores.set(d.entrada,entrada);
const usos=new Map();for(const o of d.ops)for(const id of o.entradas)usos.set(id,(usos.get(id)??0)+1);
const inicio=performance.now();
try{
 for(let i=0;i<d.ops.length;i++){
  const o=d.ops[i],a=o.opciones,x=o.entradas.map(id=>valores.get(id));
  const r=tf.tidy(()=>{
   let y;const pad=a.Padding===0?'same':'valid',f=filtros.get(o.tipo+':'+o.entradas[1]);
   switch(o.tipo){
    case 'CONV_2D':y=tf.conv2d(x[0],f,[a.StrideH,a.StrideW],pad,'NHWC',[a.DilationHFactor,a.DilationWFactor]);if(x[2])y=tf.add(y,x[2]);break;
    case 'DEPTHWISE_CONV_2D':y=tf.depthwiseConv2d(x[0],f,[a.StrideH,a.StrideW],pad,'NHWC',[a.DilationHFactor,a.DilationWFactor]);if(x[2])y=tf.add(y,x[2]);break;
    case 'TRANSPOSE_CONV':y=tf.conv2dTranspose(x[2],f,Array.from(x[0].dataSync()),[a.StrideH,a.StrideW],pad);if(x[3])y=tf.add(y,x[3]);break;
    case 'ADD':y=tf.add(x[0],x[1]);break;
    case 'MUL':y=tf.mul(x[0],x[1]);break;
    case 'RESHAPE':y=tf.reshape(x[0],Array.from(x[1].dataSync()));break;
    case 'TRANSPOSE':y=tf.transpose(x[0],Array.from(x[1].dataSync()));break;
    case 'SOFTMAX':y=tf.softmax(a.Beta===1?x[0]:tf.mul(x[0],a.Beta));break;
    case 'SUM':y=tf.sum(x[0],Array.from(x[1].dataSync()),a.KeepDims);break;
    case 'RESIZE_BILINEAR':y=tf.image.resizeBilinear(x[0],Array.from(x[1].dataSync()),a.AlignCorners,a.HalfPixelCenters);break;
    case 'RESIZE_NEAREST_NEIGHBOR':y=tf.image.resizeNearestNeighbor(x[0],Array.from(x[1].dataSync()),a.AlignCorners,a.HalfPixelCenters);break;
    default:throw new Error('Operador sin implementar: '+o.tipo);
   }
   switch(a.FusedActivationFunction??0){case 0:break;case 1:y=tf.relu(y);break;case 2:y=tf.clipByValue(y,-1,1);break;case 3:y=tf.clipByValue(y,0,6);break;default:throw new Error('Activacion no validada');}
   return y;
  });
  if(o.salidas.length!==1)throw new Error('Salida multiple no soportada');
  valores.set(o.salidas[0],r);
  for(const id of o.entradas){usos.set(id,usos.get(id)-1);if(usos.get(id)===0&&id!==d.entrada&&id!==d.salida&&!constantes.has(id)){valores.get(id)?.dispose();valores.delete(id);}}
 }
 const salida=await valores.get(d.salida).data(),ref=leer('salida-litert.f32');
 const esperado=new Float32Array(ref.buffer.slice(ref.byteOffset,ref.byteOffset+ref.byteLength));
 let max=0,suma=0;for(let i=0;i<salida.length;i++){const e=Math.abs(salida[i]-esperado[i]);max=Math.max(max,e);suma+=e;}
 const informe={runtime:'TensorFlow.js 4.22 CPU',valores:salida.length,error_maximo:max,error_medio:suma/salida.length,segundos:(performance.now()-inicio)/1000,paridad_un_tensor:max<.002,fotorealismo_evaluado:false};
 writeFileSync(new URL('paridad.json',laboratorio),JSON.stringify(informe,null,2)+'\n');
 console.log(JSON.stringify(informe));if(!informe.paridad_un_tensor)process.exitCode=1;
}finally{
 for(const t of new Set([...valores.values(),...filtros.values(),entrada]))t.dispose();
 console.log(JSON.stringify({tensores_restantes:tf.memory().numTensors}));
}
