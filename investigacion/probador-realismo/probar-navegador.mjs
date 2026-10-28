import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../aplicaciones/web/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const navegador=await chromium.launch({channel:'chrome',args:['--use-angle=swiftshader','--enable-webgl']});
try{
 const contexto=await navegador.newContext();
 // Prohibir toda red pública durante la prueba.
 await contexto.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const pagina=await contexto.newPage();
 pagina.on('pageerror',e=>console.error(e));
 await pagina.goto('http://127.0.0.1:14300/temporales/realismo/index.html');
 const resultado=await pagina.evaluate(()=>window.prueba);
 if(!resultado)throw new Error('No se obtuvo resultado de inferencia');
 resultado.hardware='Chromium Windows con SwiftShader: WebGL emulado, no Samsung ni GPU física';
 writeFileSync(new URL('../../temporales/laboratorio-realismo/webgl.json',import.meta.url),JSON.stringify(resultado,null,2)+'\n');
 console.log(JSON.stringify(resultado));
 if(resultado.tensoresAlCerrar!==0||resultado.mediciones.some(m=>m.error_maximo>.002||m.acuerdo_clases<.999))process.exitCode=1;
}finally{await navegador.close();}

