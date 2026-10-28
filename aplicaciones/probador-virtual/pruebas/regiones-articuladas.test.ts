import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { analizarTextura, articularPrenda, mallaSegura } from "../fuente/dominio/prenda-articulada";
import { calcularAjuste, suavizarPose, type Pose } from "../fuente/dominio/pose";
const f = JSON.parse(readFileSync(new URL("../../../compartido/prendas/fixtures/regiones-articuladas.json", import.meta.url), "utf8"));
function escena() {
    const alfa = new Uint8Array(f.ancho * f.alto);
    for (const [i, y, d, b] of f.rectangulos)
        for (let yy = y; yy < b; yy++)
            for (let x = i; x < d; x++)
                alfa[yy * f.ancho + x] = 255;
    const [i, y, d, b] = f.hueco;
    for (let yy = y; yy < b; yy++)
        for (let x = i; x < d; x++)
            alfa[yy * f.ancho + x] = 0;
    const g = analizarTextura(alfa, f.ancho, f.alto, f.anclas)!;
    const pose: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
    for (const [i, p] of Object.entries(f.puntos) as [
        string,
        number[]
    ][])
        pose[+i] = { x: p[0]!, y: p[1]!, confianza: p[2]! };
    const a = calcularAjuste(pose, "superior", f.ancho, f.alto, f.anclas);
    assert.ok(a.ajustado);
    return { g, pose, t: a.transformación };
}
test("torso se estrecha hacia caderas y mangas siguen codos sin inversiones ni costuras abiertas", () => {
    const { g, pose, t } = escena(), m = articularPrenda(g, pose, t)!;
    assert.equal(g.mangas.length, 2);
    assert.equal(m.codosArticulados, 2);
    assert.ok(m.regiones.every(mallaSegura));
    assert.ok(m.regiones.reduce((n, r) => n + r.indices.length / 3, 0) <= 80);
    const torso = m.regiones.at(-1)!, anchoFila = (j: number) => Math.hypot(torso.vertices[j * 6 + 4]! - torso.vertices[j * 6]!, torso.vertices[j * 6 + 5]! - torso.vertices[j * 6 + 1]!);
    assert.ok(anchoFila(g.filas.length - 2) < anchoFila(1));
    for (let k = 0; k < 2; k++) {
        const manga = g.mangas[k]!, region = m.regiones[k]!, col = manga.lado < 0 ? 3 : 0;
        // Cada punto de la raíz debe coincidir con la interpolación del borde del torso.
        for (let fila = 0; fila < 3; fila++) {
            const y = region.uv[(fila * 4 + col) * 2 + 1]!;
            const siguiente = g.filas.findIndex(f => f.y >= y), previo = Math.max(0, siguiente - 1);
            const peso = (y - g.filas[previo]!.y) / (g.filas[siguiente]!.y - g.filas[previo]!.y);
            for (let eje = 0; eje < 2; eje++) {
                const ini = torso.vertices[previo * 6 + (k === 0 ? 0 : 4) + eje]!, fin = torso.vertices[siguiente * 6 + (k === 0 ? 0 : 4) + eje]!;
                assert.ok(Math.abs(region.vertices[(fila * 4 + col) * 2 + eje]! - (ini + (fin - ini) * peso)) < 1e-6);
            }
        }
        const extcol = manga.lado < 0 ? 0 : 3, peso = (manga.centro - manga.arriba) / (g.axila - manga.arriba);
        const x = region.vertices[extcol * 2]! + (region.vertices[(8 + extcol) * 2]! - region.vertices[extcol * 2]!) * peso;
        const y = region.vertices[extcol * 2 + 1]! + (region.vertices[(8 + extcol) * 2 + 1]! - region.vertices[extcol * 2 + 1]!) * peso;
        const h = pose[k === 0 ? 5 : 6]!, c = pose[k === 0 ? 7 : 8]!;
        assert.ok(Math.abs((x - h.x) * (c.y - h.y) - (y - h.y) * (c.x - h.x)) < 1e-5);
        assert.ok(y > h.y + 50); // abertura baja: ya no queda horizontal como en la textura fuente
    }
});
test("codo oculto conserva solo esa manga y caderas ocultas no producen NaN", () => {
    const { g, pose, t } = escena();
    pose[7]!.confianza = 0;
    pose[11]!.confianza = 0;
    const m = articularPrenda(g, pose, t)!;
    assert.equal(m.codosArticulados, 1);
    assert.equal(m.torsoEstimado, true);
    assert.ok(m.regiones.every(mallaSegura));
    assert.ok(Math.abs(m.regiones[0]!.vertices[22]!-m.regiones.at(-1)!.vertices[12]!)<1e-6);
});
test('dos codos visibles no obligan a deformar una manga cuya proyección es insuficiente',()=>{
 const {g,pose,t}=escena();pose[7]={...pose[5],x:pose[5].x+1,y:pose[5].y+1};
 assert.ok(pose[7].confianza>.3&&pose[8].confianza>.3);
 const m=articularPrenda(g,pose,t)!;assert.equal(m.codosArticulados,1);assert.ok(m.regiones.every(mallaSegura));
});
test("alfa o coordenadas inválidos rechazan geometría en lugar de dibujar triángulos corruptos", () => {
    assert.equal(analizarTextura(new Uint8Array(2), 200, 240, f.anclas), null);
    assert.equal(analizarTextura(new Uint8Array(200 * 240), 200, 240, { ...f.anclas, arriba: NaN }), null);
});
test("brazos verticales no requieren estirar ni invertir las mangas", () => {
    const { g, pose, t } = escena();
    pose[7]!.x = pose[5]!.x;
    pose[8]!.x = pose[6]!.x;
    const m = articularPrenda(g, pose, t)!;
    assert.equal(m.codosArticulados, 2);
    assert.ok(m.regiones.every(mallaSegura));
});

test('suavizado de pose reduce saltos sin mantener un codo que deja de verse',()=>{
  const {pose}=escena(), siguiente=pose.map(p=>({...p,x:p.x+20}));
  siguiente[7]!.confianza=.1;
  const suave=suavizarPose(pose,siguiente,.45);
  assert.equal(suave[5]!.x,pose[5]!.x+9);
  assert.equal(suave[7]!.confianza,.1);assert.equal(suave[7]!.x,siguiente[7]!.x);
  assert.deepEqual(suavizarPose(pose,siguiente,1),siguiente);
});

test("prenda de manga larga articula antebrazo siguiendo muñeca y dobla en codo", () => {
    const alfa = new Uint8Array(200 * 240);
    for (let y = 30; y < 221; y++)
        for (let x = 40; x < 160; x++)
            alfa[y * 200 + x] = 255;
    for (let y = 40; y < 210; y++)
        for (let x = 8; x < 40; x++)
            alfa[y * 200 + x] = 255;
    for (let y = 40; y < 210; y++)
        for (let x = 160; x < 192; x++)
            alfa[y * 200 + x] = 255;

    const g = analizarTextura(alfa, 200, 240, f.anclas)!;
    assert.ok(g);
    assert.equal(g.mangas.length, 2);
    assert.ok(g.mangas.every(m => m.larga && m.abajo! > g.axila));

    const pose: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
    pose[5] = { x: 250, y: 200, confianza: 0.95 };
    pose[6] = { x: 390, y: 200, confianza: 0.95 };
    pose[7] = { x: 230, y: 340, confianza: 0.9 };
    pose[8] = { x: 410, y: 340, confianza: 0.9 };
    pose[9] = { x: 280, y: 420, confianza: 0.9 };
    pose[10] = { x: 360, y: 420, confianza: 0.9 };
    pose[11] = { x: 285, y: 500, confianza: 0.9 };
    pose[12] = { x: 375, y: 500, confianza: 0.9 };

    const a = calcularAjuste(pose, "superior", 200, 240, f.anclas);
    assert.ok(a.ajustado);
    const m = articularPrenda(g, pose, a.transformación)!;
    assert.ok(m);
    assert.equal(m.codosArticulados, 2);
    assert.equal(m.regiones.length, 5); // 2 brazos, 2 antebrazos, 1 torso continuo
    assert.ok(m.regiones.every(mallaSegura));
});

test("pose sentada en cámara web sin caderas visibles articula mangas respetando ángulo de brazos hacia abajo", () => {
    const { g } = escena();
    const poseSentada: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
    // Hombros nivelados
    poseSentada[5] = { x: 200, y: 240, confianza: 0.95 };
    poseSentada[6] = { x: 380, y: 248, confianza: 0.95 };
    // Codos descendiendo en ángulo diagonal (~60 grados)
    poseSentada[7] = { x: 155, y: 325, confianza: 0.90 };
    poseSentada[8] = { x: 415, y: 320, confianza: 0.90 };
    // Caderas no visibles (ocultas por escritorio/pantalla)
    poseSentada[11] = { x: 0, y: 0, confianza: 0 };
    poseSentada[12] = { x: 0, y: 0, confianza: 0 };

    const a = calcularAjuste(poseSentada, "superior", f.ancho, f.alto, f.anclas);
    assert.ok(a.ajustado);
    assert.equal(a.largoEstimado, true);

    const m = articularPrenda(g, poseSentada, a.transformación)!;
    assert.ok(m);
    assert.equal(m.codosArticulados, 2);
    assert.equal(m.torsoEstimado, true);
    assert.ok(m.regiones.every(mallaSegura));

    // Verificar que las mangas descienden a lo largo del brazo y no quedan horizontales
    for (let k = 0; k < 2; k++) {
        const manga = g.mangas[k]!;
        const region = m.regiones[k]!;
        const extcol = manga.lado < 0 ? 0 : 3;
        const h = poseSentada[k === 0 ? 5 : 6]!;
        const c = poseSentada[k === 0 ? 7 : 8]!;
        const yCuello = region.vertices[extcol * 2 + 1]!;
        // La abertura de la manga debe descender por debajo del hombro hacia el codo
        assert.ok(yCuello > h.y + 15, "La manga debe descender hacia el codo");
        // Verificar que no se extiende horizontalmente a los extremos de la pantalla
        const xExtremo = region.vertices[extcol * 2]!;
        if (manga.lado < 0) {
            assert.ok(xExtremo > 50, "La manga izquierda no debe estirarse horizontalmente al borde");
        } else {
            assert.ok(xExtremo < 550, "La manga derecha no debe estirarse horizontalmente al borde");
        }
    }
});

test("manga sin codo visible adopta caída natural hacia abajo en vez de proyectarse horizontalmente", () => {
    const { g } = escena();
    const poseSinCodo: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
    poseSinCodo[5] = { x: 200, y: 240, confianza: 0.95 };
    poseSinCodo[6] = { x: 380, y: 248, confianza: 0.95 };
    // Ambos codos ocultos o de muy baja confianza
    poseSinCodo[7] = { x: 0, y: 0, confianza: 0 };
    poseSinCodo[8] = { x: 0, y: 0, confianza: 0 };

    const a = calcularAjuste(poseSinCodo, "superior", f.ancho, f.alto, f.anclas);
    assert.ok(a.ajustado);

    const m = articularPrenda(g, poseSinCodo, a.transformación)!;
    assert.ok(m);
    assert.equal(m.codosArticulados, 0);
    assert.ok(m.regiones.every(mallaSegura));

    for (let k = 0; k < 2; k++) {
        const manga = g.mangas[k]!;
        const region = m.regiones[k]!;
        const extcol = manga.lado < 0 ? 0 : 3;
        const h = poseSinCodo[k === 0 ? 5 : 6]!;
        const yPunta = region.vertices[extcol * 2 + 1]!;
        // La punta de la manga en reposo debe caer hacia abajo (por debajo del hombro)
        assert.ok(yPunta > h.y + 10, "La manga en reposo debe caer hacia abajo");
    }
});

// Paridad con Android: `prenda_articulada.dart` debe producir exactamente esta malla.
// Si cambia la geometría a propósito: CLB_REGENERAR_FIXTURE=1 npm test, y portar el cambio a Dart.
test("malla coincide con el fixture compartido con Android (manga corta y larga)", () => {
    const ruta = new URL("../../../compartido/prendas/fixtures/regiones-resultado.json", import.meta.url);
    const corta = escena(), m = articularPrenda(corta.g, corta.pose, corta.t)!;
    const alfa = new Uint8Array(f.ancho * f.alto);
    for (const [i, y, d, b] of f.manga_larga.rectangulos)
        for (let yy = y; yy < b; yy++)
            for (let x = i; x < d; x++)
                alfa[yy * f.ancho + x] = 255;
    const pose: Pose = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confianza: 0 }));
    for (const [i, p] of Object.entries(f.manga_larga.puntos) as [string, number[]][])
        pose[+i] = { x: p[0]!, y: p[1]!, confianza: p[2]! };
    const ajuste = calcularAjuste(pose, "superior", f.ancho, f.alto, f.anclas);
    assert.ok(ajuste.ajustado);
    const larga = articularPrenda(analizarTextura(alfa, f.ancho, f.alto, f.anclas)!, pose, ajuste.transformación)!;
    const actual = { ...m, manga_larga: larga };
    if (process.env.CLB_REGENERAR_FIXTURE === "1") writeFileSync(ruta, JSON.stringify(actual, null, 2) + "\n");
    const esperado = JSON.parse(readFileSync(ruta, "utf8"));
    for (const [r, e] of [[m, esperado], [larga, esperado.manga_larga]] as const) {
        assert.equal(r.codosArticulados, e.codosArticulados);
        assert.equal(r.regiones.length, e.regiones.length);
        r.regiones.forEach((region, k) => {
            assert.deepEqual(region.indices, e.regiones[k].indices);
            region.vertices.forEach((v, j) => assert.ok(Math.abs(v - e.regiones[k].vertices[j]) < 1e-6, `región ${k} vértice ${j}`));
            region.uv.forEach((v, j) => assert.ok(Math.abs(v - e.regiones[k].uv[j]) < 1e-6, `región ${k} uv ${j}`));
        });
    }
});
