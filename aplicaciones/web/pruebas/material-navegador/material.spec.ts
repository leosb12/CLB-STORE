import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';

// Estas pruebas verifican la inferencia TensorFlow local y su funcionamiento sin red.
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('clb_probador_modo', 'local')); });

test('material real: producto existente, foto local, recarga offline, rollback y recursos liberados',async({page,context,request})=>{
 const respuesta=await request.get('/api/v1/productos');expect(respuesta.ok()).toBe(true);
 const {productos}=await respuesta.json();
 const producto=productos.find((p:Record<string,unknown>)=>Array.isArray((p.recurso_probador as {anclas?:{estampados?:unknown}}|undefined)?.anclas?.estampados)&&String(p['categoría']).toLowerCase().includes('polera'));
 expect(producto,'Se necesita una polera publicada; el test nunca crea ni modifica productos').toBeTruthy();
 const enviados:string[]=[],csp:string[]=[],remotos:string[]=[];
 page.on('request',r=>{if(r.method()==='POST')enviados.push(r.url());const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.hostname!=='127.0.0.1')remotos.push(r.url());});
 page.on('console',m=>{if(/Content Security Policy|Refused to/.test(m.text()))csp.push(m.text());});
 await page.goto('/');
 await expect(page.locator('.barra-sincronización')).toContainText('Catálogo actualizado');
 await page.goto(`/productos/${producto.identificador}`);
 await page.getByRole('link',{name:'Probar virtualmente'}).click();
 const visor=page.locator('clb-probador'),selector=visor.getByRole('checkbox',{name:/Aplicar tejido/});
 await expect(selector).toBeChecked();
 await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();
 const foto=fileURLToPath(new URL('../../../../investigacion/probador-realismo/fixtures/persona-base.jpg',import.meta.url));
 const subir=async()=>{await visor.locator('input[type=file]').setInputFiles(foto);await expect(visor.locator('canvas')).toHaveAttribute('data-render','material');await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();await expect(visor.locator('.estado')).toContainText('Tejido aplicado');};
 await subir();
 await visor.locator('canvas').screenshot({path:'test-results-material/material-real.png'});
 await expect.poll(()=>page.evaluate(async()=>{const keys=await caches.keys();for(const key of keys){if(await(await caches.open(key)).match(new URL('/probador/modelos/selfie-multiclass-1/pesos.bin',location.origin)))return true;}return false;})).toBe(true);
 await context.setOffline(true);
 await page.reload();await expect(selector).toBeChecked();
 await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();await subir();
 const memoria=async()=>page.evaluate(async()=>{const m=await import('/probador/probador.js');return m.diagnosticoMemoria();});
 const muestras=[await memoria()];
 for(let i=0;i<2;i++){await subir();muestras.push(await memoria());}
 await selector.uncheck();await expect(visor.locator('canvas')).toHaveAttribute('data-render','articulado');
 await selector.check();await expect(visor.locator('canvas')).toHaveAttribute('data-render','material');
 await visor.getByRole('checkbox',{name:'Mostrar los puntos que detecta la IA'}).check();await expect(visor.locator('canvas')).toHaveAttribute('data-render','material');
 await visor.getByRole('checkbox',{name:'Mostrar los puntos que detecta la IA'}).uncheck();
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const captura=await visor.getByRole('button',{name:'Subir foto',exact:true}).boundingBox(),imagen=await visor.locator('canvas').boundingBox();
 expect(captura&&imagen&&captura.y+captura.height<imagen.y,'La captura debe aparecer antes del visor en móvil').toBe(true);
 await page.screenshot({path:'test-results-material/material-movil-offline.png',fullPage:true});
 // Desmontar libera constantes de la red; MoveNet conserva su caché de sesión.
 await page.getByRole('link',{name:'Volver a la prenda'}).click();
 await expect.poll(async()=>(await memoria()).tensores).toBeLessThan(200);
 const final=await memoria();
 expect(Math.max(...muestras.map(m=>m.tensores))-Math.min(...muestras.map(m=>m.tensores))).toBeLessThanOrEqual(2);
 expect(enviados).toEqual([]);expect(csp).toEqual([]);expect(remotos).toEqual([]);
 writeFileSync('test-results-material/memoria.json',JSON.stringify({muestras,final,offline:true,fotos_transmitidas:enviados.length,peticiones_publicas:remotos.length},null,2));
});

test('material rechaza pesos manipulados y deja visible la fotografía sin transferir',async({page,context,request})=>{
 const r=await request.get('/api/v1/productos'),{productos}=await r.json();
 const producto=productos.find((p:Record<string,unknown>)=>Array.isArray((p.recurso_probador as {anclas?:{estampados?:unknown}}|undefined)?.anclas?.estampados)&&String(p['categoría']).toLowerCase().includes('polera'));
 expect(producto).toBeTruthy();
 await context.route('**/probador/modelos/selfie-multiclass-1/pesos.bin',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from('pesos alterados')}));
 await page.goto('/');await expect(page.locator('.barra-sincronización')).toContainText('Catálogo actualizado');
 await page.goto(`/productos/${producto.identificador}`);await page.getByRole('link',{name:'Probar virtualmente'}).click();
 const visor=page.locator('clb-probador');await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();
 await visor.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../../../investigacion/probador-realismo/fixtures/persona-base.jpg',import.meta.url)));
 await expect(visor.getByRole('alert')).toContainText('integridad');
 await expect(visor.locator('canvas')).not.toHaveAttribute('data-render','material');
 await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();
});


test('fotos privadas opcionales: cuatro entradas reales, mismo motor y ninguna transmisión',async({page,context,request})=>{
 const carpeta=process.env.CLB_FOTOS_PRIVADAS;
 test.skip(!carpeta,'Ensayo personal opcional; las fotos no se versionan');
 const raiz=resolve('../../temporales')+sep,origen=resolve(carpeta!);
 expect(origen.startsWith(raiz),'Las fotos personales deben permanecer bajo temporales').toBe(true);
 const r=await request.get('/api/v1/productos'),{productos}=await r.json();
 const producto=productos.find((p:Record<string,unknown>)=>Array.isArray((p.recurso_probador as {anclas?:{estampados?:unknown}}|undefined)?.anclas?.estampados)&&String(p['categoría']).toLowerCase().includes('polera'));
 expect(producto).toBeTruthy();
 const enviados:string[]=[];page.on('request',r=>{if(r.method()==='POST')enviados.push(r.url());});
 await page.goto('/');await expect(page.locator('.barra-sincronización')).toContainText('Catálogo actualizado');
 await page.goto(`/productos/${producto.identificador}`);await page.getByRole('link',{name:'Probar virtualmente'}).click();
 const visor=page.locator('clb-probador'),boton=visor.getByRole('button',{name:'Subir foto',exact:true});
 await expect(boton).toBeEnabled();await context.setOffline(true);
 const resultados=new Set<string>();
 for(let i=1;i<=4;i++){
  await visor.locator('input[type=file]').setInputFiles(resolve(origen,`${i}.png`));
  await expect(boton).toBeDisabled();await expect(boton).toBeEnabled();
  await expect(visor.locator('canvas')).toHaveAttribute('data-render','material');
  await expect(visor.locator('.estado')).toContainText('Tejido aplicado');
  resultados.add(await visor.locator('canvas').evaluate((e:HTMLCanvasElement)=>e.toDataURL()));
  await visor.locator('canvas').screenshot({path:`test-results-material/privada-${i}.png`});
 }
 expect(resultados.size).toBe(4);expect(enviados).toEqual([]);
});
