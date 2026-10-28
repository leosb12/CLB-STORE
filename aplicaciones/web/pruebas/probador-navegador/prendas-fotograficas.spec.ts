import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

const foto = fileURLToPath(new URL("../../../probador-virtual/pruebas/fixtures/persona.jpg", import.meta.url));

// Estas pruebas verifican la inferencia TensorFlow local y su funcionamiento sin red.
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('clb_probador_modo', 'local')); });

test("colección fotográfica real: catálogo y probador con fotos empaquetadas también offline", async ({ page, context, request }) => {
  const { productos } = await (await request.get("/api/v1/productos?límite=100")).json();
  const prendas = productos.filter((p: { sku: string }) => p.sku.startsWith("CLB-FOTO-"));
  expect(prendas).toHaveLength(6);
  const prenda = prendas.find((p: { sku: string }) => p.sku === "CLB-FOTO-POL-GRI");
  const externos: string[] = [], erroresCsp: string[] = [];
  page.on("request", r => { if (!r.url().startsWith("http://127.0.0.1:") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) externos.push(r.url()); });
  page.on("console", m => { if (/Content Security Policy|Refused to/.test(m.text())) erroresCsp.push(m.text()); });
  await page.goto("/catalogo?fotos=1");
  await expect(page.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await expect(page.getByRole('checkbox', { name: 'Mostrar solo prendas con fotografía' })).toBeChecked();
  await expect(page.locator('.etiqueta-imagen').filter({ hasText: /^Fotografía$/ })).toHaveCount(6);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    for (const nombre of await caches.keys()) {
      const cache = await caches.open(nombre);
      if (await cache.match('/prendas/polera-gris.svg')) return true;
    }
    return false;
  })).toBe(true);
  await page.screenshot({ path: "test-results-probador/catalogo-fotografico.png", fullPage: true });
  await page.goto(`/productos/${prenda.identificador}`);
  await expect(page.locator('.imagen-detalle img')).toHaveAttribute('src', /^(blob:|\/prendas\/polera-gris\.png)/);
  await page.getByRole('link', { name: 'Probar virtualmente' }).click();
  const visor = page.locator('clb-probador');
  await expect(visor.locator('.espejo-vacío img')).toHaveAttribute('src', /^(blob:|\/prendas\/polera-gris\.svg)/);
  await expect(visor.getByRole('button', { name: 'Subir foto' })).toBeEnabled();
  await visor.locator('input[type="file"]').setInputFiles(foto);
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await page.screenshot({ path: 'test-results-probador/probador-fotografico.png', fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await expect(visor.getByRole('button', { name: 'Subir foto' })).toBeEnabled();
  await visor.locator('input[type="file"]').setInputFiles(foto);
  await expect(visor.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results-probador/probador-fotografico-movil.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(externos).toEqual([]);
  expect(erroresCsp).toEqual([]);
});
