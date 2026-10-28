import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepararMaterial,transferirMaterial,mediaCaja,type Raster} from '../fuente/dominio/material-camiseta';
import type {Pose} from '../fuente/dominio/pose';
const anclas={izquierda:0,derecha:1,arriba:0,abajo:1,estampados:[] as number[][]};
function textura(ruido=false):Raster {
 const rgba=new Uint8Array(100*100*4);
 for(let y=0;y<100;y++)for(let x=0;x<100;x++){const i=(y*100+x)*4,f=ruido?1+.1*Math.sin(x*.25)+.05*Math.sin(y*.3):1;for(let k=0;k<3;k++)rgba[i+k]=Math.round([145,180,160][k]*f);rgba[i+3]=255;}
 return {ancho:100,alto:100,rgba};
}
function foto(){
 const rgba=new Uint8Array(80*120*4),p=new Float32Array(256*256*6),pose:Pose=Array.from({length:17},()=>({x:0,y:0,confianza:0}));
 for(let y=0;y<120;y++)for(let x=0;x<80;x++){const i=(y*80+x)*4,camiseta=x>=20&&x<=60&&y>=35&&y<=100,mano=x>=32&&x<=40&&y>=75&&y<=84;const c=mano?[180,130,100]:camiseta?Array(3).fill(Math.round(215+15*Math.sin(y*.1))):[20,25,30];rgba.set([...c,255],i);}
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const xx=(x+.5)*80/256,yy=(y+.5)*120/256;const mano=xx>=32&&xx<=40&&yy>=75&&yy<=84,camiseta=xx>=20&&xx<=60&&yy>=35&&yy<=100;p[(y*256+x)*6+(mano?2:camiseta?4:0)]=1;}
 for(const [i,x,y] of [[5,20,35],[6,60,35],[7,15,70],[8,65,70],[11,30,100],[12,50,100]])pose[i]={x,y,confianza:.9};
 return {f:{ancho:80,alto:120,rgba},p,pose};
}
test('material: baja variación de tela sin amplificar ruido y conserva color dominante',()=>{
 const r=textura(true),m=prepararMaterial(r,anclas);let suma=0,s2=0,n=0;
 for(let y=80;y<300;y++)for(let x=80;x<300;x++){const v=m.rgb[(y*384+x)*3+1];suma+=v;s2+=v*v;n++;}
 assert.ok(Math.sqrt(s2/n-(suma/n)**2)<.035);
 assert.ok(Math.abs(suma/n-180/255)<.03);
});
test('material: mantiene gráficos rojos y tinta negra de alto contraste',()=>{
 const r=textura();for(let y=20;y<50;y++)for(let x=35;x<65;x++)r.rgba.set([220,20,20,255],(y*100+x)*4);
 for(let y=60;y<80;y++)for(let x=35;x<65;x++)r.rgba.set([5,5,5,255],(y*100+x)*4);
 const m=prepararMaterial(r,anclas),rojo=(100*384+192)*3,negro=(300*384+192)*3;
 assert.ok(m.rgb[rojo]>m.rgb[rojo+1]*3);assert.ok(m.rgb[negro]<.1);
});
test('material: respeta fondo y piel y conserva variación de luz de camiseta base',()=>{
 const {f,p,pose}=foto(),original=f.rgba.slice(),r=transferirMaterial(f,p,pose,prepararMaterial(textura(),anclas));
 for(const [x,y] of [[2,50],[36,79]]){const i=(y*80+x)*4;assert.deepEqual(Array.from(r.rgba.slice(i,i+4)),Array.from(f.rgba.slice(i,i+4)));}
 assert.notEqual(r.rgba[(60*80+50)*4],f.rgba[(60*80+50)*4]);
 assert.deepEqual(f.rgba,original);
});
test('material: rechaza base sin información de luz, cadera oculta, máscara corrupta y textura incompleta',()=>{
 const {f,p,pose}=foto(),m=prepararMaterial(textura(),anclas),oscura={...f,rgba:f.rgba.map((_,i)=>i%4===3?255:0)};
 assert.throws(()=>transferirMaterial(oscura,p,pose,m),/camiseta|tejido/);
 const parcial=pose.map(v=>({...v}));parcial[11].confianza=.1;assert.throws(()=>transferirMaterial(f,p,parcial,m),/cadera/);
 const corrupta=p.slice();corrupta[0]=NaN;assert.throws(()=>transferirMaterial(f,corrupta,pose,m),/semántica/);
 const tx=textura();tx.rgba.fill(0);assert.throws(()=>prepararMaterial(tx,anclas),/torso completo/);
});

test('camiseta oscura: cubre torso y mangas, separa pantalón y conserva mano/teléfono/fondo',()=>{
 const d=JSON.parse(readFileSync(new URL('../../../compartido/prendas/fixtures/camiseta-oscura.json',import.meta.url),'utf8'));
 const clase=(x:number,y:number)=>d.formas.filter((s:{caja:number[]})=>x>=s.caja[0]&&x<s.caja[2]&&y>=s.caja[1]&&y<s.caja[3]).at(-1);
 const rgba=new Uint8Array(d.ancho*d.alto*4),p=new Float32Array(256*256*6),pose:Pose=Array.from({length:17},()=>({x:0,y:0,confianza:0}));
 for(let y=0;y<d.alto;y++)for(let x=0;x<d.ancho;x++)rgba.set([...(clase(x,y)?.color??d.fondo),255],(y*d.ancho+x)*4);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++)p[(y*256+x)*6+(clase((x+.5)*d.ancho/256,(y+.5)*d.alto/256)?.clase??0)]=1;
 for(const [i,x,y] of d.puntos)pose[i]={x,y,confianza:.9};
 const r=transferirMaterial({ancho:d.ancho,alto:d.alto,rgba},p,pose,prepararMaterial(textura(),anclas));
 for(const [x,y] of d.inalterados){const i=(y*d.ancho+x)*4;assert.deepEqual(Array.from(r.rgba.slice(i,i+4)),Array.from(rgba.slice(i,i+4)));}
 for(const [x,y] of d.cubiertos){const i=(y*d.ancho+x)*4;assert.ok(r.rgba[i+1]>r.rgba[i]+15);assert.notEqual(r.rgba[i+1],rgba[i+1]);}
 const viejo=(120*d.ancho+99)*4,vecino=(120*d.ancho+115)*4;
 assert.ok(Math.abs(r.rgba[viejo+1]-r.rgba[vecino+1])<25,'El estampado viejo no debe reaparecer como un brillo blanco');
 const ambiguo=rgba.slice();for(let y=230;y<280;y++)for(let x=75;x<185;x++)ambiguo.set([48,58,60,255],(y*d.ancho+x)*4);
 assert.throws(()=>transferirMaterial({ancho:d.ancho,alto:d.alto,rgba:ambiguo},p,pose,prepararMaterial(textura(),anclas)),/final de la camiseta/);
});
test('media separable preserva constantes incluso en bordes',()=>{
 assert.deepEqual(Array.from(mediaCaja(new Float32Array(12).fill(.5),4,3,2)),Array(12).fill(.5));
});

test('el bordado tenue protegido conserva trazos y rechaza zonas corruptas o recursos antiguos',()=>{
 const r=textura();
 // Una H de contraste bajo: no basta la prueba anterior de tinta negra/roja.
 for(let y=30;y<50;y++)for(let x=40;x<60;x++)if(x<43||x>=57||y>=38&&y<=41)r.rgba.set([155,190,170,255],(y*100+x)*4);
 const m=prepararMaterial(r,{...anclas,estampados:[[.35,.25,.65,.55]]});
 const indice=(x:number,y:number)=>(Math.round((y-.13)/.74*383)*384+Math.round((x-.12)/.76*383))*3;
 const trazo=indice(.41,.33),hueco=indice(.49,.33);
 assert.ok((m.rgb[trazo+1]-m.rgb[hueco+1])*255>=7,'Debe conservar al menos 70% del contraste del bordado débil');
 assert.throws(()=>prepararMaterial(r,{izquierda:0,derecha:1,arriba:0,abajo:1}),/preparación de estampados/);
 assert.throws(()=>prepararMaterial(r,{...anclas,estampados:[[0,0,NaN,1]]}),/zonas de estampado/);
});

test('el diseño conserva proporción cuadrada aunque cambie el largo del torso',()=>{
 const tx=textura();for(let y=30;y<50;y++)for(let x=40;x<60;x++)tx.rgba.set([220,20,20,255],(y*100+x)*4);
 const m=prepararMaterial(tx,anclas);
 for(const cadera of [85,110]){
  const {f,p,pose}=foto();pose[11].y=cadera;pose[12].y=cadera;
  const salida=transferirMaterial(f,p,pose,m);const xs:number[]=[],ys:number[]=[];
  for(let y=0;y<f.alto;y++)for(let x=0;x<f.ancho;x++){const i=(y*f.ancho+x)*4;if(salida.rgba[i]>salida.rgba[i+1]*2){xs.push(x);ys.push(y);}}
  assert.ok(xs.length>20);assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs))-(Math.max(...ys)-Math.min(...ys)))<=1);
 }
});
