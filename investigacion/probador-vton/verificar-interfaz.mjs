// QA del bundle real. No simula CatVTON: comprueba UI, consentimiento y rechazo sin sesión.
import {createServer, request as solicitarHttp} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(raiz, 'aplicaciones/web/package.json'));
const {chromium} = require('@playwright/test');
const dist = resolve(raiz, 'aplicaciones/probador-virtual/dist');
const salida = resolve(raiz, 'investigacion/probador-vton/temporales');
const seguridad = await readFile(resolve(raiz, 'aplicaciones/web/infraestructura/cabeceras-seguridad.conf'), 'utf8');
const csp = seguridad.match(/add_header Content-Security-Policy "([^"]+)"/)[1];
await mkdir(salida, {recursive: true});
let envios = 0;
const generar = process.argv.includes('--generar');
let credenciales, sinConexion = false;
function sesionReal() {
  if (!credenciales || (!sinConexion && credenciales.vence < Date.now()/1000 + 30)) {
    const token = execFileSync('python', ['-c', "import runpy; a=runpy.run_path('infraestructura/demostraciones/demo-gestion-ia.py'); print(a['token']('cliente.demo','CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO'))"], {cwd:raiz, encoding:'utf8'}).trim();
    const datos = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    credenciales = {token, titular:datos.sub, vence:datos.exp};
  }
  return {titular:credenciales.titular, cabeceras:sinConexion ? {} : {Authorization:'Bearer '+credenciales.token}};
}
const servidor = createServer(async (peticion, respuesta) => {
  if (peticion.method === 'POST') envios++;
  const ruta = new URL(peticion.url, 'http://localhost').pathname;
  if (ruta === '/inicializar.js') {
    respuesta.setHeader('Content-Type', 'text/javascript');
    respuesta.end(`import '/probador.js';document.querySelector('clb-probador').prenda={identificador:'qa',sku:'CLB-FOTO-POL-GRI',nombre:'Polera gris',categoría:'Poleras',imagen:'/ropa.png',tallas:['S','M','L']};`);
    return;
  }
  if (generar && ruta.startsWith('/api/v1/probador/')) {
    const remota = solicitarHttp({hostname:'127.0.0.1',port:18000,path:peticion.url,method:peticion.method,headers:peticion.headers}, origen => {
      respuesta.writeHead(origen.statusCode, origen.headers); origen.pipe(respuesta);
    });
    remota.on('error', () => {respuesta.writeHead(503, {'Content-Type':'application/json'}); respuesta.end(JSON.stringify({mensaje:'Pasarela no disponible'}));});
    peticion.pipe(remota);
    return;
  }
  if (ruta === '/') {
    respuesta.setHeader('Content-Security-Policy', csp);
    respuesta.setHeader('Content-Type', 'text/html; charset=utf-8');
    respuesta.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CLB QA VTON</title><style>body{font:16px/1.5 Arial;margin:24px;color:#243d2d;background:#fbfcf8}main{max-width:1200px;margin:auto}</style><main><h1>CLB Store</h1><clb-probador></clb-probador></main><script type="module" src="/inicializar.js"></script></html>`);
    return;
  }
  const archivo = ruta === '/ropa.png' ? resolve(raiz, 'compartido/prendas/originales/'+(generar ? 'polera-roja.png' : 'polera-gris.png')) : resolve(dist, '.' + decodeURIComponent(ruta));
  if (ruta !== '/ropa.png' && !archivo.startsWith(dist + sep)) { respuesta.writeHead(404); respuesta.end(); return; }
  try {
    const datos = await readFile(archivo);
    respuesta.setHeader('Content-Type', {'.js':'text/javascript','.json':'application/json','.png':'image/png','.bin':'application/octet-stream'}[extname(archivo)] || 'application/octet-stream');
    respuesta.end(datos);
  } catch { respuesta.writeHead(404); respuesta.end(); }
});
await new Promise(resolver => servidor.listen(14351, '127.0.0.1', resolver));
const navegador = await chromium.launch({headless: true, channel: 'chrome'});
try {
  if (generar) {
    const fuente = await readFile(resolve(raiz, 'aplicaciones/probador-virtual/fuente/adaptadores/probador-fotografico-rest.ts'), 'utf8');
    const version = fuente.match(/const VERSION = '([^']+)'/)[1];
    const salud = await (await fetch('http://127.0.0.1:18000/salud/probador')).json();
    if (salud.version_motor !== version) throw new Error('Desplegar la versión del motor correspondiente al cliente antes de probar generación.');
    const contexto = await navegador.newContext({viewport:{width:1360,height:1000}});
    const pagina = await contexto.newPage();
    let identificador;
    pagina.on('response', async respuesta => {
      if (respuesta.url().endsWith('/api/v1/probador/trabajos') && respuesta.request().method() === 'POST' && respuesta.ok()) identificador = (await respuesta.json()).identificador;
    });
    await pagina.exposeFunction('sesionDePrueba', sesionReal);
    await pagina.goto('http://127.0.0.1:14351');
    await pagina.getByRole('heading', {name:'Pruébatela en tu fotografía'}).waitFor();
    await pagina.evaluate(async () => {
      const elemento = document.querySelector('clb-probador');
      const foto = await (await fetch('/ropa.png')).blob();
      elemento.prenda = {...elemento.prenda, nombre:'Polera roja', imagen:URL.createObjectURL(foto)};
      elemento.sesionProbador = () => window.sesionDePrueba();
    });
    const foto = resolve(raiz, 'investigacion/probador-realismo/fixtures/persona-base.jpg');
    await pagina.locator('input[type=file]').setInputFiles(foto);
    await pagina.getByRole('button',{name:'Generar imagen',exact:true}).click();
    const resultado = pagina.getByRole('img',{name:/generada con IA/});
    const error = pagina.getByRole('alert');
    await Promise.race([resultado.waitFor({timeout:720000}), error.waitFor({timeout:720000}).then(async () => {throw new Error(await error.textContent());})]);
    await pagina.screenshot({path:resolve(salida,'generacion-real.png'),fullPage:true});
    const solicitudes = envios;
    sinConexion = true;
    await contexto.setOffline(true);
    await pagina.locator('input[type=file]').setInputFiles([]);
    await pagina.locator('input[type=file]').setInputFiles(foto);
    const inicio = Date.now();
    await pagina.getByRole('button',{name:'Generar imagen',exact:true}).click();
    await resultado.waitFor();
    await pagina.getByRole('status').filter({hasText:'Resultado guardado'}).waitFor();
    if (envios !== solicitudes) throw new Error('La recuperación offline intentó generar de nuevo');
    await pagina.screenshot({path:resolve(salida,'generacion-offline.png'),fullPage:true});
    const offlineMs = Date.now()-inicio;
    sinConexion = false;
    await contexto.setOffline(false);
    await pagina.getByRole('button', {name:'Borrar imágenes locales', exact:true}).click();
    await pagina.getByRole('status').filter({hasText:'Se borraron las imágenes locales'}).waitFor();
    if (await resultado.count()) throw new Error('El borrado conservó la imagen visible');
    const consulta = await fetch('http://127.0.0.1:18000/api/v1/probador/trabajos/'+identificador, {headers:sesionReal().cabeceras});
    if (consulta.status !== 404) throw new Error('El borrado local no invalidó el resultado del servidor');
    const regenerar = Date.now();
    await pagina.getByRole('button',{name:'Generar imagen',exact:true}).click();
    await Promise.race([resultado.waitFor({timeout:720000}), error.waitFor({timeout:720000}).then(async () => {throw new Error(await error.textContent());})]);
    if (envios !== solicitudes + 1) throw new Error('La regeneración no envió una solicitud nueva');
    const evidencia = {csp_produccion:true, prenda_blob:true, offline_ms:offlineMs, borrado_remoto_http:consulta.status, regeneracion_ms:Date.now()-regenerar, solicitudes_post:envios};
    await writeFile(resolve(salida,'auditoria-web.json'), JSON.stringify(evidencia,null,2)+'\n');
    console.log(JSON.stringify(evidencia));
    await contexto.close();
  } else {
  for (const [nombre, ancho] of [['escritorio',1360], ['movil',390]]) {
    const pagina = await navegador.newPage({viewport:{width:ancho,height:1000}});
    pagina.on('pageerror', error => console.log('Error de página:', error.message));
    pagina.on('console', mensaje => {if (mensaje.type() === 'error') console.log('Consola:', mensaje.text().slice(0,300));});
    await pagina.goto('http://127.0.0.1:14351');
    await pagina.getByRole('heading', {name:'Pruébatela en tu fotografía'}).waitFor();
    await pagina.getByText('Al pulsar «Generar imagen»', {exact:false}).waitFor();
    await pagina.locator('input[type=file]').setInputFiles(resolve(raiz,'aplicaciones/probador-virtual/pruebas/fixtures/persona.jpg'));
    await pagina.getByRole('button',{name:'Generar imagen',exact:true}).click();
    await pagina.getByRole('alert').filter({hasText:'Inicia sesión'}).waitFor();
    if (await pagina.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Desbordamiento horizontal en '+nombre);
    await pagina.screenshot({path:resolve(salida,nombre+'.png'),fullPage:true});
    await pagina.close();
  }
  if (envios !== 0) throw new Error('Se envió una imagen sin sesión');
  console.log('QA visual escritorio/móvil: sin desbordamiento; foto sin sesión rechazada sin POST. Capturas en '+salida);
  }
} finally { await navegador.close(); servidor.close(); }
