import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { videoCámara } from "../../playwright.probador.config";

const video = resolve(videoCámara);
test.skip(!existsSync(video), "Se necesita ffmpeg para generar la cámara simulada.");
test.use({
  permissions: ["camera"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`] },
});

/** Guarda cada flujo de cámara entregado a la página para comprobar después que todas sus pistas terminaron. */
async function vigilarCámara(page: import("@playwright/test").Page, demoraMs = 0): Promise<void> {
  await page.addInitScript((demora) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { flujos: MediaStream[] }).flujos = [];
    navigator.mediaDevices.getUserMedia = async (restricciones) => {
      await new Promise((r) => setTimeout(r, demora));
      const flujo = await original(restricciones);
      (window as unknown as { flujos: MediaStream[] }).flujos.push(flujo);
      return flujo;
    };
  }, demoraMs);
}
const pistasVivas = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { flujos: MediaStream[] }).flujos.flatMap((f) => f.getTracks()).filter((t) => t.readyState !== "ended").length);

// Estas pruebas verifican la inferencia TensorFlow local y su funcionamiento sin red.
test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('clb_probador_modo', 'local')); });

test("cámara: el bucle de video ajusta la prenda en vivo, en espejo, y se apaga al salir", async ({ page, request }) => {
  const { productos } = await (await request.get("/api/v1/productos?límite=100")).json();
  const vestido = productos.find((p: { categoría: string }) => p["categoría"] === "Vestidos") ?? productos[0];
  await vigilarCámara(page);
  await page.goto(`/productos/${vestido.identificador}/probador`);
  const probador = page.locator("clb-probador");
  await probador.getByRole("button", { name: "Cámara", exact: true }).click();
  await expect(probador.getByRole("button", { name: "Cámara", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(probador.locator("canvas.espejado")).toBeVisible();
  await expect(probador.locator('.estado[data-estado="ajustada"]')).toContainText("Confianza de la pose:");
  await probador.getByLabel("Mostrar los puntos que detecta la IA").check();
  await page.screenshot({ path: "test-results-probador/probador-camara.png" });
  const registro = await page.evaluate(() => JSON.parse(localStorage.getItem("clb_probador_registro") ?? "[]"));
  expect(registro[0].pose.detectada).toBe(true);

  await probador.getByRole("button", { name: "Apagar cámara" }).click();
  await expect(probador.locator(".estado")).toContainText("Elige una foto");
  // Al salir del probador se desmonta el microfrontend y no queda ninguna pista de cámara activa.
  expect(await pistasVivas(page)).toBe(0);
  await probador.getByRole("button", { name: "Cámara", exact: true }).click();
  await expect(probador.locator("canvas.espejado")).toBeVisible();
  // Al salir del probador se desmonta el microfrontend y no queda ninguna pista de cámara activa.
  await page.getByRole("link", { name: "← Volver a la prenda" }).click();
  await expect(page.locator("clb-probador")).toHaveCount(0);
  await expect.poll(() => pistasVivas(page)).toBe(0);
});

test("cámara: salir mientras se pide el permiso no deja la cámara encendida", async ({ page, request }) => {
  const { productos } = await (await request.get("/api/v1/productos?límite=100")).json();
  await vigilarCámara(page, 1500);
  await page.goto(`/productos/${productos[0].identificador}/probador`);
  const cámara = page.locator("clb-probador").getByRole("button", { name: "Cámara", exact: true });
  await expect(cámara).toBeEnabled();
  await cámara.click();
  await expect(cámara).toBeDisabled(); // no se puede pedir dos veces
  await page.getByRole("link", { name: "← Volver a la prenda" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { flujos: MediaStream[] }).flujos.length), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => pistasVivas(page)).toBe(0);
});
