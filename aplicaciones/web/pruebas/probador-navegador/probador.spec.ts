import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const foto = fileURLToPath(new URL("../../../probador-virtual/pruebas/fixtures/persona.jpg", import.meta.url));
const capturas = (nombre: string) => fileURLToPath(new URL(`../../test-results-probador/${nombre}.png`, import.meta.url));

/** Cantidad de respuestas guardadas por los data groups del probador en el Service Worker de Angular. */
async function guardadosDelProbador(página: Page): Promise<number> {
  return página.evaluate(async () => {
    let total = 0;
    for (const nombre of await caches.keys())
      if (nombre.includes("clb-probador")) total += (await (await caches.open(nombre)).keys()).length;
    return total;
  });
}

async function probarConFoto(página: Page): Promise<void> {
  const probador = página.locator("clb-probador");
  await probador.locator('input[type="file"]').setInputFiles(foto);
  await expect(probador.locator('.estado[data-estado="ajustada"]')).toBeVisible();
  await probador.getByLabel("Altura (cm)").fill("168");
  await probador.getByLabel("Peso (kg)").fill("66");
  await probador.getByLabel("Contorno de pecho (cm)").fill("95");
  await probador.getByLabel("Contorno de cintura (cm)").fill("80");
  await probador.getByRole("button", { name: "Calcular mi talla" }).click();
  // Mismo perfil que el fixture de equivalencia con IA: M con 73 %.
  await expect(probador.locator(".resultado")).toHaveAttribute("data-talla", "M");
}

// Estas pruebas verifican la inferencia TensorFlow local y su funcionamiento sin red.
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('clb_probador_modo', 'local')); });

test("probador dentro del shell: pose con TF.js, talla offline, sin subir la imagen y sin conexión", async ({ page, context, request }) => {
  const violacionesCsp: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && violacionesCsp.push(m.text()));
  const salientes: { método: string; url: string; cuerpo: number }[] = [];
  page.on("request", (r) => salientes.push({ método: r.method(), url: r.url(), cuerpo: r.postDataBuffer()?.length ?? 0 }));

  const { productos } = await (await request.get("/api/v1/productos?límite=100")).json();
  const polera = productos.find((p: { nombre: string }) => p.nombre === "Polera básica de algodón") ?? productos[0];

  // Primera visita con red: el shell registra el Service Worker y precarga el probador (código + MoveNet) y el modelo de tallas.
  await page.goto("/catalogo");
  await expect(page.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => guardadosDelProbador(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(5);

  await page.goto(`/productos/${polera.identificador}`);
  await page.getByRole("link", { name: "Probar virtualmente" }).click();
  await expect(page).toHaveURL(new RegExp(`/productos/${polera.identificador}/probador$`));
  await expect(page.locator(".encabezado")).toBeVisible(); // dentro del shell, con su navegación
  salientes.length = 0;
  await probarConFoto(page);
  await expect(page.locator("clb-probador [data-modelos]")).toContainText("MoveNet SinglePose Lightning v4");
  await page.screenshot({ path: capturas("probador-en-linea"), fullPage: true });

  // La foto nunca sale del navegador: solo GET sin cuerpo mientras se prueba.
  expect(salientes.filter((s) => s.método !== "GET" || s.cuerpo > 0)).toEqual([]);

  await expect(page.locator(".salida-probador")).toContainText("talla M");
  const registro = await page.evaluate(() => JSON.parse(localStorage.getItem("clb_probador_registro") ?? "[]"));
  expect(registro.length).toBeGreaterThanOrEqual(2);
  expect(registro[0].modelos.pose).toContain("MoveNet");
  expect(registro[0].modelos.tallas.versión).toBe(1);
  expect(registro[0].tallaCalculada).toBe(true);
  // Ni imagen, ni medidas, ni la talla con sus probabilidades (en un equipo compartido revelarían la complexión).
  expect(JSON.stringify(registro)).not.toMatch(/data:image|blob:|altura_cm|probabilidades|"talla"/);

  // Despliegue independiente: con el contenedor del probador detenido, el shell lo abre desde la copia del Service Worker.
  execFileSync("docker", ["stop", "clb_frontend_probador_react"]);
  try {
    await page.reload();
    await expect(page.locator("clb-probador .título")).toHaveText("Probador virtual");
    await expect(page.locator("clb-probador .estado")).toContainText("Elige una foto");
  } finally {
    execFileSync("docker", ["start", "clb_frontend_probador_react"]);
  }

  // Sin conexión: el shell, el microfrontend, MoveNet y el modelo de tallas salen del dispositivo.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("clb-probador .título")).toHaveText("Probador virtual");
  await probarConFoto(page);
  await expect(page.locator("clb-probador [data-modelos]")).toContainText("guardado");
  await page.screenshot({ path: capturas("probador-sin-conexion"), fullPage: true });
  await context.setOffline(false);

  // «Elegir talla M» vuelve al detalle con la talla preseleccionada (si la prenda tiene esa talla).
  await page.locator(".salida-probador a").click();
  await expect(page).toHaveURL(/[?&]talla=M\b/);
  expect(violacionesCsp).toEqual([]);
});
