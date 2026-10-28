import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Cola fotográfica durable contra el stack real con el worker CatVTON (perfil `vton`) y Keycloak.
// Usa la cuenta `cliente.demo` con una foto única por ejecución (fuerza una generación real) y borra al final solo los
// trabajos que creó. Requiere GPU y el CLI de Docker.
const raiz = fileURLToPath(new URL("../../../../", import.meta.url));
// Bytes tras el marcador EOI: la imagen se decodifica igual pero su huella (y la clave de idempotencia) es nueva.
const foto = () => ({ name: "persona.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([readFileSync(fileURLToPath(new URL("../../../probador-virtual/pruebas/fixtures/persona.jpg", import.meta.url))), randomBytes(16)]) });
const creados = new Set<string>();
const API = "http://127.0.0.1:18000";

test.describe.configure({ timeout: 900_000 });

const token = () =>
  execFileSync("python", ["-c", "import runpy; a=runpy.run_path('infraestructura/demostraciones/demo-gestion-ia.py'); print(a['token']('cliente.demo','CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO'))"], { cwd: raiz, encoding: "utf8" }).trim();

async function abrir(page: Page, sku: string) {
  const { productos } = await (await page.request.get(`${API}/api/v1/productos?límite=100`)).json();
  const prenda = productos.find((p: { sku: string }) => p.sku === sku);
  expect(prenda, `falta la prenda ${sku}`).toBeTruthy();
  await page.goto(`/productos/${prenda.identificador}/probador`);
  return prenda.identificador as string;
}

/** La sesión SSO del shell se reemplaza por el token de la cuenta de demostración, igual que en `verificar-shell.mjs`. */
async function conSesion(page: Page, acceso: string) {
  await page.getByRole("heading", { name: "Tu fotografía con IA" }).waitFor();
  const titular = JSON.parse(Buffer.from(acceso.split(".")[1]!, "base64url").toString()).sub;
  await page.evaluate((credenciales) => {
    (document.querySelector("clb-probador") as unknown as { sesionProbador: () => Promise<unknown> }).sesionProbador = async () => credenciales;
  }, { titular, cabeceras: { Authorization: "Bearer " + acceso } });
}

const solicitud = (page: Page) => page.locator("clb-probador").locator("li.solicitud").first();

test.beforeEach(async ({ page }) => {
  page.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/api/v1/probador/trabajos") && r.ok()) creados.add((await r.json()).identificador);
  });
  await page.addInitScript(() => localStorage.setItem("clb_probador_modo", "fotografico"));
});

test.afterEach(async ({ request }) => {
  const cabeceras = { Authorization: "Bearer " + token() };
  for (const clave of creados) expect([204, 404]).toContain((await request.delete(`${API}/api/v1/probador/trabajos/${clave}`, { headers: cabeceras })).status());
  creados.clear();
});

test("sin red la foto queda guardada, sobrevive a recargar y se genera con un solo envío al volver la conexión", async ({ page, context }) => {
  const acceso = token();
  const envios: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/v1/probador/trabajos")) envios.push(r.url()); });
  await abrir(page, "CLB-FOTO-POL-ROJ");
  await expect(page.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await conSesion(page, acceso);
  await context.setOffline(true);
  const visor = page.locator("clb-probador");
  await visor.locator('input[type="file"]').setInputFiles(foto());
  await visor.getByRole("button", { name: "Generar imagen", exact: true }).click();
  await expect(solicitud(page)).toHaveAttribute("data-estado", "PENDIENTE");
  await expect(visor.getByRole("status").first()).toContainText(/guardada en este dispositivo/i);

  await page.reload();
  await conSesion(page, acceso);
  await expect(solicitud(page)).toHaveAttribute("data-estado", "PENDIENTE");
  expect(envios).toHaveLength(0);

  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(solicitud(page)).toHaveAttribute("data-estado", "LISTO", { timeout: 600_000 });
  await expect(visor.getByRole("img", { name: /generada con IA/ })).toBeVisible();
  expect(envios).toHaveLength(1);
});

test("si el worker se cae a mitad de la generación, la solicitud se reanuda sola al volver", async ({ page }) => {
  const acceso = token();
  await abrir(page, "CLB-FOTO-POL-GRI");
  await conSesion(page, acceso);
  const visor = page.locator("clb-probador");
  await visor.locator('input[type="file"]').setInputFiles(foto());
  await visor.getByRole("button", { name: "Generar imagen", exact: true }).click();
  await expect(solicitud(page).locator("strong")).toHaveText(/Generando con IA|En cola en CLB/, { timeout: 120_000 });
  try {
    execFileSync("docker", ["stop", "clb_worker_vton"], { stdio: "ignore" });
    // Caído: no se agota aunque la caída dure minutos (no se gastó GPU).
    await expect(solicitud(page)).toHaveAttribute("data-estado", "PENDIENTE", { timeout: 120_000 });
    await expect(solicitud(page)).toContainText(/no está disponible/);
  } finally {
    execFileSync("docker", ["start", "clb_worker_vton"], { stdio: "ignore" });
  }
  await expect(solicitud(page)).toHaveAttribute("data-estado", "LISTO", { timeout: 720_000 });
  await expect(visor.getByRole("img", { name: /generada con IA/ })).toBeVisible();
});

test("conjunto con IA: la foto se genera en dos pasadas (jean y después polera) y queda una sola imagen final", async ({ page }) => {
  const acceso = token();
  const envios: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/v1/probador/trabajos")) envios.push(r.url()); });
  await abrir(page, "CLB-FOTO-POL-ROJ");
  await conSesion(page, acceso);
  const visor = page.locator("clb-probador");
  await visor.getByRole("button", { name: "Pantalones" }).click();
  await visor.locator(".miniaturas button", { hasText: "Jean celeste recto" }).click();
  await expect(visor.getByText(/se genera en dos pasos/)).toBeVisible();
  await visor.locator('input[type="file"]').setInputFiles(foto());
  await visor.getByRole("button", { name: "Generar imagen", exact: true }).click();
  // La imagen final nombra el conjunto completo; el paso intermedio ya continuado no se lista aparte.
  await expect(visor.getByRole("img", { name: /Jean celeste recto.* \+ Polera roja.*generada con IA/ })).toBeVisible({ timeout: 600_000 });
  expect(envios).toHaveLength(2);
  await expect(visor.locator("li.solicitud")).toHaveCount(1);
  await page.screenshot({ path: "test-results-probador/conjunto-ia.png", fullPage: true });
});
