/** Compositor REAL compartido con Web; datos privados únicamente en temporales. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {prepararMaterial,transferirMaterial} from '../../aplicaciones/probador-virtual/fuente/dominio/material-camiseta';
const raiz=fileURLToPath(new URL('../../temporales/',import.meta.url));
const carpeta=resolve(process.argv[2]??resolve(raiz,'laboratorio-realismo'));
if(!carpeta.startsWith(raiz))throw new Error('Los datos privados deben permanecer en temporales');
const p=pathToFileURL(carpeta+sep);
const leer=(n:string)=>readFileSync(new URL(n,p));
const datos=JSON.parse(leer('datos-cliente.json').toString());
const material=prepararMaterial({ancho:datos.texturaAncho,alto:datos.texturaAlto,rgba:leer('textura-cliente.rgba')},datos.anclas);
const bytes=leer('probabilidades.f32'),probabilidades=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const inicio=performance.now();
const resultado=transferirMaterial({ancho:datos.ancho,alto:datos.alto,rgba:leer('foto-cliente.rgba')},probabilidades,datos.pose,material);
writeFileSync(new URL('resultado-cliente.rgba',p),resultado.rgba);
console.log(JSON.stringify({compositor:'TS real del cliente',ancho:resultado.ancho,alto:resultado.alto,segundos:(performance.now()-inicio)/1000}));
