import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inferirTalla, validarMedidas, validarModelo, ModeloTallasInvalido, type Medidas } from "../fuente/dominio/tallas.ts";
import { ANCLAJES, SOBRE_HOMBROS, PUNTOS, calcularAjuste, suavizar, tipoDePrenda, type Pose } from "../fuente/dominio/pose.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/modelo-tallas.json", import.meta.url), "utf8"));

test("la talla offline da las mismas probabilidades que el servicio de IA de la fase 8", () => {
  const modelo = validarModelo(fixture.modelo);
  for (const caso of fixture.casos) {
    const r = inferirTalla(modelo, caso.medidas as Medidas);
    assert.equal(r.talla, caso.talla);
    assert.equal(r.tallaPorTabla, caso.talla_por_tabla);
    for (const [talla, p] of Object.entries(caso.probabilidades as Record<string, number>))
      assert.ok(Math.abs(r.probabilidades[talla] - p) < 1e-3, `${talla}: ${r.probabilidades[talla]} ≠ ${p}`);
  }
});

test("una talla con menos del 60 % se presenta junto a la segunda más probable", () => {
  const modelo = validarModelo(fixture.modelo);
  const dudosa = inferirTalla(modelo, { altura_cm: 172, peso_kg: 74, pecho_cm: 102, cintura_cm: 88 });
  assert.deepEqual([dudosa.talla, dudosa.alternativa], ["L", "M"]);
  assert.equal(inferirTalla(modelo, { altura_cm: 155, peso_kg: 48, pecho_cm: 82, cintura_cm: 66 }).alternativa, null);
});

test("un modelo mal formado o manipulado se rechaza antes de usarlo", () => {
  const roto = (cambio: Record<string, unknown>) => () => validarModelo({ ...fixture.modelo, ...cambio });
  assert.throws(roto({ tipo: "otro" }), ModeloTallasInvalido);
  assert.throws(roto({ escala: [1, 0, 1, 1] }), ModeloTallasInvalido);
  assert.throws(roto({ coeficientes: fixture.modelo.coeficientes.slice(1) }), ModeloTallasInvalido);
  assert.throws(roto({ media: [1, 2, "3", 4] }), ModeloTallasInvalido);
  assert.throws(roto({ caracteristicas: ["pecho_cm", "altura_cm", "peso_kg", "cintura_cm"] }), ModeloTallasInvalido);
  assert.throws(() => validarModelo(null), ModeloTallasInvalido);
});

test("las medidas usan los mismos límites que Clientes e IA", () => {
  assert.equal(validarMedidas({ altura_cm: 168, peso_kg: 66, pecho_cm: 95, cintura_cm: 80 }), null);
  assert.match(validarMedidas({ altura_cm: 99, peso_kg: 66, pecho_cm: 95, cintura_cm: 80 }) ?? "", /altura_cm/);
  assert.match(validarMedidas({ altura_cm: 168, peso_kg: Number.NaN, pecho_cm: 95, cintura_cm: 80 }) ?? "", /peso_kg/);
});

function pose(puntos: Partial<Record<(typeof PUNTOS)[number], [number, number]>>): Pose {
  return PUNTOS.map((n) => (puntos[n] ? { x: puntos[n][0], y: puntos[n][1], confianza: 0.9 } : { x: 0, y: 0, confianza: 0.05 }));
}

test("una camiseta se ancla sobre el contorno de los hombros y llega hasta la cadera", () => {
  const cuerpo = pose({ hombro_izquierdo: [200, 100], hombro_derecho: [100, 100], cadera_izquierda: [190, 300], cadera_derecha: [110, 300] });
  const ajuste = calcularAjuste(cuerpo, "superior", 420, 460);
  assert.ok(ajuste.ajustado);
  const t = ajuste.transformación;
  const a = ANCLAJES.superior;
  // El borde superior sube SOBRE_HOMBROS·W sobre las articulaciones: el largo crece en lo mismo.
  assert.deepEqual([t.x, t.y, t.ángulo], [150, 100 - SOBRE_HOMBROS * 100, 0]);
  assert.ok(Math.abs(t.escalaX * (a.imagen.derecha - a.imagen.izquierda) * 420 - 100 * a.ensanche) < 1e-9);
  assert.ok(Math.abs(t.escalaY * (a.imagen.abajo - a.imagen.arriba) * 460 - (200 + SOBRE_HOMBROS * 100) * a.alargue) < 1e-9);
  assert.equal(ajuste.largoEstimado, false);
});

test("la prenda rota con la línea de los hombros y conserva su proporción si falta la cadera", () => {
  const ajuste = calcularAjuste(pose({ hombro_izquierdo: [200, 200], hombro_derecho: [100, 100] }), "superior", 420, 460);
  assert.ok(ajuste.ajustado);
  assert.ok(Math.abs(ajuste.transformación.ángulo - Math.PI / 4) < 1e-9);
  assert.equal(ajuste.transformación.escalaY, ajuste.transformación.escalaX);
  assert.equal(ajuste.largoEstimado, true);
});

test("sin hombros (o persona diminuta) no se ajusta y se explica el motivo", () => {
  const sinHombros = calcularAjuste(pose({ cadera_izquierda: [190, 300], cadera_derecha: [110, 300] }), "superior", 420, 460);
  assert.deepEqual(sinHombros.ajustado ? null : sinHombros.motivo, "SIN_PUNTOS_SUPERIORES");
  const lejos = calcularAjuste(pose({ hombro_izquierdo: [105, 100], hombro_derecho: [100, 100] }), "superior", 420, 460);
  assert.deepEqual(lejos.ajustado ? null : lejos.motivo, "PERSONA_MUY_PEQUEÑA");
});

test("el pantalón usa cadera y tobillos; el vestido, hombros y rodillas", () => {
  assert.equal(tipoDePrenda("Pantalones"), "pantalon");
  assert.equal(tipoDePrenda("Vestidos"), "vestido");
  assert.equal(tipoDePrenda("Camisetas"), "superior");
  const piernas = pose({ cadera_izquierda: [180, 300], cadera_derecha: [120, 300], tobillo_izquierdo: [175, 600], tobillo_derecho: [125, 600] });
  const pantalón = calcularAjuste(piernas, "pantalon", 420, 460);
  assert.ok(pantalón.ajustado && pantalón.transformación.y === 300);
  assert.equal(calcularAjuste(piernas, "vestido", 420, 460).ajustado, false);
});

test("el suavizado acerca la transformación nueva sin saltar", () => {
  const base = { x: 0, y: 0, ángulo: 0, escalaX: 1, escalaY: 1, origenX: 5, origenY: 5 };
  const nueva = { ...base, x: 100 };
  assert.equal(suavizar(undefined, nueva), nueva);
  assert.equal(suavizar(base, nueva, 0.5).x, 50);
});

test("se rechazan clases repetidas, exactitud imposible, coeficientes desbordados y rangos invertidos", () => {
  const roto = (cambio: Record<string, unknown>) => () => validarModelo({ ...fixture.modelo, ...cambio });
  const clases = [...fixture.modelo.clases];
  clases[1] = clases[0];
  assert.throws(roto({ clases }), ModeloTallasInvalido);
  assert.throws(roto({ metricas: { exactitud: 1.5 } }), ModeloTallasInvalido);
  assert.throws(roto({ coeficientes: fixture.modelo.coeficientes.map((f: number[]) => f.map(() => 1e6)) }), ModeloTallasInvalido);
  assert.throws(roto({ tabla: { ...fixture.modelo.tabla, M: { ...fixture.modelo.tabla.M, pecho_cm: [102, 94] } } }), ModeloTallasInvalido);
});

test("de perfil no se ajusta una ilustración frontal", () => {
  const perfil = calcularAjuste(pose({ hombro_izquierdo: [110, 200], hombro_derecho: [100, 100] }), "superior", 420, 460);
  assert.equal(perfil.ajustado ? null : perfil.motivo, "POSE_DE_PERFIL");
});

test("con el torso inclinado el largo se mide perpendicular a los hombros", () => {
  // Hombros horizontales y cadera desplazada 200 px a la derecha y 200 px abajo: el largo útil es 200 (+ el borde sobre
  // los hombros), no 283.
  const cuerpo = pose({ hombro_izquierdo: [200, 100], hombro_derecho: [100, 100], cadera_izquierda: [390, 300], cadera_derecha: [310, 300] });
  const ajuste = calcularAjuste(cuerpo, "superior", 420, 460);
  assert.ok(ajuste.ajustado);
  const a = ANCLAJES.superior;
  assert.ok(Math.abs(ajuste.transformación.escalaY * (a.imagen.abajo - a.imagen.arriba) * 460 - (200 + SOBRE_HOMBROS * 100) * a.alargue) < 1e-9);
});
