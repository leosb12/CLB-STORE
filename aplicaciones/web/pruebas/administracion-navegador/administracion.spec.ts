import {
  test,
  expect,
  chromium,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  Producto,
  Operacion,
} from "../../fuente/catalogo/dominio/modelos";

const origen = "http://127.0.0.1:14201";
const skuNuevo = () =>
  "CLB-PRUEBA-" + crypto.randomUUID().slice(0, 8).toUpperCase();

async function operaciones(página: Page): Promise<Operacion[]> {
  return página.evaluate(async () => {
    const base = await new Promise<IDBDatabase>((resolver, rechazar) => {
      const solicitud = indexedDB.open("clb_catalogo");
      solicitud.onsuccess = () => resolver(solicitud.result);
      solicitud.onerror = () => rechazar(solicitud.error);
    });
    const resultado = await new Promise<Operacion[]>((resolver, rechazar) => {
      const solicitud = base
        .transaction("operaciones")
        .objectStore("operaciones")
        .getAll();
      solicitud.onsuccess = () => resolver(solicitud.result);
      solicitud.onerror = () => rechazar(solicitud.error);
    });
    base.close();
    return resultado;
  });
}

async function abrir(página: Page): Promise<void> {
  await página.goto("/administracion/productos");
  await expect(página.locator(".barra-sincronización")).toContainText(
    "Catálogo actualizado",
  );
  await expect(
    página.getByRole("heading", {
      name: "Administración de productos",
      exact: true,
    }),
  ).toBeVisible();
  await página.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => página.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

async function completar(
  página: Page,
  sku: string,
  nombre: string,
  precio = "129.90",
): Promise<void> {
  await página.getByLabel("SKU", { exact: true }).fill(sku);
  await página.getByLabel("Nombre", { exact: true }).fill(nombre);
  await página
    .getByLabel("Descripción", { exact: true })
    .fill("Diseño de prueba en colección temporal");
  await página
    .getByLabel("Categoría", { exact: true })
    .selectOption("Camisas");
  await página.getByLabel("Precio en BOB", { exact: true }).fill(precio);
}

async function registrar(
  solicitud: APIRequestContext,
  sku: string,
  nombre: string,
): Promise<Producto> {
  const respuesta = await solicitud.post("/api/v1/productos", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: {
      sku,
      nombre,
      descripción: "Colección temporal",
      categoría: "Camisas de prueba",
      precio: "129.90",
      activo: true,
    },
  });
  expect(respuesta.status()).toBe(201);
  return (await respuesta.json()).producto;
}

async function buscarPorSku(
  solicitud: APIRequestContext,
  sku: string,
): Promise<Producto[]> {
  const respuesta = await solicitud.get("/api/v1/productos/administracion");
  expect(respuesta.ok()).toBe(true);
  return (await respuesta.json()).productos.filter(
    (producto: Producto) => producto.sku === sku,
  );
}

test("formularios reales, precio exacto, edición y confirmación de desactivación lógica", async ({
  page: página,
  request: solicitud,
}) => {
  const sku = skuNuevo();
  const nombre = "Camisa administrativa " + sku;
  await abrir(página);
  await completar(página, sku, nombre, "0.00");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect(página.locator(".error-campo")).toContainText(
    "precio positivo exacto",
  );
  expect(await operaciones(página)).toHaveLength(0);
  await página.getByLabel("Precio en BOB", { exact: true }).fill("129.90");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect(página.locator(".operacion-administrativa")).toHaveAttribute(
    "data-estado",
    "CONFIRMADA",
  );
  let producto = (await buscarPorSku(solicitud, sku))[0];
  expect(producto.versión_sincronización).toBe(1);
  await página
    .getByRole("button", { name: "Editar " + nombre, exact: true })
    .click();
  await página.getByLabel("Precio en BOB", { exact: true }).fill("0.29");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await buscarPorSku(solicitud, sku))[0].versión_sincronización,
    )
    .toBe(2);
  producto = (await buscarPorSku(solicitud, sku))[0];
  expect(producto.precio).toBe("0.29");
  página.once("dialog", (diálogo) => diálogo.dismiss());
  await página
    .getByRole("button", { name: "Desactivar " + nombre, exact: true })
    .click();
  expect((await buscarPorSku(solicitud, sku))[0].activo).toBe(true);
  página.once("dialog", (diálogo) => diálogo.accept());
  await página
    .getByRole("button", { name: "Desactivar " + nombre, exact: true })
    .click();
  await expect
    .poll(async () => (await buscarPorSku(solicitud, sku))[0].activo)
    .toBe(false);
  expect(
    (
      await solicitud.get("/api/v1/productos/" + producto.identificador)
    ).status(),
  ).toBe(404);
  await expect(
    página.locator(`[data-producto="${producto.identificador}"]`),
  ).toContainText("Inactivo");
  await página
    .getByRole("button", { name: "Activar " + nombre, exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await buscarPorSku(solicitud, sku))[0].versión_sincronización,
    )
    .toBe(4);
  expect(
    (await solicitud.get("/api/v1/productos/" + producto.identificador)).ok(),
  ).toBe(true);
  await página.screenshot({
    path: "test-results-administracion/administracion-escritorio.png",
    fullPage: true,
  });
  await página.setViewportSize({ width: 390, height: 844 });
  expect(
    await página.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await página.screenshot({
    path: "test-results-administracion/administracion-movil.png",
    fullPage: true,
  });
});

test("registro offline sobrevive al cierre completo y se sincroniza una vez al reconectar", async ({
  request: solicitud,
}) => {
  const directorio = await mkdtemp(join(tmpdir(), "clb_prueba_admin_"));
  let contexto = await chromium.launchPersistentContext(directorio, {
    channel: "chrome",
    headless: true,
    baseURL: origen,
  });
  const sku = skuNuevo();
  try {
    let página = await contexto.newPage();
    await abrir(página);
    await contexto.setOffline(true);
    await completar(página, sku, "Preparada sin conexión");
    await página
      .getByRole("button", { name: "Guardar propuesta", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await operaciones(página)).find(
            (operación) => operación.datos["sku"] === sku,
          )?.estado,
      )
      .toBe("PENDIENTE");
    const pendiente = (await operaciones(página)).find(
      (operación) => operación.datos["sku"] === sku,
    )!;
    expect(await buscarPorSku(solicitud, sku)).toHaveLength(0);
    await contexto.close();
    contexto = await chromium.launchPersistentContext(directorio, {
      channel: "chrome",
      headless: true,
      baseURL: origen,
      offline: true,
    });
    página = await contexto.newPage();
    await página.goto("/administracion/productos");
    await expect(
      página.locator(`[data-operacion="${pendiente.identificador}"]`),
    ).toHaveAttribute("data-estado", "PENDIENTE");
    expect((await operaciones(página))[0].claveIdempotencia).toBe(
      pendiente.claveIdempotencia,
    );
    await contexto.setOffline(false);
    await expect(
      página.locator(`[data-operacion="${pendiente.identificador}"]`),
    ).toHaveAttribute("data-estado", "CONFIRMADA");
    expect(await buscarPorSku(solicitud, sku)).toHaveLength(1);
    await página.getByRole("button", { name: /Sincronizar/ }).click();
    await expect(página.locator(".barra-sincronización")).toContainText(
      "Catálogo actualizado",
    );
    expect(await buscarPorSku(solicitud, sku)).toHaveLength(1);
    expect((await operaciones(página))[0].identificador).toBe(
      pendiente.identificador,
    );
  } finally {
    await contexto.close();
    const absoluta = resolve(directorio);
    if (
      !absoluta.startsWith(resolve(tmpdir()) + sep) ||
      !absoluta.includes("clb_prueba_admin_")
    )
      throw new Error("Perfil temporal fuera del ámbito permitido.");
    await rm(absoluta, { recursive: true, force: true });
  }
});

test("respuesta perdida después de escribir: mismo UUID y reintento sin producto duplicado", async ({
  page: página,
  request: solicitud,
}) => {
  await abrir(página);
  const sku = skuNuevo();
  let perdida = false;
  await página.context().route("**/api/v1/productos", async (ruta) => {
    if (
      ruta.request().method() === "POST" &&
      ruta.request().postDataJSON()?.sku === sku &&
      !perdida
    ) {
      const respuesta = await ruta.fetch();
      expect(respuesta.status()).toBe(201);
      perdida = true;
      await ruta.abort("failed");
    } else await ruta.continue();
  });
  await completar(página, sku, "Respuesta perdida");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect
    .poll(async () => (await operaciones(página))[0]?.estado)
    .toBe("ERROR_REINTENTABLE");
  const pendiente = (await operaciones(página))[0];
  expect(await buscarPorSku(solicitud, sku)).toHaveLength(1);
  await expect.poll(() => Date.now()).toBeGreaterThan(pendiente.próximoIntento);
  await página.getByRole("button", { name: /Sincronizar/ }).click();
  await expect(
    página.locator(`[data-operacion="${pendiente.identificador}"]`),
  ).toHaveAttribute("data-estado", "CONFIRMADA");
  const confirmada = (await operaciones(página))[0];
  expect(confirmada.claveIdempotencia).toBe(pendiente.claveIdempotencia);
  expect(confirmada.intentos).toBeGreaterThanOrEqual(2);
  expect(await buscarPorSku(solicitud, sku)).toHaveLength(1);
});

test("conflicto de versión visible y corrección explícita mediante una operación nueva", async ({
  page: página,
  request: solicitud,
}) => {
  const sku = skuNuevo();
  const producto = await registrar(
    solicitud,
    sku,
    "Producto con conflicto " + sku,
  );
  await abrir(página);
  await página
    .getByRole("button", { name: "Editar " + producto.nombre, exact: true })
    .click();
  await página.context().setOffline(true);
  await página
    .getByLabel("Nombre", { exact: true })
    .fill("Propuesta preparada offline");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect
    .poll(async () => (await operaciones(página))[0]?.estado)
    .toBe("PENDIENTE");
  const pendiente = (await operaciones(página))[0];
  const {
    identificador,
    versión_sincronización,
    fecha_creación,
    fecha_actualización,
    moneda,
    ...datos
  } = producto;
  const cambioAjeno = await solicitud.put(
    "/api/v1/productos/" + producto.identificador,
    {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: {
        ...datos,
        nombre: "Cambio realizado por otra persona",
        versión_esperada: 1,
      },
    },
  );
  expect(cambioAjeno.ok()).toBe(true);
  await página.context().setOffline(false);
  const fila = página.locator(`[data-operacion="${pendiente.identificador}"]`);
  await expect(fila).toHaveAttribute("data-estado", "REQUIERE_REVISION");
  await fila
    .getByText("Respuesta del servidor y versión actual", { exact: true })
    .click();
  await expect(fila).toContainText("Cambio realizado por otra persona");
  expect((await buscarPorSku(solicitud, sku))[0].nombre).toBe(
    "Cambio realizado por otra persona",
  );
  await fila.getByRole("button", { name: "Preparar corrección" }).click();
  await expect(página.locator(".formulario-administracion")).toContainText(
    "Versión esperada 2",
  );
  await página
    .getByLabel("Nombre", { exact: true })
    .fill("Conflicto resuelto explícitamente");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await buscarPorSku(solicitud, sku))[0].versión_sincronización,
    )
    .toBe(3);
  const anteriores = await operaciones(página);
  const original = anteriores.find(
    (operación) => operación.identificador === pendiente.identificador,
  )!;
  expect(original.estado).toBe("REQUIERE_REVISION");
  expect(original.reemplazadaPor).toBeTruthy();
  expect(
    anteriores.find(
      (operación) => operación.identificador === original.reemplazadaPor,
    )?.estado,
  ).toBe("CONFIRMADA");
  expect((await buscarPorSku(solicitud, sku))[0].nombre).toBe(
    "Conflicto resuelto explícitamente",
  );
});

test("prepara una edición desde el catálogo descargado sin haber abierto administración online", async ({
  page: página,
  request: solicitud,
}) => {
  const sku = skuNuevo();
  const producto = await registrar(
    solicitud,
    sku,
    "Base pública para editar offline " + sku,
  );
  await página.goto("/catalogo");
  await expect(
    página.getByRole("heading", { name: producto.nombre, exact: true }),
  ).toBeVisible();
  await expect(página.locator(".barra-sincronización")).toContainText(
    "Catálogo actualizado",
  );
  await página.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => página.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await página.context().setOffline(true);
  await página.goto("/administracion/productos");
  await página
    .getByRole("button", { name: "Editar " + producto.nombre, exact: true })
    .click();
  await página.getByLabel("Precio en BOB", { exact: true }).fill("0.29");
  await página
    .getByRole("button", { name: "Guardar propuesta", exact: true })
    .click();
  await expect
    .poll(async () => (await operaciones(página))[0]?.estado)
    .toBe("PENDIENTE");
  expect((await buscarPorSku(solicitud, sku))[0].precio).toBe("129.90");
  await página.goto("/catalogo");
  const tarjeta = página
    .getByTestId("producto")
    .filter({
      has: página.getByRole("heading", { name: producto.nombre, exact: true }),
    });
  await expect(tarjeta.locator(".precio")).toHaveText("129,90 Bs");
  await página.context().setOffline(false);
  await expect
    .poll(async () => (await buscarPorSku(solicitud, sku))[0].precio)
    .toBe("0.29");
  await expect
    .poll(async () => (await operaciones(página))[0]?.estado)
    .toBe("CONFIRMADA");
  expect((await buscarPorSku(solicitud, sku))[0].versión_sincronización).toBe(
    2,
  );
});
