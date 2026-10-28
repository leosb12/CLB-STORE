import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fotografiaPrenda, recursoFotografia } from "../fuente/catalogo/dominio/imagen-prenda";

test("el SKU exacto elige fotografía y encuadre offline; datos remotos no forman rutas arbitrarias", () => {
  assert.equal(recursoFotografia("CLB-FOTO-POL-GRI"), "/prendas/polera-gris.png");
  assert.equal(recursoFotografia("CLB-FOTO-POL-GRI", true), "/prendas/polera-gris.svg");
  for (const sku of [undefined, "CLB-SEM-POL-BAS", "__proto__", "constructor", "../../secretos", "https://externo/foto.png"])
    assert.equal(fotografiaPrenda(sku), undefined);
});

test("las fotos originales y los encuadres del probador se entregan junto con la PWA", () => {
  const prendas = JSON.parse(readFileSync("../../compartido/prendas/catalogo.json", "utf8")) as { sku: string; archivo: string }[];
  for (const p of prendas) {
    const original = readFileSync(`public/prendas/${p.archivo}.png`);
    assert.deepEqual(original.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const svg = readFileSync(`public/prendas/${p.archivo}.svg`, "utf8");
    assert.ok(svg.includes('viewBox="0 0 420 460"'));
    assert.ok(svg.includes(original.toString("base64")));
    assert.equal(recursoFotografia(p.sku), `/prendas/${p.archivo}.png`);
  }
});
