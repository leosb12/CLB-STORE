import { test } from "node:test";
import assert from "node:assert/strict";
import { varianteDeTalla } from "../fuente/probador/aplicacion/talla-sugerida.ts";
import type { Variante } from "../fuente/existencias/dominio/modelos.ts";

const variante = (identificador: string, talla: string, disponible: number, activo = true) => ({ identificador, talla, disponible, activo }) as Variante;

test("la talla sugerida por el probador preselecciona una variante de esa talla con stock", () => {
  const variantes = [variante("m-agotada", "M", 0), variante("s", "S", 3), variante("m", "M", 2), variante("m-inactiva", "M", 9, false)];
  assert.equal(varianteDeTalla(variantes, "M")?.identificador, "m");
  assert.equal(varianteDeTalla(variantes, "m")?.identificador, "m");
  assert.equal(varianteDeTalla([variante("m-agotada", "M", 0)], "M")?.identificador, "m-agotada");
  assert.equal(varianteDeTalla(variantes, "XL"), undefined);
  assert.equal(varianteDeTalla(variantes, null), undefined);
});

test("la precarga del shell espera al Service Worker y solo descarga archivos de /probador/, sin ejecutarlos", async () => {
  const { precargarArchivosProbador } = await import("../fuente/probador/adaptadores/cargador-probador.ts");
  const pedidas: string[] = [];
  const globales = globalThis as Record<string, unknown>;
  const anteriores = { navigator: globales["navigator"], window: globales["window"], fetch: globales["fetch"], location: globales["location"] };
  let enLínea = false;
  Object.defineProperty(globalThis, "navigator", { value: { get onLine() { return enLínea; } }, configurable: true });
  globales["location"] = { origin: "http://127.0.0.1:14200" };
  globales["window"] = { requestIdleCallback: (tarea: () => void) => tarea() };
  globales["fetch"] = async (url: string | URL) => {
    pedidas.push(String(url));
    return { json: async () => ({ archivos: ["probador.js", "modelos/m/model.json", "../api/v1/secreto", "//otro.host/x.js"] }) };
  };
  const sw = { ready: Promise.resolve(), controller: {} } as unknown as ServiceWorkerContainer;
  try {
    precargarArchivosProbador(sw);
    assert.deepEqual(pedidas, [], "Sin red no se descarga nada.");
    enLínea = true;
    precargarArchivosProbador(sw);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(pedidas, [
      "/probador/manifiesto.json",
      "http://127.0.0.1:14200/probador/probador.js",
      "http://127.0.0.1:14200/probador/modelos/m/model.json",
    ]);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: anteriores.navigator, configurable: true });
    globales["window"] = anteriores.window;
    globales["fetch"] = anteriores.fetch;
    globales["location"] = anteriores.location;
  }
});
