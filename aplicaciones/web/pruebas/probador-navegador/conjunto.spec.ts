import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Foto de cuerpo entero (dominio público): hombros, caderas y tobillos visibles.
const foto = fileURLToPath(new URL("../../../probador-virtual/pruebas/fixtures/persona.jpg", import.meta.url));

/** Abre el probador general (sin pasar por una prenda) y arma el conjunto polera + jean. */
async function armarConjunto(page: Page, modo: "ra" | "local") {
  await page.addInitScript((m) => localStorage.setItem("clb_probador_modo", m), modo);
  await page.goto("/probador");
  await expect(page.getByRole("link", { name: "Probador", exact: true })).toHaveClass(/actual/);
  const visor = page.locator("clb-probador");
  await expect(visor.locator(".estado")).toContainText("Elige una prenda");
  await visor.locator(".miniaturas button", { hasText: "Polera gris" }).click();
  await visor.getByRole("button", { name: "Pantalones" }).click();
  await visor.locator(".miniaturas button", { hasText: "Jean celeste recto" }).click();
  await expect(visor.locator(".ranuras li[data-zona=superior]")).toContainText("Polera gris");
  await expect(visor.locator(".ranuras li[data-zona=inferior]")).toContainText("Jean celeste recto");
  return visor;
}

test("conjunto en realidad aumentada: polera y jean a la vez sobre una foto, en el dispositivo", async ({ page }) => {
  const visor = await armarConjunto(page, "ra");
  await visor.locator(".modo-detalle input[type=file]").setInputFiles(foto);
  await expect(visor.locator(".estado")).toContainText("Prendas 3D sobre tu foto");
  await expect(visor.locator("figure.espejo figcaption")).toHaveText(/Jean celeste recto.* \+ Polera gris/);
  await expect(visor.getByRole("button", { name: "Quitar foto" })).toBeVisible();
  await page.screenshot({ path: "test-results-probador/conjunto-ra.png", fullPage: true });
  // Quitar el jean con la foto ya analizada vuelve a dibujarla sin él (sin pedir la foto de nuevo).
  const lienzo = visor.locator("figure.espejo canvas");
  const antes = await lienzo.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await visor.getByRole("button", { name: /Quitar Jean celeste recto/ }).click();
  await expect(visor.locator("figure.espejo figcaption")).toHaveText(/^Polera gris/);
  await expect.poll(() => lienzo.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(antes);
});

test("conjunto en la vista rápida: dos capas y el cuello real por encima de la prenda", async ({ page }) => {
  const visor = await armarConjunto(page, "local");
  await visor.locator(".modo-detalle input[type=file]").setInputFiles(foto);
  const lienzo = visor.locator("figure.espejo canvas");
  await expect(lienzo).toHaveAttribute("data-capas", "2");
  await expect(lienzo).toHaveAttribute("data-cuello", "original");
  // Un vestido ocupa las dos zonas: reemplaza al conjunto.
  await visor.getByRole("button", { name: "Arriba y vestidos" }).click();
  await visor.locator(".miniaturas button", { hasText: /vestido/i }).first().click();
  await expect(visor.locator(".ranuras li[data-zona=inferior]")).toContainText("Incluido en el vestido");
  await expect(lienzo).toHaveAttribute("data-capas", "1");
  await page.screenshot({ path: "test-results-probador/conjunto-local.png", fullPage: true });
});

test("contrato v1 · `modos`: el anfitrión limita los modos (Android pide solo RA) y el selector desaparece", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clb_probador_modo", "local"));
  await page.goto("/probador");
  const visor = page.locator("clb-probador");
  await visor.locator(".miniaturas button", { hasText: "Polera gris" }).click();
  await expect(visor.locator("#paso-modo")).toBeVisible();
  await visor.evaluate((el: HTMLElement & { modos: string[] | null }) => { el.modos = ["ra"]; });
  // Con un solo modo no se ofrece «Cómo probarte»; la preferencia guardada («local») ya no aplica y se usa la RA.
  await expect(visor.locator("#paso-modo")).toHaveCount(0);
  await expect(visor.locator(".probador")).toHaveAttribute("data-modo", "ra");
  await expect(visor.locator("#paso-talla .número")).toHaveText("2");
  await visor.evaluate((el: HTMLElement & { modos: string[] | null }) => { el.modos = null; });
  await expect(visor.locator("#paso-modo")).toBeVisible();
});
