import type {Pose} from './pose';
import {limitar,mediana,luz,mediaCaja,muestra} from './filtros-material';

interface Imagen {ancho:number;alto:number;rgba:Uint8Array|Uint8ClampedArray}
export interface CampoCamiseta {alfa:Float32Array;sombra:Float32Array;x0:number;x1:number;y0:number;y1:number}

/** Campo local para camiseta base. No reconstruye cuerpo ni prendas ocultas. */
export function prepararCampoCamiseta(f:Imagen,p:Float32Array,pose:Pose):CampoCamiseta {
 const w=f.ancho,h=f.alto,n=w*h,arriba=(pose[5].y+pose[6].y)/2,
  cadera=(pose[11].y+pose[12].y)/2,largo=cadera-arriba,
  izq=Math.min(pose[5].x,pose[6].x),der=Math.max(pose[5].x,pose[6].x),ancho=der-izq;
 const l=new Float32Array(n),cr=new Float32Array(n),cg=new Float32Array(n),cb=new Float32Array(n),
  ropa=new Float32Array(n),otros=new Float32Array(n),proteccion=new Float32Array(n);
 const referencias=[[],[],[],[]] as number[][];
 let bx0=w,bx1=0,by0=h,by1=0,cantidadOtros=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,r=f.rgba[i*4]/255,g=f.rgba[i*4+1]/255,b=f.rgba[i*4+2]/255,suma=Math.max(.05,r+g+b);
  l[i]=luz(r,g,b);cr[i]=r/suma;cg[i]=g/suma;cb[i]=b/suma;
  const sx=(x+.5)*256/w-.5,sy=(y+.5)*256/h-.5;
  const clases=[0,1,2,3,4,5].map(k=>muestra(p,256,256,6,sx,sy,k));
  ropa[i]=clases[4];otros[i]=clases[5];proteccion[i]=clases[1]+clases[2]+clases[3];
  if(y>arriba+.35*largo&&y<arriba+.75*largo&&x>izq+.15*ancho&&x<der-.15*ancho&&clases[4]>.9&&i%3===0){
   [l[i],cr[i],cg[i],cb[i]].forEach((v,k)=>referencias[k].push(v));
  }
  if(y>arriba-.2*largo&&y<cadera&&x>izq&&x<der&&clases[5]===Math.max(...clases)){
   bx0=Math.min(bx0,x);bx1=Math.max(bx1,x);by0=Math.min(by0,y);by1=Math.max(by1,y);cantidadOtros++;
  }
 }
 if(referencias[0].length<20)throw new Error('No se identificó suficiente tejido de la camiseta.');
 const [referencia,rref,gref,bref]=referencias.map(mediana);
 if(referencia<.055)throw new Error('La camiseta está demasiado oscura o su color no permite separar el tejido. Prueba una camiseta lisa y con mejor luz.');
 const gx=new Float32Array(n),gy=new Float32Array(n);
 const pixel=(x:number,y:number)=>l[limitar(y,0,h-1)*w+limitar(x,0,w-1)]*255;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;
  gx[i]=Math.abs(pixel(x+1,y-1)+2*pixel(x+1,y)+pixel(x+1,y+1)-pixel(x-1,y-1)-2*pixel(x-1,y)-pixel(x-1,y+1));
  gy[i]=Math.abs(pixel(x-1,y+1)+2*pixel(x,y+1)+pixel(x+1,y+1)-pixel(x-1,y-1)-2*pixel(x,y-1)-pixel(x+1,y-1));
 }
 const gradX=mediaCaja(gx,w,h,2),gradY=mediaCaja(gy,w,h,1),objeto=new Uint8Array(n);
 if(cantidadOtros>n*.001){
  const bw=bx1-bx0;
  if(bw<ancho*.06||bw>ancho*.5||by1-by0<bw)throw new Error('Hay un objeto tapando la camiseta que no se pudo delimitar. Prueba una foto sin objetos delante del torso.');
  let mejor=-Infinity,rectangulo:number[]|undefined;
  for(let x0=Math.max(2,bx0-Math.round(bw*.1));x0<Math.min(w-3,bx0+Math.round(bw*.15));x0+=2)
   for(let x1=Math.max(x0+12,bx1-Math.round(bw*.25));x1<Math.min(w-2,bx1+Math.round(bw*.05));x1+=2){
    const anchura=x1-x0;
    for(let y0=by0;y0<Math.min(by1-Math.round(anchura*1.2),by0+Math.round((by1-by0)*.55));y0++){
     let horizontal=0,vertical=0;const fin=Math.min(h-1,y0+Math.round(anchura*.65));
     for(let x=x0+4;x<x1-4;x++)horizontal+=gradY[y0*w+x];
     for(let y=y0+4;y<fin;y++)vertical+=gradX[y*w+x0]+gradX[y*w+x1];
     const puntuacion=horizontal/(anchura-8)+.6*vertical/Math.max(1,fin-y0-4);
     if(puntuacion>mejor){mejor=puntuacion;rectangulo=[x0,y0,x1,Math.min(by1+3,y0+Math.round(anchura*2.2))];}
    }
   }
  if(!rectangulo||mejor<15)throw new Error('No se pudo separar el objeto delante de la camiseta. Repite sin el teléfono frente al cuerpo.');
  const [x0,y0,x1,y1]=rectangulo,margen=Math.round((x1-x0)*.1);
  for(let y=Math.max(0,y0-margen);y<=Math.min(h-1,y1+margen);y++)for(let x=Math.max(0,x0-margen);x<=Math.min(w-1,x1+margen);x++)objeto[y*w+x]=1;
 }
 // El modelo solo distingue ropa: separar el pantalón requiere una transición observada.
 const perfil=new Float32Array(h);
 for(let y=0;y<h;y++){
  const filas=[[],[],[],[]] as number[][];
  for(let x=Math.round(izq+.2*ancho);x<Math.round(der-.2*ancho);x+=2){const i=y*w+x;filas[0].push(cr[i]);filas[1].push(cg[i]);filas[2].push(cb[i]);filas[3].push(l[i]);}
  perfil[y]=Math.max(Math.abs(mediana(filas[0])-rref),Math.abs(mediana(filas[1])-gref),Math.abs(mediana(filas[2])-bref),Math.max(0,Math.abs(mediana(filas[3])-referencia)-Math.max(.12,referencia*.25)));
 }
 const perfilSuave=mediaCaja(perfil,1,h,4);let borde=-1;
 for(let y=Math.max(0,Math.round(cadera+.08*largo));y<Math.min(h,Math.round(cadera+.45*largo));y++)if(perfilSuave[y]>.0185){borde=y;break;}
 if(borde<0)throw new Error('No se distingue el final de la camiseta del pantalón. Usa prendas de colores diferentes y muestra el borde inferior.');
 const ya=Math.max(1,borde-Math.round(.16*largo)),yb=Math.min(h-2,borde+Math.round(.04*largo)),
  xa=Math.max(1,Math.round(izq-.1*ancho)),xb=Math.min(w-2,Math.round(der+.1*ancho)),filas=yb-ya;
 const colores=[cr,cg,cb].map(c=>mediaCaja(c,w,h,5)),gradiente=mediaCaja(gy,w,h,4);
 const coste=(x:number,y:number)=>{
  const cambio=Math.max(...colores.map(c=>Math.abs(c[Math.min(h-1,y+8)*w+x]-c[Math.max(0,y-8)*w+x])));
  return gradiente[y*w+x]+500*cambio-.2*Math.abs(y-borde);
 };
 let costes=Float64Array.from({length:filas},(_,j)=>-coste(xa,ya+j));const caminos:Int8Array[]=[];
 for(let x=xa+1;x<xb;x++){
  const nuevo=new Float64Array(filas),camino=new Int8Array(filas);
  for(let j=0;j<filas;j++){
   let valor=costes[j],paso=0;
   if(j>0&&costes[j-1]+.7<valor){valor=costes[j-1]+.7;paso=-1;}
   if(j+1<filas&&costes[j+1]+.7<valor){valor=costes[j+1]+.7;paso=1;}
   nuevo[j]=valor-coste(x,ya+j);camino[j]=paso;
  }costes=nuevo;caminos.push(camino);
 }
 let j=0;for(let k=1;k<filas;k++)if(costes[k]<costes[j])j=k;
 const curva=new Float64Array(xb-xa);curva[curva.length-1]=ya+j;
 for(let x=curva.length-2;x>=0;x--){j=limitar(j+caminos[x][j],0,filas-1);curva[x]=ya+j;}
 const coef=ajustarCuadratica(curva),dobladillo=new Float32Array(w);
 for(let x=0;x<w;x++){const t=2*(x-xa)/Math.max(1,xb-xa-1)-1;dobladillo[x]=limitar(coef[0]+coef[1]*t+coef[2]*t*t,ya,yb-1);}
 const semilla=new Float32Array(n),visitado=new Uint8Array(n),cola=new Int32Array(n);let inicio=0,fin=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(y>=Math.min(pose[5].y,pose[6].y)-.6*largo&&!objeto[i])semilla[i]=(ropa[i]+otros[i])*limitar((dobladillo[x]+1-y)/2);}
 // Una mano puede dividir la camiseta en varios componentes válidos.
 for(const fy of [.1,.25,.45,.6])for(const fx of [.2,.5,.8]){
  const i=Math.round(arriba+fy*largo)*w+Math.round(izq+fx*ancho);
  if(i>=0&&i<n&&semilla[i]>.4&&!visitado[i]){cola[fin++]=i;visitado[i]=1;}
 }
 while(inicio<fin){const i=cola[inicio++],x=i%w;for(const k of [x>0?i-1:-1,x<w-1?i+1:-1,i-w,i+w])if(k>=0&&k<n&&!visitado[k]&&semilla[k]>.4){visitado[k]=1;cola[fin++]=k;}}
 if(fin<w*largo*.1)throw new Error('La máscara de la camiseta está incompleta.');
 const soporte=mediaCaja(Float32Array.from(visitado),w,h,3),s=new Float32Array(n),ll=new Float32Array(n),ls=new Float32Array(n);
 for(let i=0;i<n;i++){s[i]=soporte[i]>0?semilla[i]:0;ll[i]=l[i]*l[i];ls[i]=l[i]*s[i];}
 const ml=mediaCaja(l,w,h,3),ms=mediaCaja(s,w,h,3),mll=mediaCaja(ll,w,h,3),mls=mediaCaja(ls,w,h,3),a=new Float32Array(n),b=new Float32Array(n);
 for(let i=0;i<n;i++){a[i]=(mls[i]-ml[i]*ms[i])/(mll[i]-ml[i]*ml[i]+.0005);b[i]=ms[i]-a[i]*ml[i];}
 const ma=mediaCaja(a,w,h,3),mb=mediaCaja(b,w,h,3),alfa=new Float32Array(n),bordes:number[][]=[];let y0=h,y1=0;
 for(let y=0;y<h;y++){
  let x0=w,x1=0;
  for(let x=0;x<w;x++){const i=y*w+x;alfa[i]=objeto[i]?0:limitar((ma[i]*l[i]+mb[i]-.08)/.7)*limitar((.65-proteccion[i])/.35);
   if(alfa[i]>.5){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  if(y>arriba+.4*largo&&y<arriba+.8*largo&&x1>x0)bordes.push([x0,x1]);
 }
 if(y1-y0<largo*.5||!bordes.length)throw new Error('La máscara de la camiseta es insuficiente.');
 const local=mediaCaja(l,w,h,25),atipico=new Float32Array(n),valida=new Float32Array(n),valor=new Float32Array(n);
 for(let i=0;i<n;i++)atipico[i]=alfa[i]>.9&&l[i]>local[i]*1.45+.03?1:0;
 const expansion=mediaCaja(atipico,w,h,Math.max(3,Math.round(ancho*.025)));
 for(let i=0;i<n;i++)if(alfa[i]>.9&&l[i]>local[i]*.3&&expansion[i]===0){valida[i]=1;valor[i]=l[i];}
 // Rellenar muestras descartadas antes del filtrado fino evita manchas planas
 // cuando un logo de la camiseta base ocupa todo el vecindario pequeño.
 const radioAmplio=Math.max(12,Math.round(ancho*.09)),pesoAmplio=mediaCaja(valida,w,h,radioAmplio),valorAmplio=mediaCaja(valor,w,h,radioAmplio),relleno=new Float32Array(n);
 for(let i=0;i<n;i++)relleno[i]=valida[i]?l[i]:pesoAmplio[i]>.01?valorAmplio[i]/pesoAmplio[i]:referencia;
 const radio=Math.max(3,Math.round(ancho*.018)),promedio=mediaCaja(relleno,w,h,radio),sombra=new Float32Array(n);
 for(let i=0;i<n;i++)sombra[i]=limitar((promedio[i]/Math.max(.02,referencia))**1.1,.35,1.7);
 return {alfa,sombra,y0,y1,x0:mediana(bordes.map(b=>b[0])),x1:mediana(bordes.map(b=>b[1]))};
}

/** Mínimos cuadrados en coordenadas normalizadas, sin librerías ni selección por fotografía. */
function ajustarCuadratica(y:Float64Array):number[] {
 const m=Array.from({length:3},()=>[0,0,0,0]);
 for(let i=0;i<y.length;i++){const x=2*i/Math.max(1,y.length-1)-1,v=[1,x,x*x];for(let r=0;r<3;r++){for(let c=0;c<3;c++)m[r][c]+=v[r]*v[c];m[r][3]+=v[r]*y[i];}}
 for(let k=0;k<3;k++){const divisor=m[k][k];if(Math.abs(divisor)<1e-9)return [mediana(Array.from(y)),0,0];for(let c=k;c<4;c++)m[k][c]/=divisor;for(let r=0;r<3;r++)if(r!==k){const factor=m[r][k];for(let c=k;c<4;c++)m[r][c]-=factor*m[k][c];}}
 return m.map(f=>f[3]);
}
