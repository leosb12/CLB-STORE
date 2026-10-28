import { test } from "node:test";
import assert from "node:assert/strict";
import { medirCuerpo, type Mascara, type Punto } from "../fuente/dominio/ra/cuerpo";
import { FiltroUnEuro, RETENCION_MS, SuavizadorCuerpo } from "../fuente/dominio/ra/suavizado";
import { construirEscena } from "../fuente/dominio/ra/malla-ra";
import { validarModelo3D } from "../fuente/dominio/ra/modelo-prenda";
import { readFileSync } from "node:fs";

const ANCHO = 400, ALTO = 640, CX = 200, W = 160, PROF = 0.62;
const Y_HOMBROS = 160, Y_CADERAS = 380;
/** Proporción hombros/torso de frente (la que guarda el suavizador como referencia). */
const REFERENCIA = W / (Y_CADERAS - Y_HOMBROS);

/**
 * Persona sintética girada `g` rad: torso cilíndrico elíptico (semiejes W/2 y W/2·0,62) y cabeza, como los vería
 * BlazePose. De costado el hombro lejano queda tapado (confianza baja) y la profundidad z lo delata.
 */
function persona(g: number, ruidoZ = 0, escala = 1): { puntos: Punto[]; mascara: Mascara } {
  // `escala` < 1: la misma persona más lejos de la cámara (todo más chico alrededor de los hombros).
  const W_ = W * escala, Y_CAD = Y_HOMBROS + (Y_CADERAS - Y_HOMBROS) * escala;
  const semi = Math.hypot((W_ / 2) * Math.cos(g), (W_ / 2) * PROF * Math.sin(g));
  const datos = new Uint8Array(ANCHO * ALTO);
  for (let y = 0; y < ALTO; y++)
    for (let x = 0; x < ANCHO; x++) {
      const torso = y >= Y_HOMBROS - 10 && y <= Y_CAD + 40 && Math.abs(x - CX) <= semi;
      const cabeza = Math.hypot(x - CX, y - 100) <= 40;
      if (torso || cabeza) datos[y * ANCHO + x] = 255;
    }
  const puntos: Punto[] = Array.from({ length: 33 }, () => ({ x: CX, y: 100, z: 0, c: 0 }));
  const lejano = Math.sin(g) > 0.5 ? "izq" : Math.sin(g) < -0.5 ? "der" : null;
  const lado = (y: number, signo: 1 | -1, mitad: number, nombre: "izq" | "der"): Punto => ({
    x: CX + signo * mitad * Math.cos(g),
    y,
    z: -signo * mitad * Math.sin(g) + (nombre === "izq" ? ruidoZ : -ruidoZ),
    c: lejano === nombre ? 0.2 : 0.9,
  });
  puntos[11] = lado(Y_HOMBROS, 1, W_ / 2, "izq");
  puntos[12] = lado(Y_HOMBROS, -1, W_ / 2, "der");
  puntos[23] = lado(Y_CAD, 1, W_ * 0.3, "izq");
  puntos[24] = lado(Y_CAD, -1, W_ * 0.3, "der");
  return { puntos, mascara: { ancho: ANCHO, alto: ALTO, datos } };
}

const diferenciaAngular = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

for (const grados of [0, 45, 80]) {
  test(`de ${grados}° se mide el cuerpo con su giro y una escala que no se encoge`, () => {
    const g = (grados * Math.PI) / 180;
    const { puntos, mascara } = persona(g);
    const c = medirCuerpo(puntos, mascara, REFERENCIA);
    assert.ok(c, "debe medir el cuerpo aunque el hombro lejano esté tapado");
    assert.ok(diferenciaAngular(c.giro, g) < (15 * Math.PI) / 180, `giro ${((c.giro * 180) / Math.PI).toFixed(1)}°`);
    assert.ok(Math.abs(c.anchoReal - W) < 1e-6, "ancho real constante al girar");
    // El semiancho proyectado del pecho sigue a la elipse girada.
    const esperado = Math.hypot((W / 2) * Math.cos(g), (W / 2) * PROF * Math.sin(g));
    const pecho = c.torso.find((f) => f.t >= 0.4)!;
    assert.ok(Math.abs(pecho.semiancho - esperado) < W * 0.08, `semiancho ${pecho.semiancho.toFixed(1)} vs ${esperado.toFixed(1)}`);
  });
}

test("con la referencia de frente, el acortamiento de los hombros corrige una z ruidosa", () => {
  const g = (60 * Math.PI) / 180;
  // Ruido que por sí solo daría un giro muy distinto.
  const { puntos, mascara } = persona(g, 45);
  const sinReferencia = medirCuerpo(puntos, mascara)!;
  const conReferencia = medirCuerpo(puntos, mascara, REFERENCIA)!;
  assert.ok(diferenciaAngular(conReferencia.giro, g) < diferenciaAngular(sinReferencia.giro, g));
});

test("sin ningún hombro bien visto no se mide", () => {
  const { puntos, mascara } = persona(0);
  puntos[11] = { ...puntos[11]!, c: 0.3 };
  puntos[12] = { ...puntos[12]!, c: 0.3 };
  assert.equal(medirCuerpo(puntos, mascara), null);
});

test("One Euro: quieto converge sin temblar; un salto grande se sigue rápido", () => {
  const f = new FiltroUnEuro();
  let v = 0;
  for (let k = 0; k < 30; k++) v = f.filtrar(k % 2 ? 1 : -1, k * 33);
  assert.ok(Math.abs(v) < 0.5, "el temblor ±1 se atenúa");
  for (let k = 30; k < 45; k++) v = f.filtrar(100, k * 33);
  assert.ok(v > 90, "medio segundo después sigue al valor nuevo");
});

test("el suavizador conserva el último cuerpo un momento y luego lo suelta", () => {
  const s = new SuavizadorCuerpo();
  const { puntos, mascara } = persona(0);
  const c = s.filtrar(medirCuerpo(puntos, mascara), 1000)!;
  assert.ok(c);
  assert.equal(s.filtrar(null, 1000 + RETENCION_MS - 10), c);
  assert.equal(s.filtrar(null, 1000 + RETENCION_MS + 50), null);
});

test("conjunto RA: la prenda de arriba queda delante del pantalón en la cintura, sin abrirse como falda", () => {
  const leer = (ruta: string) => validarModelo3D(JSON.parse(readFileSync(new URL(ruta, import.meta.url), "utf8")))!;
  const { puntos, mascara } = persona(0);
  // Piernas: rodillas y tobillos bajo las caderas.
  puntos[25] = { x: CX + 30, y: 500, z: 0, c: 0.9 }; puntos[26] = { x: CX - 30, y: 500, z: 0, c: 0.9 };
  puntos[27] = { x: CX + 30, y: 620, z: 0, c: 0.9 }; puntos[28] = { x: CX - 30, y: 620, z: 0, c: 0.9 };
  const c = medirCuerpo(puntos, mascara, REFERENCIA)!;
  // Pantalón: modelo 3D real generado por la ingesta (fixture); polera: modelo empaquetado del catálogo de demostración.
  const escena = construirEscena([leer("./fixtures/jean-celeste.modelo.json"), leer("../../web/public/prendas/polera-gris.modelo.json")], c, puntos);
  const vertices = (prenda: number, k = 0) => {
    const pieza = escena.piezas.filter((p) => p.prenda === prenda)[k]!;
    return Array.from({ length: pieza.posiciones.length / 3 }, (_, i) => ({ x: pieza.posiciones[i * 3]!, y: pieza.posiciones[i * 3 + 1]!, z: pieza.posiciones[i * 3 + 2]! }));
  };
  const pelvis = vertices(0), torso = vertices(1);
  const cintura = Math.min(...pelvis.map((v) => v.y));
  const bajoCintura = torso.filter((v) => v.y > cintura + 5);
  assert.ok(bajoCintura.length, "la polera llega por debajo de la cintura del pantalón");
  assert.ok(Math.max(...bajoCintura.map((v) => v.z)) > Math.max(...pelvis.filter((v) => v.y < Math.max(...bajoCintura.map((b) => b.y))).map((v) => v.z)), "delante del pantalón");
  const ancho = (vs: { x: number }[]) => Math.max(...vs.map((v) => v.x)) - Math.min(...vs.map((v) => v.x));
  assert.ok(ancho(bajoCintura) < ancho(pelvis) * 1.15, "no se abre mucho más que el pantalón");
});

test("alejarse de la cámara no se confunde con girar", () => {
  // Misma persona de frente, 30 % más chica en la imagen, con la referencia tomada de cerca y una z algo ruidosa.
  const { puntos, mascara } = persona(0, 8, 0.7);
  const c = medirCuerpo(puntos, mascara, REFERENCIA)!;
  assert.ok(diferenciaAngular(c.giro, 0) < (12 * Math.PI) / 180, `giro ${((c.giro * 180) / Math.PI).toFixed(1)}°`);
});
