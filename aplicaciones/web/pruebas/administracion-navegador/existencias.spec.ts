import { test, expect, chromium, type Page, type APIRequestContext } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Producto, Operacion } from "../../fuente/catalogo/dominio/modelos";
import type { Variante } from "../../fuente/existencias/dominio/modelos";

const origen = "http://127.0.0.1:14201";
const sku = () => "CLB-F5-" + crypto.randomUUID().slice(0, 8).toUpperCase();
async function producto(solicitud: APIRequestContext): Promise<Producto> {
  const código = sku();
  const respuesta = await solicitud.post("/api/v1/productos", { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { sku: código, nombre: "Camiseta " + código, descripción: "Prueba aislada de variantes y stock", categoría: "Camisetas", precio: "0.29", activo: true } });
  expect(respuesta.status()).toBe(201); return (await respuesta.json()).producto;
}
async function variante(solicitud: APIRequestContext, producto: Producto): Promise<Variante> {
  const respuesta = await solicitud.post(`/api/v1/productos/${producto.identificador}/variantes`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { identificador: crypto.randomUUID(), sku: sku(), talla: "M", color: "Negro", activo: true } });
  expect(respuesta.status()).toBe(201); return (await respuesta.json()).variante;
}
async function entrada(solicitud: APIRequestContext, variante: Variante, cantidad = 10): Promise<Variante> {
  const respuesta = await solicitud.post(`/api/v1/variantes/${variante.identificador}/movimientos`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { tipo: "ENTRADA", cantidad, motivo: "Recepción comprobada", versión_esperada: variante.versión_sincronización } });
  expect(respuesta.status()).toBe(201); return (await respuesta.json()).variante;
}
async function abrir(página: Page, prenda: Producto): Promise<void> {
  await página.goto("/administracion/productos");
  await expect(página.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await página.getByRole("button", { name: "Variantes y stock de " + prenda.nombre, exact: true }).click();
  await expect(página.getByRole("heading", { name: "Variantes y stock", exact: true })).toBeVisible();
}
async function operaciones(página: Page): Promise<Operacion[]> {
  return página.evaluate(async () => {
    const base = await new Promise<IDBDatabase>((resolver, rechazar) => { const s = indexedDB.open("clb_catalogo"); s.onsuccess = () => resolver(s.result); s.onerror = () => rechazar(s.error); });
    const datos = await new Promise<Operacion[]>((resolver, rechazar) => { const s = base.transaction("operaciones").objectStore("operaciones").getAll(); s.onsuccess = () => resolver(s.result); s.onerror = () => rechazar(s.error); });
    base.close(); return datos;
  });
}

test("camiseta desde formulario → variante → entrada → mínimo → catálogo → carrito exacto", async ({ page, request }) => {
  const código = sku();
  await page.goto("/administracion/productos");
  await expect(page.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
  await page.getByLabel("SKU", { exact: true }).fill(código);
  await page.getByLabel("Nombre", { exact: true }).fill("Camiseta vertical " + código);
  await page.getByLabel("Categoría", { exact: true }).selectOption("Poleras");
  await page.getByLabel("Precio en BOB", { exact: true }).fill("0.29");
  await page.getByRole("button", { name: "Guardar propuesta", exact: true }).click();
  const botón = page.getByRole("button", { name: "Variantes y stock de Camiseta vertical " + código, exact: true });
  await expect(botón).toBeVisible(); await botón.click();
  const códigoVariante = sku();
  await page.getByLabel("SKU de variante", { exact: true }).fill(códigoVariante);
  await page.getByLabel("Talla", { exact: true }).fill("M");
  await page.getByLabel("Color", { exact: true }).fill("Negro");
  await page.getByRole("button", { name: "Guardar variante", exact: true }).click();
  const fila = page.locator("[data-variante]").filter({ hasText: códigoVariante });
  await expect(fila).toContainText("M / Negro");
  await fila.getByRole("button", { name: "Gestionar stock" }).click();
  await page.getByLabel("Cantidad del movimiento").fill("10");
  await page.getByLabel("Motivo del movimiento").fill("Recepción contada en almacén");
  await page.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  await expect(fila).toContainText("v2");
  await page.getByLabel("Stock mínimo", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Guardar mínimo", exact: true }).click();
  await expect(fila).toContainText("v3");
  await page.getByRole("button", { name: "Consultar historial" }).click();
  await expect(page.locator(".gestion-stock")).toContainText("Recepción contada en almacén");
  await page.screenshot({ path: "test-results-administracion/variantes-escritorio.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results-administracion/variantes-movil.png", fullPage: true });
  const lista = (await (await request.get("/api/v1/productos")).json()).productos as Producto[];
  const prenda = lista.find(p => p.sku === código)!;
  await page.goto("/productos/" + prenda.identificador);
  const opciones = page.getByLabel("Talla y color");
  await expect(opciones.locator("option")).toHaveCount(2);
  await opciones.selectOption({ label: `M / Negro · ${códigoVariante}` });
  await expect(page.locator("[data-disponibilidad]")).toContainText("10 unidades");
  await page.getByLabel("Cantidad para el carrito").fill("3");
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver carrito →" }).click();
  await expect(page.locator("[data-total-carrito]")).toHaveText("0,87 Bs");
  const variantes = (await (await request.get(`/api/v1/productos/${prenda.identificador}/variantes`)).json()).variantes;
  expect(variantes[0].reservada).toBe(0); expect(variantes[0].física).toBe(10);
});

test("variantes y carrito sobreviven cierre total del navegador, edición offline y reconexión", async ({ request }) => {
  const prenda = await producto(request), v = await entrada(request, await variante(request, prenda));
  const directorio = await mkdtemp(join(tmpdir(), "clb_prueba_stock_"));
  let contexto = await chromium.launchPersistentContext(directorio, { channel: "chrome", headless: true, baseURL: origen });
  try {
    let página = await contexto.newPage(); await página.goto("/productos/" + prenda.identificador);
    await página.getByLabel("Talla y color").selectOption(v.identificador);
    await página.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(página.getByRole("link", { name: "Ver carrito →" })).toBeVisible();
    await página.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => página.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await contexto.close();
    contexto = await chromium.launchPersistentContext(directorio, { channel: "chrome", headless: true, baseURL: origen, offline: true });
    página = await contexto.newPage(); await página.goto("/productos/" + prenda.identificador);
    await página.getByLabel("Talla y color").selectOption(v.identificador);
    await expect(página.locator(".seleccion-variante")).toContainText("las existencias pueden haber cambiado");
    await página.getByRole("link", { name: "Carrito", exact: true }).click();
    await página.getByLabel("Cantidad de " + v.sku, { exact: true }).fill("7");
    await expect(página.locator("[data-total-carrito]")).toHaveText("2,03 Bs");
    await página.reload(); await expect(página.getByLabel("Cantidad de " + v.sku)).toHaveValue("7");
    await contexto.setOffline(false);
    await expect(página.locator(".barra-sincronización")).toContainText("Catálogo actualizado");
    const actual = (await (await request.get(`/api/v1/variantes/${v.identificador}`)).json()).variante;
    expect(actual.física).toBe(10); expect(actual.reservada).toBe(0);
    await página.getByRole("button", { name: "Eliminar " + v.sku }).click();
    await expect(página.locator("[data-total-carrito]")).toHaveText("0,00 Bs");
  } finally {
    await contexto.close();
    const absoluta = resolve(directorio);
    if (!absoluta.startsWith(resolve(tmpdir()) + sep) || !absoluta.includes("clb_prueba_stock_")) throw new Error("Perfil fuera del ámbito temporal.");
    await rm(absoluta, { recursive: true, force: true });
  }
});

test("crear variante offline y movimiento dependiente: reconexión causal sin duplicados", async ({ page, request }) => {
  const prenda = await producto(request); await abrir(page, prenda);
  await page.context().setOffline(true);
  const código = sku();
  await page.getByLabel("SKU de variante", { exact: true }).fill(código); await page.getByLabel("Talla", { exact: true }).fill("L"); await page.getByLabel("Color", { exact: true }).fill("Blanco");
  await page.getByRole("button", { name: "Guardar variante", exact: true }).click();
  await page.getByRole("button", { name: "Preparar stock dependiente" }).click();
  await page.getByLabel("Cantidad del movimiento").fill("12"); await page.getByLabel("Motivo del movimiento").fill("Recepción preparada sin conexión");
  await page.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  await expect.poll(async () => (await operaciones(page)).filter(op => op.tipo === "REGISTRAR_MOVIMIENTO").length).toBe(1);
  const antes = (await operaciones(page)).filter(op => ["CREAR_VARIANTE", "REGISTRAR_MOVIMIENTO"].includes(op.tipo));
  const crear = antes.find(op => op.tipo === "CREAR_VARIANTE")!, mover = antes.find(op => op.tipo === "REGISTRAR_MOVIMIENTO")!;
  expect(mover.dependencias).toEqual([crear.identificador]); expect(mover.intentos).toBe(0);
  await page.context().setOffline(false);
  await expect(page.locator(`[data-operacion-stock="${mover.identificador}"]`)).toHaveAttribute("data-estado", "CONFIRMADA");
  const respuesta = await request.get(`/api/v1/productos/${prenda.identificador}/variantes`), variantes = (await respuesta.json()).variantes;
  expect(variantes).toHaveLength(1); expect(variantes[0].física).toBe(12);
  await page.getByRole("button", { name: /Sincronizar/ }).click();
  const historial = (await (await request.get(`/api/v1/variantes/${variantes[0].identificador}/movimientos`)).json()).movimientos;
  expect(historial).toHaveLength(1);
});

test("stock con cambio ajeno: conflicto visible y corrección explícita conserva antecedente", async ({ page, request }) => {
  const prenda = await producto(request), v = await entrada(request, await variante(request, prenda));
  await abrir(page, prenda);
  const fila = page.locator(`[data-variante="${v.identificador}"]`); await expect(fila).toContainText("v2");
  await fila.getByRole("button", { name: "Gestionar stock" }).click(); await page.context().setOffline(true);
  await page.getByLabel("Tipo de movimiento").selectOption("SALIDA"); await page.getByLabel("Cantidad del movimiento").fill("2"); await page.getByLabel("Motivo del movimiento").fill("Salida propuesta");
  await page.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  const op = (await operaciones(page)).find(op => op.tipo === "REGISTRAR_MOVIMIENTO")!;
  await entrada(request, v, 5);
  await page.context().setOffline(false);
  const conflicto = page.locator(`[data-operacion-stock="${op.identificador}"]`);
  await expect(conflicto).toHaveAttribute("data-estado", "REQUIERE_REVISION");
  await conflicto.getByRole("button", { name: "Revisar conflicto de stock" }).click();
  await page.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  await expect.poll(async () => (await operaciones(page)).filter(op => op.tipo === "REGISTRAR_MOVIMIENTO" && op.estado === "CONFIRMADA").length).toBe(1);
  const ops = await operaciones(page), anterior = ops.find(p => p.identificador === op.identificador)!;
  expect(anterior.estado).toBe("REQUIERE_REVISION"); expect(anterior.reemplazadaPor).toBeTruthy();
  const actual = (await (await request.get(`/api/v1/variantes/${v.identificador}`)).json()).variante;
  expect(actual.física).toBe(13); expect(actual.versión_sincronización).toBe(4);
});

test("respuesta de movimiento perdida tras escritura: reintenta misma clave sin repetir saldo ni historial", async ({ page, request }) => {
  const prenda = await producto(request), v = await variante(request, prenda); await abrir(page, prenda);
  const fila = page.locator(`[data-variante="${v.identificador}"]`); await fila.getByRole("button", { name: "Gestionar stock" }).click();
  let perdida = false;
  await page.context().route(`**/api/v1/variantes/${v.identificador}/movimientos`, async ruta => {
    if (ruta.request().method() === "POST" && !perdida) { const respuesta = await ruta.fetch(); expect(respuesta.status()).toBe(201); perdida = true; await ruta.abort("failed"); }
    else await ruta.continue();
  });
  await page.getByLabel("Cantidad del movimiento").fill("9"); await page.getByLabel("Motivo del movimiento").fill("Entrada con respuesta perdida"); await page.getByRole("button", { name: "Guardar movimiento", exact: true }).click();
  await expect.poll(async () => (await operaciones(page)).find(op => op.tipo === "REGISTRAR_MOVIMIENTO")?.estado).toBe("ERROR_REINTENTABLE");
  const op = (await operaciones(page)).find(op => op.tipo === "REGISTRAR_MOVIMIENTO")!;
  await expect.poll(() => Date.now()).toBeGreaterThan(op.próximoIntento);
  await page.getByRole("button", { name: /Sincronizar/ }).click();
  await expect(page.locator(`[data-operacion-stock="${op.identificador}"]`)).toHaveAttribute("data-estado", "CONFIRMADA");
  const actual = (await (await request.get(`/api/v1/variantes/${v.identificador}`)).json()).variante;
  expect(actual.física).toBe(9); expect(actual.versión_sincronización).toBe(2);
  expect((await (await request.get(`/api/v1/variantes/${v.identificador}/movimientos`)).json()).movimientos).toHaveLength(1);
});
