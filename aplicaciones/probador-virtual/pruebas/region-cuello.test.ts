import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { CUELLO, regionCuello, SOBRE_HOMBROS, type Pose } from "../fuente/dominio/pose";

const pose = (puntos: Record<number, [number, number, number]>): Pose => {
  const p: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
  for (const [i, [x, y, c]] of Object.entries(puntos)) p[+i] = { x, y, confianza: c };
  return p;
};

test("región del cuello: U bajo el borde superior de la prenda, centrada y hacia la cabeza", () => {
  const r = regionCuello(pose({ 5: [300, 400, 0.9], 6: [100, 400, 0.9] }))!;
  // Ancho 200; el borde de la prenda está SOBRE_HOMBROS·W sobre las articulaciones. La franja sube `alto` desde ahí
  // y el escote baja `escote`, en el centro.
  const borde = 400 - SOBRE_HOMBROS * 200;
  assert.ok(Math.abs(r[0]!.x - (200 - CUELLO.semiancho * 200)) < 1e-9 && Math.abs(r[0]!.y - (borde - CUELLO.alto * 200)) < 1e-9);
  const fondo = r[2 + 4]!;
  assert.ok(Math.abs(fondo.x - 200) < 1e-9 && Math.abs(fondo.y - (borde + CUELLO.escote * 200)) < 1e-9);
  // Los extremos de la U quedan sobre el borde superior de la prenda.
  assert.ok(Math.abs(r[2]!.y - borde) < 1e-9 && Math.abs(r.at(-1)!.y - borde) < 1e-9);
});

test("sin los dos hombros o con la persona muy pequeña no hay región", () => {
  assert.equal(regionCuello(pose({ 5: [300, 400, 0.9], 6: [100, 400, 0.1] })), null);
  assert.equal(regionCuello(pose({ 5: [105, 400, 0.9], 6: [100, 400, 0.9] })), null);
});

// Paridad con Android: `regionCuello` de `pose.dart` debe dar este mismo polígono.
// Si cambia a propósito: CLB_REGENERAR_FIXTURE=1 npm test, y portar el cambio a Dart.
test("región coincide con el fixture compartido con Android (torso inclinado)", () => {
  const ruta = new URL("../../../compartido/prendas/fixtures/region-cuello.json", import.meta.url);
  const puntos: Record<number, [number, number, number]> = { 0: [212, 180, 0.8], 5: [290, 330, 0.85], 6: [140, 352, 0.7] };
  const region = regionCuello(pose(puntos))!;
  if (process.env.CLB_REGENERAR_FIXTURE === "1") writeFileSync(ruta, JSON.stringify({ puntos, region }, null, 2) + "\n");
  const esperado = JSON.parse(readFileSync(ruta, "utf8"));
  assert.equal(region.length, esperado.region.length);
  region.forEach((p, k) => assert.ok(Math.abs(p.x - esperado.region[k].x) < 1e-6 && Math.abs(p.y - esperado.region[k].y) < 1e-6, `punto ${k}`));
});
