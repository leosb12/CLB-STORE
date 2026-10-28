import {test,expect} from "@playwright/test";
import {fileURLToPath} from "node:url";
import {writeFileSync} from "node:fs";

// Estas pruebas verifican la inferencia TensorFlow local y su funcionamiento sin red.
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('clb_probador_modo', 'local')); });

test("ingesta real, publicación, blobs offline y estabilidad de cámara diez minutos",async ({page,context}) => {
  const token=process.env["CLB_E2E_TOKEN"]!,id=process.env["CLB_E2E_PRODUCTO"]!;
  const color=process.env["CLB_E2E_COLOR"]??"Rojo";
  if (!token || !id) throw new Error("Ejecutar mediante infraestructura/demostraciones/probar-ingesta-fotografica.py");
  const profile=JSON.parse(Buffer.from(token.split(".")[1]!,"base64url").toString("utf8"));
  await page.addInitScript(({token,profile}) => {
    localStorage.setItem('clb_probador_material','false'); // Esta suite conserva la regresión del renderer por regiones.
    localStorage.setItem("oidc.user:http://127.0.0.1:18000/identidad/realms/clb:clb-web",JSON.stringify({
      access_token:token,token_type:"Bearer",scope:"openid profile",profile,expires_at:profile.exp}));
  },{token,profile});
  const csp:string[]=[];
  page.on("console",m => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
  await page.goto("/administracion/productos");
  await page.getByRole("button",{name:"Editar Polera de prueba de ingesta"}).click();
  const panel=page.locator("clb-panel-fotografia");
  await expect(panel.locator('input[type="file"]')).toBeEnabled();
  await expect(panel).toContainText("Polera de prueba de ingesta");
  const separacion = await panel.locator('.campos-fotografia').evaluate(e => parseFloat(getComputedStyle(e).rowGap));
  expect(separacion).toBeGreaterThanOrEqual(12);
  await panel.screenshot({path:"test-results-recursos/panel-escritorio.png"});
  await page.setViewportSize({width:390,height:844});
  await panel.screenshot({path:"test-results-recursos/panel-movil.png"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1360,height:1000});
  await panel.locator('input[type="file"]').setInputFiles({name:"nota.txt",mimeType:"text/plain",buffer:Buffer.from("archivo incompatible")});
  await expect(panel.getByRole("alert")).toContainText("Selecciona JPEG o PNG");
  await expect(panel.getByRole("button",{name:"Preparar fotografía",exact:true})).toBeDisabled();
  await panel.locator('input[type="file"]').setInputFiles(process.env["CLB_E2E_PRENDA"]??fileURLToPath(new URL("../../../../compartido/prendas/validacion/valida-01.png",import.meta.url)));
  await panel.getByLabel("Color representado").fill(color);
  await panel.getByRole("button",{name:"Preparar fotografía",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Publicar fotografía",exact:true})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Reintentar envío",exact:true})).toHaveCount(0);
  await expect.poll(()=>panel.locator("img").evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);
  await page.screenshot({path:"test-results-recursos/previsualizacion.png",fullPage:true});
  await panel.getByRole("button",{name:"Publicar fotografía",exact:true}).click();
  await expect(panel.getByRole("status").filter({hasText:"Fotografía publicada"})).toBeVisible();
  await expect(page.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await page.goto(`/productos/${id}?talla=M&color=${encodeURIComponent(color)}`);
  await expect(page.locator(".imagen-detalle img")).toHaveAttribute("src",/^blob:/);
  await expect(page.getByLabel("Talla y color").locator("option:checked")).toContainText(color);
  await page.getByRole("link",{name:"Probar virtualmente"}).click();
  const visor=page.locator("clb-probador");
  await expect(visor.getByRole("button",{name:"Subir foto",exact:true})).toBeEnabled();
  const persona=fileURLToPath(new URL("../../../probador-virtual/pruebas/fixtures/persona.jpg",import.meta.url));
  const enviados:string[]=[];
  page.on("request",r => { if (r.method()==="POST") enviados.push(r.url()); });
  await visor.locator('input[type="file"]').setInputFiles(persona);
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await expect(visor.locator('canvas')).toHaveAttribute('data-render','articulado');
  await visor.locator('canvas').screenshot({path:'test-results-recursos/malla-antes-validacion.png'});
  console.log('Regiones visibles:',await visor.locator('canvas').evaluate(e=>({...e.dataset})));
  const visibles=Number(await visor.locator('canvas').getAttribute('data-codos-visibles'));
  expect(visibles).toBeGreaterThan(0);
  await expect(visor.locator('canvas')).toHaveAttribute('data-codos',String(visibles));
  if(visibles<2)await expect(visor.locator('.estado')).toContainText('Ajuste de mangas parcial');
  // Mismo retrato público, encuadre de torso: ambos codos tienen resolución suficiente.
  const torso=fileURLToPath(new URL('../../../probador-virtual/pruebas/fixtures/persona-torso.jpg',import.meta.url));
  // Ver ambos codos no garantiza que la foto de producto admita una malla segura.
  // El dominio debe conservar una manga antes que invertir triángulos.
  const comprobarMangas=async()=>{
    await expect(visor.locator('canvas')).toHaveAttribute('data-codos-visibles','2');
    await expect(visor.locator('canvas')).toHaveAttribute('data-codos',/^[12]$/);
    const articulados=Number(await visor.locator('canvas').getAttribute('data-codos'));
    await expect(visor.locator('.estado')).toContainText(articulados===2?'Torso y mangas adaptados':'Ajuste de mangas parcial');
  };
  await visor.locator('input[type="file"]').setInputFiles(torso);
  await expect(visor.locator('canvas')).toHaveAttribute('width','538');
  await comprobarMangas();
  await expect(visor.locator('canvas')).toHaveAttribute('data-opacidad','1');
  await expect(visor.locator('.estado')).toContainText('Confianza de la pose');
  await visor.locator('canvas').screenshot({path:'test-results-recursos/malla-torso.png'});
  await expect(visor.locator('.estado')).toContainText('Confianza de la pose');
  await context.setOffline(true);
  await page.reload();
  await expect(visor.getByRole("button",{name:"Subir foto",exact:true})).toBeEnabled();
  await visor.locator('input[type="file"]').setInputFiles(torso);
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await expect(visor.locator('canvas')).toHaveAttribute('data-render','articulado');
  await comprobarMangas();
  await expect(visor.locator('canvas')).toHaveAttribute('data-opacidad','1');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"test-results-recursos/probador-dinamico-offline.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(enviados).toEqual([]);
  await page.setViewportSize({width:1360,height:1000});
  // Rollback local y comparación del mismo encuadre, sin modificar datos del producto.
  await page.evaluate(()=>localStorage.setItem('clb_probador_regiones','false'));
  await page.reload();
  await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();
  await visor.locator('input[type="file"]').setInputFiles(torso);
  await expect(visor.locator('canvas')).toHaveAttribute('data-render','afin');
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await expect(visor.locator('canvas')).toHaveAttribute('data-opacidad','1');
  await visor.locator('canvas').screenshot({path:'test-results-recursos/afin-torso.png'});
  await page.evaluate(()=>localStorage.removeItem('clb_probador_regiones'));
  await page.reload();
  await expect(visor.getByRole('button',{name:'Subir foto',exact:true})).toBeEnabled();
  await visor.locator('input[type="file"]').setInputFiles(torso);
  await comprobarMangas();
  if (process.env["CLB_E2E_OMITIR_ESTABILIDAD"] === "1") {
    console.log("Ensayo focalizado: estabilidad de cámara omitida; queda pendiente para esta malla.");
    return;
  }
  await page.setViewportSize({width:1360,height:1000});
  // La cámara continúa completamente sin red. Mide tensores del mismo módulo que ejecuta MoveNet.
  await visor.getByRole("button",{name:"Cámara",exact:true}).click();
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  const muestra=()=>page.evaluate(async()=>{
    // @ts-expect-error import de módulo servido por el stack de prueba, no dependencia del shell
    const modulo=await import("/probador/probador.js");
    return modulo.diagnosticoMemoria() as {tensores:number;bytes:number;backend:string;inexacta:boolean};
  });
  await page.waitForTimeout(15_000);
  const muestras=[await muestra()];
  for (let i=0;i<20;i++) { await page.waitForTimeout(30_000); muestras.push(await muestra()); }
  writeFileSync("test-results-recursos/memoria-diez-minutos.json",JSON.stringify({duracion_segundos:600,muestras},null,2));
  const numeros=muestras.map(m=>m.tensores);
  expect(Math.max(...numeros)-Math.min(...numeros)).toBeLessThanOrEqual(4);
  expect(muestras.at(-1)!.bytes-muestras[0]!.bytes).toBeLessThanOrEqual(192*192*3*4*4);
  await visor.getByRole("button",{name:"Apagar cámara",exact:true}).click();
  expect(csp).toEqual([]);
  expect(enviados).toEqual([]);
});
