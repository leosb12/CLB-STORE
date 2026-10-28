import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MedidasInvalidas, ProbarPrenda, type DetectorPose, type ModeloObtenido } from "../fuente/aplicacion/casos-de-uso.ts";
import { validarModelo } from "../fuente/dominio/tallas.ts";
import { PUNTOS } from "../fuente/dominio/pose.ts";
import type { PrendaProbador, ResultadoProbador } from "../fuente/dominio/contrato.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/modelo-tallas.json", import.meta.url), "utf8"));
const obtenido: ModeloObtenido = { modelo: validarModelo(fixture.modelo), origen: "guardado", descargado: "2026-10-22T10:00:00.000Z" };
const prenda: PrendaProbador = { identificador: "p-1", sku: "CLB-1", nombre: "Camiseta", categoría: "Camisetas", imagen: "/x.svg", tallas: ["S", "M"] };

const detector = (visible: boolean): DetectorPose => ({
  modelo: "MoveNet de prueba",
  preparar: async () => "cpu",
  detectar: async () =>
    PUNTOS.map((n) => {
      const hombro = n === "hombro_izquierdo" ? 200 : n === "hombro_derecho" ? 100 : 0;
      return { x: hombro, y: 100, confianza: visible && hombro ? 0.8 : 0.1 };
    }),
});

function caso(visible = true) {
  const guardados: ResultadoProbador[] = [];
  const probar = new ProbarPrenda(detector(visible), { guardar: (r) => guardados.push(r) }, () => new Date("2026-10-22T12:00:00Z"));
  return { probar, guardados };
}

test("ajustar detecta la pose y ubica la prenda en los hombros", async () => {
  const { probar } = caso();
  const { ajuste } = await probar.ajustar({} as HTMLCanvasElement, 300, 400, prenda, { ancho: 420, alto: 460 });
  assert.ok(ajuste.ajustado);
  assert.equal(ajuste.transformación.x, 150);
});

test("cada prueba queda registrada con los modelos usados y sin imagen ni medidas", async () => {
  const { probar, guardados } = caso();
  const { ajuste } = await probar.ajustar({} as HTMLCanvasElement, 300, 400, prenda, { ancho: 420, alto: 460 });
  probar.registrarPrueba(prenda, ajuste, null);
  const { resultado } = probar.recomendarTalla(obtenido, { altura_cm: 168, peso_kg: 66, pecho_cm: 95, cintura_cm: 80 }, prenda, ajuste);
  assert.equal(guardados.length, 2);
  assert.equal(guardados[0].talla, null);
  assert.equal(guardados[0].modelos.tallas, null);
  assert.deepEqual(resultado.modelos, {
    pose: "MoveNet de prueba",
    tallas: { versión: 1, exactitud: fixture.modelo.metricas.exactitud, origen: "guardado", descargado: "2026-10-22T10:00:00.000Z" },
  });
  assert.equal(resultado.talla, "M");
  assert.equal(resultado.tallaDisponible, true);
  assert.equal(resultado.pose.detectada, true);
  assert.equal(resultado.fecha, "2026-10-22T12:00:00.000Z");
  assert.deepEqual(Object.keys(resultado).sort(), ["contrato", "fecha", "modelos", "pose", "prenda", "probabilidades", "talla", "tallaDisponible"]);
});

test("sin tallas informadas la disponibilidad es desconocida; una talla sin variante se marca", () => {
  const { probar } = caso();
  const medidas = { altura_cm: 183, peso_kg: 95, pecho_cm: 114, cintura_cm: 100 };
  assert.equal(probar.recomendarTalla(obtenido, medidas, { ...prenda, tallas: [] }, null).resultado.tallaDisponible, null);
  assert.equal(probar.recomendarTalla(obtenido, medidas, prenda, null).resultado.tallaDisponible, false);
});

test("medidas fuera de rango no producen recomendación ni registro", () => {
  const { probar, guardados } = caso(false);
  assert.throws(() => probar.recomendarTalla(obtenido, { altura_cm: 20, peso_kg: 66, pecho_cm: 95, cintura_cm: 80 }, prenda, null), MedidasInvalidas);
  assert.equal(guardados.length, 0);
});

test("la disponibilidad de la talla no distingue mayúsculas ni espacios", () => {
  const { probar } = caso();
  const medidas = { altura_cm: 168, peso_kg: 66, pecho_cm: 95, cintura_cm: 80 };
  assert.equal(probar.recomendarTalla(obtenido, medidas, { ...prenda, tallas: [" m "] }, null).resultado.tallaDisponible, true);
});
