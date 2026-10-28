import type {Pose} from './pose';

/** Raster orientado RGBA. Operaciones puras, sin DOM, red ni dependencias de IA. */
export interface Raster {ancho:number;alto:number;rgba:Uint8Array|Uint8ClampedArray}
export interface AnclasMaterial {izquierda:number;derecha:number;arriba:number;abajo:number;estampados?:number[][]}
export interface Material {lado:number;rgb:Float32Array;mascara:Float32Array;color:number[];encuadre:{izquierda:number;arriba:number;ancho:number;alto:number}}
import {limitar,mediana,luz,mediaCaja,muestra} from './filtros-material';
export {mediaCaja} from './filtros-material';
import {prepararCampoCamiseta} from './campo-camiseta';
const lineal=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=(v:number)=>v<=.0031308?v*12.92:1.055*Math.max(0,v)**(1/2.4)-.055;

function validar(r:Raster):void {if(r.ancho<2||r.alto<2||r.ancho>2048||r.alto>2048||r.rgba.length!==r.ancho*r.alto*4)throw new Error('Imagen inválida o demasiado grande.');}

/** Reduce sombras de origen sin división local que amplifique grano. */
export function prepararMaterial(r:Raster,a:AnclasMaterial,detalle=.2):Material {
 validar(r);
 if(![a.izquierda,a.derecha,a.arriba,a.abajo].every(Number.isFinite)||a.izquierda<0||a.derecha>1||a.arriba<0||a.abajo>1||a.derecha<=a.izquierda||a.abajo<=a.arriba)throw new Error('Anclas del material inválidas.');
 const zonas=a.estampados;
 if(!Array.isArray(zonas))throw new Error('Esta fotografía necesita preparación de estampados. Actualiza el catálogo o prepara de nuevo la prenda en Administración.');
 if(zonas.length>16||zonas.some(z=>!Array.isArray(z)||z.length!==4||!z.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||z[2]<=z[0]||z[3]<=z[1]))throw new Error('Las zonas de estampado no cumplen el contrato.');
 const proteccion=new Float32Array(384*384);
 const lado=384,n=lado*lado,original=new Float32Array(n*3),luminancia=new Float32Array(n),canales=[[],[],[]] as number[][];
 let vacios=0;let x0=a.izquierda+.12*(a.derecha-a.izquierda),x1=a.derecha-.12*(a.derecha-a.izquierda),y0=a.arriba+.13*(a.abajo-a.arriba),y1=a.abajo-.13*(a.abajo-a.arriba);
 for(const z of zonas){x0=Math.max(0,Math.min(x0,z[0]-.01));x1=Math.min(1,Math.max(x1,z[2]+.01));y0=Math.max(0,Math.min(y0,z[1]-.01));y1=Math.min(1,Math.max(y1,z[3]+.01));}
 for(let y=0;y<lado;y++)for(let x=0;x<lado;x++){
  const i=y*lado+x,sx=(x0+(x1-x0)*x/(lado-1))*(r.ancho-1),sy=(y0+(y1-y0)*y/(lado-1))*(r.alto-1);
  const nx=sx/(r.ancho-1),ny=sy/(r.alto-1);
  for(const z of zonas)proteccion[i]=Math.max(proteccion[i],limitar(Math.min((nx-z[0])/(z[2]-z[0]),(z[2]-nx)/(z[2]-z[0]),(ny-z[1])/(z[3]-z[1]),(z[3]-ny)/(z[3]-z[1]))/.08));
  if(muestra(r.rgba,r.ancho,r.alto,4,sx,sy,3)<242)vacios++;
  for(let k=0;k<3;k++){const v=muestra(r.rgba,r.ancho,r.alto,4,sx,sy,k)/255;original[i*3+k]=v;if(i%8===0)canales[k].push(v);}
  luminancia[i]=luz(original[i*3],original[i*3+1],original[i*3+2]);
 }
 if(vacios/n>.01)throw new Error('La foto del producto no tiene un torso completo para transferir el tejido.');
 const color=canales.map(mediana),base=luz(...color as [number,number,number]),cbase=color.map(c=>c/Math.max(.05,base));
 const iluminacion=mediaCaja(luminancia,lado,lado,12),coherente=mediaCaja(luminancia,lado,lado,3),rgb=new Float32Array(n*3),mascara=new Float32Array(n);
 for(let i=0;i<n;i++){
  const l=luminancia[i],c=[0,1,2].map(k=>original[i*3+k]/Math.max(l,.05));
  const estampado=limitar((Math.max(...c.map((v,k)=>Math.abs(v-cbase[k])))-.12)/.15),tinta=limitar((base-coherente[i]-.55)/.1);
  mascara[i]=Math.max(proteccion[i],estampado,tinta);
  let v=base+(l-iluminacion[i])*Math.max(limitar(detalle,.2,1),proteccion[i]);v=v*(1-proteccion[i])+l*proteccion[i];v=v*(1-tinta)+l*tinta;v=v*(1-estampado)+l*estampado;
  for(let k=0;k<3;k++)rgb[i*3+k]=limitar((cbase[k]+(c[k]-cbase[k])*(.25+.75*Math.max(estampado,proteccion[i])))*v);
 }
 const anchoAnclas=(a.derecha-a.izquierda)*r.ancho;
 return {lado,rgb,mascara,color,encuadre:{izquierda:(x0-(a.izquierda+a.derecha)/2)*r.ancho/anchoAnclas,arriba:(y0-a.arriba)*r.alto/anchoAnclas,ancho:(x1-x0)*r.ancho/anchoAnclas,alto:(y1-y0)*r.alto/anchoAnclas}};
}

/** Escala uniforme del diseño del producto: no estira letras según el largo del torso. */
function muestreadorMaterial(m:Material,pose:Pose):(x:number,y:number,k:number)=>number {
 const [a,b]=pose[5].x<pose[6].x?[pose[5],pose[6]]:[pose[6],pose[5]],dx=b.x-a.x,dy=b.y-a.y,ancho=Math.sqrt(dx*dx+dy*dy),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,cos=dx/ancho,sin=dy/ancho,e=m.encuadre;
 return (x,y,k)=>{
  const u=(((x-cx)*cos+(y-cy)*sin)/ancho-e.izquierda)/e.ancho,v=((-(x-cx)*sin+(y-cy)*cos)/ancho-e.arriba)/e.alto;
  const mezcla=limitar(Math.min(u,1-u,v,1-v)/.04)*muestra(m.mascara,m.lado,m.lado,1,u*(m.lado-1),v*(m.lado-1),0);
  if(mezcla===0)return m.color[k];
  return m.color[k]+(muestra(m.rgb,m.lado,m.lado,3,u*(m.lado-1),v*(m.lado-1),k)-m.color[k])*mezcla;
 };
}

/** Transferencia local con máscara semántica; no requiere codos para aplicar un material. */
export function validarTransferencia(f:Raster,p:Float32Array,pose:Pose):void {
 validar(f);
 if(p.length!==256*256*6||!p.every(Number.isFinite))throw new Error('Máscara semántica inválida.');
 if([5,6,11,12].some(i=>!pose[i]||pose[i].confianza<.35||!Number.isFinite(pose[i].x+pose[i].y)))throw new Error('Muestra hombros y cadera.');
 const w=f.ancho,h=f.alto,arriba=(pose[5].y+pose[6].y)/2,abajo=(pose[11].y+pose[12].y)/2,izq=Math.min(pose[5].x,pose[6].x),der=Math.max(pose[5].x,pose[6].x);
 if(abajo-arriba<h*.15||der-izq<w*.15||arriba<0||abajo>=h||izq<0||der>=w)throw new Error('Acércate y muestra el torso completo, de frente.');
}

export function transferirMaterial(f:Raster,p:Float32Array,pose:Pose,m:Material):Raster {
 validarTransferencia(f,p,pose);
 const w=f.ancho,h=f.alto;
 const campo=prepararCampoCamiseta(f,p,pose),rgba=new Uint8ClampedArray(f.rgba),muestrear=muestreadorMaterial(m,pose);
 if(campo.x1-campo.x0<1)throw new Error('No se identificó un torso completo.');
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,alpha=campo.alfa[i];if(alpha===0)continue;
  for(let k=0;k<3;k++){const tela=muestrear(x,y,k),c=limitar(srgb(lineal(tela)*campo.sombra[i]));rgba[i*4+k]=Math.round(f.rgba[i*4+k]*(1-alpha)+255*c*alpha);}
 }
 return {ancho:w,alto:h,rgba};
}
