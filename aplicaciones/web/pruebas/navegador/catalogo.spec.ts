import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const origen = "http://127.0.0.1:14200";

async function sincronizar(página: Page): Promise<void> {
  await página.goto("/catalogo");
  await expect(página.locator(".barra-sincronización")).toContainText(
    "Catálogo actualizado",
  );
  await expect(página.getByTestId("producto").first()).toBeVisible();
  await página.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      página.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
}

async function almacenes(
  página: Page,
): Promise<{
  productos: unknown[];
  favoritos: unknown[];
  operaciones: Array<{
    estado: string;
    identificador: string;
    intentos: number;
  }>;
}> {
  return página.evaluate(async () => {
    const base = await new Promise<IDBDatabase>((resolver, rechazar) => {
      const solicitud = indexedDB.open("clb_catalogo");
      solicitud.onsuccess = () => resolver(solicitud.result);
      solicitud.onerror = () => rechazar(solicitud.error);
    });
    const leer = (nombre: string): Promise<unknown[]> =>
      new Promise((resolver, rechazar) => {
        const solicitud = base.transaction(nombre).objectStore(nombre).getAll();
        solicitud.onsuccess = () => resolver(solicitud.result);
        solicitud.onerror = () => rechazar(solicitud.error);
      });
    const productos = await leer("productos");
    const favoritos = await leer("favoritos");
    const operaciones = await leer("operaciones");
    base.close();
    return { productos, favoritos, operaciones } as Awaited<
      ReturnType<typeof almacenes>
    >;
  });
}

test("REST real → tarjetas, búsqueda, categoría y detalle", async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => (await request.get("/api/v1/productos")).status(), {
      timeout: 40_000,
    })
    .toBe(200);
  const respuesta = await request.get(
    "/api/v1/productos?" + new URLSearchParams({ límite: "100" }),
  );
  expect(respuesta.ok()).toBe(true);
  const datos = await respuesta.json();
  const producto = datos.productos.find(
    (prenda: { sku: string }) => prenda.sku === "CLB-DEMO-01",
  );
  expect(producto).toBeTruthy();
  await sincronizar(page);
  await expect(
    page.getByRole("heading", { name: producto.nombre, exact: true }),
  ).toBeVisible();
  expect((await almacenes(page)).productos.length).toBe(datos.paginación.total);
  await page.getByRole("searchbox").fill("Camisa de lino");
  await expect(page.getByTestId("producto")).toHaveCount(1);
  await page.getByRole("combobox").selectOption("Camisas");
  await page.getByRole("link", { name: producto.nombre, exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp("/productos/" + producto.identificador),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    producto.nombre,
  );
  await expect(page.locator(".precio-detalle")).toHaveText(
    producto.precio.replace(".", ",") + " Bs",
  );
  await page.screenshot({ path: "test-results/detalle.png", fullPage: true });
});

test("manifest, iconos, Service Worker e instalación PWA válida", async ({
  request,
}) => {
  const directorio = await mkdtemp(join(tmpdir(), "clb_prueba_pwa_"));
  const context = await chromium.launchPersistentContext(directorio, {
    channel: "chrome",
    headless: true,
    baseURL: origen,
  });
  try {
    const page = await context.newPage();
    await sincronizar(page);
    const manifiesto = await (
      await request.get("/manifest.webmanifest")
    ).json();
    expect(manifiesto.name).toBe("CLB Store");
    expect(manifiesto.display).toBe("standalone");
    expect(manifiesto.start_url).toBe("/catalogo");
    for (const icono of manifiesto.icons) {
      const respuesta = await request.get(icono.src);
      expect(respuesta.ok()).toBe(true);
      expect(respuesta.headers()["content-type"]).toContain("image/png");
      const contenido = await respuesta.body();
      const tamaño = Number(icono.sizes.split("x")[0]);
      expect(contenido.readUInt32BE(16)).toBe(tamaño);
      expect(contenido.readUInt32BE(20)).toBe(tamaño);
    }
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.ready).active?.scriptURL,
      ),
    ).toContain("/ngsw-worker.js");
    const protocolo = await context.newCDPSession(page);
    await protocolo.send("Page.enable");
    const resultado = await protocolo.send("Page.getAppManifest");
    expect(resultado.errors).toEqual([]);
    await expect
      .poll(
        async () =>
          (await protocolo.send("Page.getInstallabilityErrors"))
            .installabilityErrors,
      )
      .toEqual([]);
    await page.screenshot({
      path: "test-results/catalogo-escritorio.png",
      fullPage: true,
    });
  } finally {
    await context.close();
    await limpiarPerfil(directorio);
  }
});

test("cierre completo, reapertura offline, favoritos y cola persistentes, reconexión real", async () => {
  const directorio = await mkdtemp(join(tmpdir(), "clb_prueba_pwa_"));
  let contexto = await chromium.launchPersistentContext(directorio, {
    channel: "chrome",
    headless: true,
    baseURL: origen,
  });
  try {
    let página = await contexto.newPage();
    await sincronizar(página);
    await contexto.setOffline(true);
    await expect(página.locator(".barra-sincronización")).toContainText(
      "Sin conexión",
    );
    await página
      .getByRole("button", { name: /^Guardar favorito:/ })
      .first()
      .click();
    await expect
      .poll(async () => (await almacenes(página)).favoritos.length)
      .toBe(1);
    const antes = await almacenes(página);
    expect(antes.operaciones[0].estado).toBe("PENDIENTE");
    await página.getByRole("link", { name: /^Favoritos/ }).click();
    await expect(página.getByTestId("producto")).toHaveCount(1);
    const rutaDetalle = await página
      .getByTestId("producto")
      .locator("h3")
      .locator("..")
      .getAttribute("href");
    await contexto.close();
    contexto = await chromium.launchPersistentContext(directorio, {
      channel: "chrome",
      headless: true,
      baseURL: origen,
      offline: true,
    });
    página = await contexto.newPage();
    await página.goto("/favoritos");
    await expect(página.getByTestId("producto")).toHaveCount(1);
    await expect(página.locator(".barra-sincronización")).toContainText(
      "Sin conexión",
    );
    const después = await almacenes(página);
    expect(después.productos.length).toBe(antes.productos.length);
    expect(después.operaciones[0].identificador).toBe(
      antes.operaciones[0].identificador,
    );
    expect(después.operaciones[0].estado).toBe("PENDIENTE");
    expect(después.operaciones[0].intentos).toBe(0);
    await página.goto(rutaDetalle!);
    await expect(página.locator(".información-detalle h1")).toBeVisible();
    await página.goto("/catalogo");
    await expect(página.getByTestId("producto").first()).toBeVisible();
    await contexto.setOffline(false);
    await expect(página.locator(".barra-sincronización")).toContainText(
      "Catálogo actualizado",
    );
    expect((await almacenes(página)).operaciones[0].estado).toBe("PENDIENTE");
  } finally {
    await contexto.close();
    await limpiarPerfil(directorio);
  }
});

async function limpiarPerfil(directorio: string): Promise<void> {
  const absoluta = resolve(directorio);
  if (
    !absoluta.startsWith(resolve(tmpdir()) + sep) ||
    !absoluta.includes("clb_prueba_pwa_")
  )
    throw new Error("Directorio temporal fuera del ámbito de prueba.");
  await rm(absoluta, { recursive: true, force: true });
}

test("backend ausente conserva IndexedDB y la recuperación actualiza el catálogo", async ({
  page,
}) => {
  await sincronizar(page);
  const antes = await almacenes(page);
  const fecha = await page.locator(".barra-sincronización small").textContent();
  await page
    .context()
    .route("**/api/**", (ruta) =>
      ruta.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"mensaje":"Prueba de caída temporal"}',
      }),
    );
  await page.getByRole("button", { name: /Sincronizar/ }).click();
  await expect(page.getByRole("alert")).toContainText("Inventario no responde");
  await expect(page.getByTestId("producto")).toHaveCount(
    Math.min(12, antes.productos.length),
  );
  expect((await almacenes(page)).productos).toEqual(antes.productos);
  expect(await page.locator(".barra-sincronización small").textContent()).toBe(
    fecha,
  );
  await page.context().unroute("**/api/**");
  await page.getByRole("button", { name: /Sincronizar/ }).click();
  await expect(page.locator(".barra-sincronización")).toContainText(
    "Catálogo actualizado",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("pantalla móvil sin desbordamiento y favoritos accesibles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sincronizar(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /^Guardar favorito:/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /^Quitar de favoritos:/ }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "test-results/catalogo-movil.png",
    fullPage: true,
  });
});
