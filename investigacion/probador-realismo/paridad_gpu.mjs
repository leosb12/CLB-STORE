/** Ensayo GPU real contra dominio puro. Requiere Vite local del probador en14300. */
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../aplicaciones/web/package.json',import.meta.url));
const {chromium}=require('playwright');
const fixture=JSON.parse(readFileSync(new URL('../../compartido/prendas/fixtures/camiseta-oscura.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:14300/');
  const resultados=await page.evaluate(async d=>{
    const {prepararMaterial,transferirMaterial}=await import('/fuente/dominio/material-camiseta.ts');
    const {prepararCampoCamiseta}=await import('/fuente/dominio/campo-camiseta.ts');
    const {MaterialWebGL}=await import('/fuente/adaptadores/material-webgl.ts');
    const clase=(x,y)=>d.formas.filter(s=>x>=s.caja[0]&&x<s.caja[2]&&y>=s.caja[1]&&y<s.caja[3]).at(-1);
    const rgba=new Uint8ClampedArray(d.ancho*d.alto*4),p=new Float32Array(256*256*6),pose=Array.from({length:17},()=>({x:0,y:0,confianza:0}));
    for(let y=0;y<d.alto;y++)for(let x=0;x<d.ancho;x++)rgba.set([...(clase(x,y)?.color??d.fondo),255],(y*d.ancho+x)*4);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)p[(y*256+x)*6+(clase((x+.5)*d.ancho/256,(y+.5)*d.alto/256)?.clase??0)]=1;
    for(const [i,x,y] of d.puntos)pose[i]={x,y,confianza:.9};
    const tela=new Uint8Array(100*100*4);
    for(let y=0;y<100;y++)for(let x=0;x<100;x++)tela.set(x>=35&&x<65&&y>=30&&y<50?[220,30,30,255]:[145,180,160,255],(y*100+x)*4);
    const material=prepararMaterial({ancho:100,alto:100,rgba:tela},{izquierda:0,derecha:1,arriba:0,abajo:1,estampados:[[.3,.25,.7,.55]]});
    const source=document.createElement('canvas');source.width=d.ancho;source.height=d.alto;source.getContext('2d').putImageData(new ImageData(rgba,d.ancho,d.alto),0,0);
    const gpu=new MaterialWebGL(material),informe=[];
    try{
      for(const rotacion of [0,8,-8]){
        pose[5].y=d.puntos.find(v=>v[0]===5)[2]+rotacion;pose[6].y=d.puntos.find(v=>v[0]===6)[2]-rotacion;
        const f={ancho:d.ancho,alto:d.alto,rgba},cpu=transferirMaterial(f,p,pose,material),campo=prepararCampoCamiseta(f,p,pose),bytes=new Uint8Array(d.ancho*d.alto*4);
        for(let i=0;i<campo.alfa.length;i++){bytes[i*4]=Math.round(campo.alfa[i]*255);bytes[i*4+1]=Math.round(campo.sombra[i]*127.5);bytes[i*4+3]=255;}
        const salida=gpu.pintar(source,bytes,d.ancho,d.alto,pose),c=document.createElement('canvas');c.width=d.ancho;c.height=d.alto;c.getContext('2d').drawImage(salida,0,0);const real=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let maximo=0,suma=0;for(let i=0;i<real.length;i++){const delta=Math.abs(real[i]-cpu.rgba[i]);maximo=Math.max(maximo,delta);suma+=delta;}
        for(const [x,y] of d.inalterados){const i=(y*d.ancho+x)*4;if(real[i]!==rgba[i]||real[i+1]!==rgba[i+1]||real[i+2]!==rgba[i+2])throw new Error('GPU alteró una zona protegida.');}
        informe.push({rotacion,error_maximo:maximo,error_medio:suma/real.length,valores:real.length});
      }
    }finally{gpu.cerrar();}
    return informe;
  },fixture);
  mkdirSync(new URL('../../temporales/video-material/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../../temporales/video-material/paridad-gpu.json',import.meta.url),JSON.stringify(resultados,null,2));
  console.log(JSON.stringify(resultados));
  if(resultados.some(r=>r.error_maximo>4||r.error_medio>.5))throw new Error('La composición GPU no conserva la referencia CPU.');
}finally{await browser.close();}
