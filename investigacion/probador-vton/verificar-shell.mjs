// Shell Angular y microfrontend desplegados, con CSP real y sesión JWT de demostración.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const raiz=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(resolve(raiz,'aplicaciones/web/package.json'));
const {chromium}=require('@playwright/test');
const catalogo=await (await fetch('http://127.0.0.1:18000/api/v1/productos')).json();
const sku=process.argv[2] ?? 'CLB-FOTO-POL-ROJ';
if (!/^CLB-FOTO-[A-Z-]+$/.test(sku)) throw new Error('SKU de demostración inválido.');
const nombreSalida=process.argv[2] ? `shell-${sku.toLowerCase()}` : 'shell-real';
const producto=catalogo.productos.find(p=>p.sku===sku);
if (!producto) throw new Error('El ensayo requiere una prenda pública de demostración existente.');
const token=execFileSync('python',['-c',"import runpy; a=runpy.run_path('infraestructura/demostraciones/demo-gestion-ia.py'); print(a['token']('cliente.demo','CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO'))"],{cwd:raiz,encoding:'utf8'}).trim();
const titular=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub;
const salida=resolve(raiz,'investigacion/probador-vton/temporales');
await mkdir(salida,{recursive:true});
const navegador=await chromium.launch({headless:true,channel:'chrome'});
let identificador;
try {
 const contexto=await navegador.newContext();
 const pagina=await contexto.newPage();
 const violaciones=[];
 await pagina.exposeFunction('registrarCsp',dato=>violaciones.push(dato));
 await pagina.addInitScript(()=>{
  localStorage.setItem('clb_probador_modo', 'fotografico');
  document.addEventListener('securitypolicyviolation',evento=>window.registrarCsp({directiva:evento.violatedDirective,recurso:evento.blockedURI,fuente:evento.sourceFile,linea:evento.lineNumber}));
 });
 pagina.on('response',async r=>{
  if (r.url().endsWith('/api/v1/probador/trabajos') && r.request().method()==='POST' && r.ok()) identificador=(await r.json()).identificador;
 });
 const respuesta=await pagina.goto('http://127.0.0.1:14200/productos/'+producto.identificador+'/probador');
 if (!respuesta.headers()['content-security-policy']?.includes("connect-src 'self' blob:")) throw new Error('La web desplegada no tiene la CSP corregida.');
 await pagina.getByRole('heading',{name:'Pruébatela en tu fotografía'}).waitFor();
 await pagina.evaluate(async credenciales=>{
  const elemento=document.querySelector('clb-probador');
  elemento.sesionProbador=async()=>credenciales;
  const foto=await (await fetch(elemento.prenda.imagenFotografica ?? elemento.prenda.imagen)).blob();
  elemento.prenda={...elemento.prenda,imagenFotografica:URL.createObjectURL(foto)};
 },{titular,cabeceras:{Authorization:'Bearer '+token}});
 await pagina.locator('input[type=file]').setInputFiles(resolve(raiz,'investigacion/probador-realismo/fixtures/persona-base.jpg'));
 if (violaciones.length) throw new Error('Violaciones CSP previas a generar: '+JSON.stringify(violaciones));
 const inicio=Date.now();
 await pagina.getByRole('button',{name:'Generar imagen',exact:true}).click();
 const resultado=pagina.getByRole('img',{name:/generada con IA/});
 const error=pagina.getByRole('alert');
 await Promise.race([resultado.waitFor({timeout:720000}),error.waitFor({timeout:720000}).then(async()=>{throw new Error(await error.textContent());})]);
 if (violaciones.length) throw new Error('Violaciones CSP: '+JSON.stringify(violaciones));
 await pagina.screenshot({path:resolve(salida,`${nombreSalida}.png`),fullPage:true});
 const generacionMs=Date.now()-inicio;
 const png=await resultado.evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
 await writeFile(resolve(salida,`${nombreSalida}-resultado.png`),Buffer.from(png));
 await pagina.setViewportSize({width:390,height:844});
 await pagina.screenshot({path:resolve(salida,`${nombreSalida}-movil.png`),fullPage:true});
 if (!await pagina.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)) throw new Error('Desbordamiento móvil');
 const salud=await (await fetch('http://127.0.0.1:18000/salud/probador')).json();
 const evidencia={sku,version_motor:salud.version_motor,movil_sin_desborde:true,shell:'Angular desplegado',microfrontend:'React desplegado',csp_real:true,prenda_blob:true,violaciones_csp:violaciones.length,generacion_ms:generacionMs};
 await writeFile(resolve(salida,`${nombreSalida}.json`),JSON.stringify(evidencia,null,2)+'\n');
 console.log(JSON.stringify(evidencia));
 await contexto.close();
} finally {
 await navegador.close();
 if (identificador) await fetch('http://127.0.0.1:18000/api/v1/probador/trabajos/'+identificador,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
}
