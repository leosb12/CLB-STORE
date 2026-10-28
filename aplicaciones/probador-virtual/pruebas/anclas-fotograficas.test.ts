import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {calcularAjuste} from "../fuente/dominio/pose";

test("anclas de textura: mismo fixture que Flutter, sin calibración heredada de SVG",() => {
  const f=JSON.parse(readFileSync(new URL("../../../compartido/prendas/fixtures/ajuste-fotografico.json",import.meta.url),"utf8"));
  const ajuste=calcularAjuste(f.pose,"superior",f.recurso.ancho,f.recurso.alto,f.recurso.anclas);
  assert.equal(ajuste.ajustado,true);
  if (!ajuste.ajustado) return;
  for (const [campo,valor] of Object.entries(f.esperado)) assert.ok(Math.abs(ajuste.transformación[campo as keyof typeof ajuste.transformación]-(valor as number))<1e-9,campo);
});
