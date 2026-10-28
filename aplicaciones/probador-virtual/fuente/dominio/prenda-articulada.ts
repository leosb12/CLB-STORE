import { CONFIANZA_MINIMA, SOBRE_HOMBROS, type Pose, type PuntoClave, type Transformacion } from "./pose";
export interface AnclasRegiones {
    izquierda: number;
    derecha: number;
    arriba: number;
    abajo: number;
}
export interface FilaTextura {
    y: number;
    izquierda: number;
    derecha: number;
}
export interface MangaTextura {
    lado: -1 | 1;
    raiz: number;
    extremo: number;
    centro: number;
    arriba: number;
    abajo?: number;
    larga?: boolean;
}
export interface GeometriaPrenda {
    ancho: number;
    alto: number;
    anclas: AnclasRegiones;
    axila: number;
    filas: FilaTextura[];
    mangas: MangaTextura[];
}
export interface MallaTextura {
    vertices: number[];
    uv: number[];
    indices: number[];
}
export interface PrendaArticulada {
    regiones: MallaTextura[];
    codosArticulados: number;
    torsoEstimado: boolean;
}
type P = {
    x: number;
    y: number;
};
const mezclar = (a: number, b: number, t: number) => a + (b - a) * t;
const punto = (a: P, b: P, t: number): P => ({ x: mezclar(a.x, b.x, t), y: mezclar(a.y, b.y, t) });
const distancia = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);
const visible = (p: PuntoClave | undefined): p is PuntoClave => !!p && p.confianza >= CONFIANZA_MINIMA && Number.isFinite(p.x) && Number.isFinite(p.y);
const mediana = (v: number[]) => { v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]!; };
/** Se ejecuta una vez por textura. Solo consume alfa local; no necesita otro modelo. */
export function analizarTextura(alfa: Uint8Array, ancho: number, alto: number, a: AnclasRegiones): GeometriaPrenda | null {
    if (ancho < 32 || alto < 32 || ancho > 1024 || alto > 1024 || alfa.length !== ancho * alto
        || ![a.izquierda, a.derecha, a.arriba, a.abajo].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
        || a.derecha - a.izquierda <= .05 || a.abajo - a.arriba <= .05)
        return null;
    const xi = a.izquierda * (ancho - 1), xd = a.derecha * (ancho - 1), ys = a.arriba * (alto - 1), yi = a.abajo * (alto - 1);
    const centroX = Math.round((xi + xd) / 2);
    const limites = (y: number): [
        number,
        number
    ] | null => {
        const fila = Math.max(0, Math.min(alto - 1, Math.round(y))) * ancho;
        let c = centroX;
        if (alfa[fila + c]! < 128) {
            let offset = 1;
            while (offset < (xd - xi) * 0.4) {
                if (c - offset >= 0 && alfa[fila + c - offset]! >= 128) { c -= offset; break; }
                if (c + offset < ancho && alfa[fila + c + offset]! >= 128) { c += offset; break; }
                offset++;
            }
            if (alfa[fila + c]! < 128) return null;
        }
        let i = c;
        while (i > 0 && alfa[fila + (i - 1)]! >= 128) {
            i--;
            if (i < xi - ancho * .03) break;
        }
        let d = c;
        while (d < ancho - 1 && alfa[fila + (d + 1)]! >= 128) {
            d++;
            if (d > xd + ancho * .03) break;
        }
        return d - i > (xd - xi) * .45 ? [i, d] : null;
    };
    // Encontrar el descenso de las mangas antes de la banda inferior del torso.
    let axila = ys + (yi - ys) * .32, consecutivas = 0;
    for (let y = Math.ceil(ys + (yi - ys) * .1); y < ys + (yi - ys) * .5; y++) {
        const fila = y * ancho;
        let i = 0, d = ancho - 1;
        while (i < d && alfa[fila + i]! < 128)
            i++;
        while (d > i && alfa[fila + d]! < 128)
            d--;
        consecutivas = i >= xi - ancho * .035 && d <= xd + ancho * .035 ? consecutivas + 1 : 0;
        if (consecutivas >= Math.max(3, alto * .015)) {
            axila = y - consecutivas + 1;
            break;
        }
    }
    axila = Math.max(ys + (yi - ys) * .15, Math.min(ys + (yi - ys) * .48, axila));
    const alturas = [0, ys, axila, ...[.5, .67, .84, 1].map(s => ys + (yi - ys) * s), alto - 1];
    const filas: FilaTextura[] = [];
    let ultimo: [
        number,
        number
    ] = [xi, xd];
    for (const y of [...new Set(alturas)].sort((a, b) => a - b)) {
        if (y > axila && y <= yi)
            ultimo = limites(y) ?? ultimo;
        filas.push({ y, izquierda: ultimo[0], derecha: ultimo[1] });
    }
    const mangas: MangaTextura[] = [];
    for (const lado of [-1, 1] as const) {
        const raiz = lado < 0 ? xi : xd;
        const limiteBorde = lado < 0 ? 0 : ancho - 1;
        let extremo = limiteBorde, maxDist = 0;
        for (let y = Math.max(0, Math.floor(ys - alto * .05)); y <= Math.min(alto - 1, Math.ceil(axila + (yi - ys) * .2)); y++) {
            let x = limiteBorde;
            const paso = lado < 0 ? 1 : -1, fin = lado < 0 ? ancho : -1;
            while (x !== fin && alfa[y * ancho + x]! < 128) x += paso;
            if (x !== fin && (lado < 0 ? x < raiz : x > raiz) && Math.abs(x - raiz) > maxDist) {
                maxDist = Math.abs(x - raiz);
                extremo = x;
            }
        }
        if (maxDist < ancho * 0.04) extremo = limiteBorde;

        const muestras: number[] = [];
        let primera = alto;
        // Centro de la abertura en el cuarto exterior: evita confundir el cuello con la manga.
        for (let y = 0; y < Math.ceil(axila); y++)
            for (let x = Math.floor(Math.min(raiz, extremo)); x <= Math.ceil(Math.max(raiz, extremo)); x++) {
                if (alfa[y * ancho + x]! > 8)
                    primera = Math.min(primera, y);
                if (Math.abs(x - raiz) > Math.abs(extremo - raiz) * .25 && alfa[y * ancho + x]! >= 128)
                    muestras.push(y);
            }
        // Escaneo descendente para determinar si la manga desciende por debajo de la axila (manga larga).
        let abajo = Math.ceil(axila);
        for (let y = Math.ceil(axila); y < yi; y++) {
            for (let x = Math.floor(Math.min(raiz, extremo)); x <= Math.ceil(Math.max(raiz, extremo)); x++) {
                if (Math.abs(x - raiz) > Math.abs(extremo - raiz) * .25 && alfa[y * ancho + x]! >= 128) {
                    abajo = Math.max(abajo, y);
                }
            }
        }
        const larga = (abajo - axila) > (yi - ys) * .25;
        if (muestras.length > Math.max(30, ancho * alto * 0.0002))
            mangas.push({ lado, raiz, extremo, centro: mediana(muestras), arriba: Math.max(0, primera - 2), abajo: larga ? abajo : Math.ceil(axila), larga });
    }
    return { ancho, alto, anclas: a, axila, filas, mangas };
}
const transformar = (t: Transformacion, p: P): P => ({
    x: t.x + Math.cos(t.ángulo) * (p.x - t.origenX) * t.escalaX - Math.sin(t.ángulo) * (p.y - t.origenY) * t.escalaY,
    y: t.y + Math.sin(t.ángulo) * (p.x - t.origenX) * t.escalaX + Math.cos(t.ángulo) * (p.y - t.origenY) * t.escalaY,
});
function cuadricula(filas: number[], columnas: number[], fuente: (y: number, u: number) => P, destino: (y: number, u: number) => P): MallaTextura {
    const m: MallaTextura = { vertices: [], uv: [], indices: [] };
    for (const y of filas)
        for (const u of columnas) {
            const s = fuente(y, u), d = destino(y, u);
            m.uv.push(s.x, s.y);
            m.vertices.push(d.x, d.y);
        }
    for (let j = 0; j < filas.length - 1; j++)
        for (let i = 0; i < columnas.length - 1; i++) {
            const a = j * columnas.length + i, b = a + 1, c = a + columnas.length, d = c + 1;
            m.indices.push(a, b, c, b, d, c);
        }
    return m;
}
export function mallaSegura(m: MallaTextura): boolean {
    if (!m.vertices.every(Number.isFinite) || !m.uv.every(Number.isFinite))
        return false;
    const area = (v: number[], a: number, b: number, c: number) => (v[b * 2]! - v[a * 2]!) * (v[c * 2 + 1]! - v[a * 2 + 1]!) - (v[b * 2 + 1]! - v[a * 2 + 1]!) * (v[c * 2]! - v[a * 2]!);
    for (let i = 0; i < m.indices.length; i += 3) {
        const [a, b, c] = m.indices.slice(i, i + 3) as [
            number,
            number,
            number
        ];
        if (area(m.vertices, a, b, c) * area(m.uv, a, b, c) <= .000001)
            return false;
    }
    return true;
}
/** ~60 triángulos: torso curvo entre articulaciones y dos mangas con raíz compartida. */
export function articularPrenda(g: GeometriaPrenda, pose: Pose, t: Transformacion): PrendaArticulada | null {
    if (!visible(pose[5]) || !visible(pose[6]) || ![t.x, t.y, t.ángulo, t.escalaX, t.escalaY].every(Number.isFinite))
        return null;
    const pares = pose[5]!.x <= pose[6]!.x ? [[5, 7, 9, 11], [6, 8, 10, 12]] : [[6, 8, 10, 12], [5, 7, 9, 11]];
    const si = pose[pares[0]![0]!]!, sd = pose[pares[1]![0]!]!;
    const hi = pose[pares[0]![3]!]!, hd = pose[pares[1]![3]!]!;
    const completo = visible(hi) && visible(hd);
    const ancho = distancia(si, sd);
    if (ancho < 12)
        return null;
    const eje = { x: (sd.x - si.x) / ancho, y: (sd.y - si.y) / ancho };
    // Borde superior sobre el contorno del hombro, no en la articulación (igual que `calcularAjuste`).
    const articulaciones = punto(si, sd, .5);
    const superior = { x: articulaciones.x + eje.y * SOBRE_HOMBROS * ancho, y: articulaciones.y - eje.x * SOBRE_HOMBROS * ancho };
    const a = g.anclas, ys = a.arriba * (g.alto - 1), yi = a.abajo * (g.alto - 1);
    const inferior = completo ? punto(hi, hd, .5) : transformar(t, { x: (a.izquierda + a.derecha) / 2 * g.ancho, y: a.abajo * g.alto });
    const cadera = completo ? Math.max(ancho * .76, Math.min(ancho * 1.15, distancia(hi, hd) * 1.35)) : ancho;

    const brazoIzq = visible(pose[pares[0]![1]!]) ? distancia(si, pose[pares[0]![1]!]!) : ancho * 0.55;
    const brazoDer = visible(pose[pares[1]![1]!]) ? distancia(sd, pose[pares[1]![1]!]!) : ancho * 0.55;
    const brazoRef = Math.max(ancho * 0.35, (brazoIzq + brazoDer) / 2);

    const largoTotalTorso = Math.max(1, distancia(superior, inferior));
    const sisaTeorica = (g.axila - ys) / (yi - ys);
    const profSisaMax = completo ? largoTotalTorso * sisaTeorica : Math.min(largoTotalTorso * sisaTeorica, Math.min(brazoRef * 0.52, ancho * 0.38));
    const sisaEfectiva = profSisaMax / largoTotalTorso;

    const borde = (y: number, u: number): P => {
        const sBruto = (y - ys) / (yi - ys);
        const s = sBruto <= sisaTeorica 
            ? (sBruto / sisaTeorica) * sisaEfectiva 
            : sisaEfectiva + ((sBruto - sisaTeorica) / (1 - sisaTeorica)) * (1 - sisaEfectiva);
        const c = punto(superior, inferior, s), acotado = Math.max(0, Math.min(1, sBruto));
        const tramoInferior = Math.max(0, (acotado - sisaTeorica) / (1 - sisaTeorica));
        const anchura = acotado <= sisaTeorica 
            ? mezclar(ancho, ancho * .76, acotado / sisaTeorica) 
            : mezclar(ancho * .76, cadera, tramoInferior) * (1 - .03 * Math.sin(Math.PI * tramoInferior));
        return { x: c.x + eje.x * anchura * (u - .5), y: c.y + eje.y * anchura * (u - .5) };
    };
    const torso = cuadricula(g.filas.map(f => f.y), [0, .5, 1], (y, u) => {
        const f = g.filas.find(f => f.y === y)!;
        return { x: mezclar(f.izquierda, f.derecha, u), y };
    }, borde);
    if (!mallaSegura(torso))
        return null;
    const bordeMalla = (y: number, u: number): P => {
        const j = g.filas.findIndex(f => f.y >= y), i = Math.max(0, j - 1);
        return punto(borde(g.filas[i]!.y, u), borde(g.filas[j]!.y, u), i === j ? 0 : (y - g.filas[i]!.y) / (g.filas[j]!.y - g.filas[i]!.y));
    };
    const regiones: MallaTextura[] = [];
    const antebrazosDelante: MallaTextura[] = [];
    let codosArticulados = 0;
    for (const manga of g.mangas) {
        // Distinción limpia entre manga corta y manga larga
        const esLarga = !!manga.larga && !!manga.abajo && manga.abajo > g.axila;
        const yCodo = esLarga ? Math.round(g.axila + (manga.abajo! - g.axila) * 0.42) : g.axila;
        const filas = esLarga ? [manga.arriba, (manga.arriba + yCodo) / 2, yCodo] : [manga.arriba, (manga.arriba + g.axila) / 2, g.axila];
        const filasAntebrazo = esLarga ? [yCodo, (yCodo + manga.abajo!) / 2, manga.abajo!] : [];

        const par = pares[manga.lado < 0 ? 0 : 1]!, h = pose[par[0]!]!, c = pose[par[1]!]!, w = pose[par[2]!];
        const fuente = (y: number, u: number): P => ({ x: mezclar(Math.min(manga.raiz, manga.extremo), Math.max(manga.raiz, manga.extremo), u), y });
        const base = (y: number, u: number) => transformar(t, fuente(y, u));
        let m = cuadricula(filas, [0, .33, .67, 1], fuente, base);
        const unida = cuadricula(filas, [0, .33, .67, 1], fuente, (y, u) => {
            const s = fuente(y, u), peso = Math.abs((s.x - manga.raiz) / (manga.extremo - manga.raiz));
            return punto(bordeMalla(y, manga.lado < 0 ? 0 : 1), transformar(t, { x: manga.extremo, y }), peso);
        });
        // Caída natural de descanso anatómico: evita que mangas no articuladas o con codo oculto se proyecten horizontalmente
        const radioTeorico = Math.max(1, (g.axila - manga.arriba) / 2);
        const semiAncho = Math.min(ancho * 0.18, radioTeorico * t.escalaX);
        const fraccionManga = (y: number) => (y - manga.centro) / radioTeorico;

        const abajoEje = { x: -eje.y, y: eje.x };
        const lateralEje = { x: eje.x * (manga.lado < 0 ? -1 : 1), y: eje.y * (manga.lado < 0 ? -1 : 1) };
        const dirDescanso = {
            x: abajoEje.x * 0.82 + lateralEje.x * 0.57,
            y: abajoEje.y * 0.82 + lateralEje.y * 0.57
        };
        const normaDescanso = Math.hypot(dirDescanso.x, dirDescanso.y) || 1;
        const dirEfectiva = { x: dirDescanso.x / normaDescanso, y: dirDescanso.y / normaDescanso };
        const normalEfectiva = { x: -manga.lado * dirEfectiva.y, y: manga.lado * dirEfectiva.x };
        const largoDescanso = Math.min(ancho * 0.55, Math.abs(manga.extremo - manga.raiz) * t.escalaX);
        const descansada = cuadricula(filas, [0, .33, .67, 1], fuente, (y, u) => {
            const s = fuente(y, u), peso = Math.abs((s.x - manga.raiz) / (manga.extremo - manga.raiz));
            const raiz = bordeMalla(Math.min(g.axila, y), manga.lado < 0 ? 0 : 1);
            const offset = fraccionManga(y) * (semiAncho * 0.75);
            const extremo = {
                x: h.x + dirEfectiva.x * largoDescanso + normalEfectiva.x * offset,
                y: h.y + dirEfectiva.y * largoDescanso + normalEfectiva.y * offset
            };
            return punto(raiz, extremo, peso);
        });
        if (mallaSegura(descansada)) m = descansada;
        else if (mallaSegura(unida)) m = unida;

        let mallaAntebrazoValida: MallaTextura | null = null;
        let antebrazoEnPecho = false;

        if (visible(c) && distancia(h, c) > ancho * .15) {
            const brazo = distancia(h, c), dir = { x: (c.x - h.x) / brazo, y: (c.y - h.y) / brazo };
            const normal = { x: -manga.lado * dir.y, y: manga.lado * dir.x };
            const normalTubular = { x: dir.y, y: -dir.x };
            const proyeccion = (p: P) => (p.x - h.x) * dir.x + (p.y - h.y) * dir.y;
            const longitudBase = Math.max(Math.abs(manga.extremo - manga.raiz) * t.escalaX, Math.max(proyeccion(bordeMalla(manga.arriba, manga.lado < 0 ? 0 : 1)), proyeccion(bordeMalla(g.axila, manga.lado < 0 ? 0 : 1))) + ancho * .08);
            const longitud = esLarga ? brazo : Math.min(brazo * 1.25, longitudBase);
            for (const factor of (esLarga ? [1, 0.95, 1.05] : [1, 1.15, 1.35, 0.85, 0.70])) {
                const largo = longitud * factor;
                if (!esLarga && largo > brazo * 1.35)
                    continue;
                const candidata = cuadricula(filas, [0, .33, .67, 1], fuente, (y, u) => {
                    if (esLarga) {
                        const fracY = (y - manga.arriba) / (yCodo - manga.arriba);
                        const posHueso = punto(h, c, fracY);
                        const offset = (u - 0.5) * (semiAncho * 2);
                        const posTubo = {
                            x: posHueso.x + normalTubular.x * offset,
                            y: posHueso.y + normalTubular.y * offset
                        };
                        const esBordeTorso = manga.lado < 0 ? (u > 0.6) : (u < 0.4);
                        if (fracY < 0.5 && esBordeTorso) {
                            const pesoSeam = (1 - fracY / 0.5) * (manga.lado < 0 ? (u - 0.6) / 0.4 : (0.4 - u) / 0.4);
                            const raizSisa = bordeMalla(Math.min(g.axila, y), manga.lado < 0 ? 0 : 1);
                            return punto(posTubo, raizSisa, pesoSeam * 0.6);
                        }
                        return posTubo;
                    } else {
                        const s = fuente(y, u), peso = Math.abs((s.x - manga.raiz) / (manga.extremo - manga.raiz));
                        const raiz = bordeMalla(y, manga.lado < 0 ? 0 : 1);
                        const offset = fraccionManga(y) * semiAncho;
                        const extremo = {
                            x: h.x + dir.x * largo + normal.x * offset,
                            y: h.y + dir.y * largo + normal.y * offset
                        };
                        return punto(raiz, extremo, peso);
                    }
                });
                if (mallaSegura(candidata)) {
                    m = candidata;
                    codosArticulados++;
                    break;
                }
            }
            // Articulación de segundo segmento (antebrazo y puño) si la manga es larga
            if (esLarga && filasAntebrazo.length > 0) {
                const munecaVisible = visible(w) && distancia(c, w) > ancho * .12;
                const largoF = munecaVisible ? Math.min(distancia(c, w), brazo * 1.25) : brazo * .90;
                const dirF = munecaVisible ? { x: (w.x - c.x) / distancia(c, w), y: (w.y - c.y) / distancia(c, w) } : dir;
                const normalF = { x: dirF.y, y: -dirF.x };
                const candidataAntebrazo = cuadricula(filasAntebrazo, [0, .33, .67, 1], fuente, (y, u) => {
                    const frac = (y - yCodo) / (manga.abajo! - yCodo);
                    const posHueso = punto(c, { x: c.x + dirF.x * largoF, y: c.y + dirF.y * largoF }, frac);
                    const normalActual = punto(normalTubular, normalF, frac);
                    const factorEstrechar = mezclar(1.0, 0.78, frac);
                    const offset = (u - 0.5) * (semiAncho * 2 * factorEstrechar);
                    return {
                        x: posHueso.x + normalActual.x * offset,
                        y: posHueso.y + normalActual.y * offset
                    };
                });
                if (mallaSegura(candidataAntebrazo)) {
                    mallaAntebrazoValida = candidataAntebrazo;
                    antebrazoEnPecho = munecaVisible && (w.x - si.x) * (sd.x - w.x) > 0 && w.y < (hi.y || sd.y + ancho);
                }
            }
        } else if (esLarga && filasAntebrazo.length > 0) {
            // Caída de antebrazo en descanso anatómico cuando el codo está oculto
            const largoFDescanso = largoDescanso * 0.9;
            const posCodoDescanso = { x: h.x + dirEfectiva.x * largoDescanso, y: h.y + dirEfectiva.y * largoDescanso };
            const descansadaAntebrazo = cuadricula(filasAntebrazo, [0, .33, .67, 1], fuente, (y, u) => {
                const frac = (y - yCodo) / (manga.abajo! - yCodo);
                const posHueso = punto(posCodoDescanso, { x: posCodoDescanso.x + dirEfectiva.x * largoFDescanso, y: posCodoDescanso.y + dirEfectiva.y * largoFDescanso }, frac);
                const offset = (u - 0.5) * (semiAncho * 1.5);
                return {
                    x: posHueso.x + normalEfectiva.x * offset,
                    y: posHueso.y + normalEfectiva.y * offset
                };
            });
            if (mallaSegura(descansadaAntebrazo)) {
                mallaAntebrazoValida = descansadaAntebrazo;
            }
        }
        regiones.push(m);
        if (mallaAntebrazoValida) {
            if (antebrazoEnPecho) antebrazosDelante.push(mallaAntebrazoValida);
            else regiones.push(mallaAntebrazoValida);
        }
    }
    regiones.push(torso); // torso por encima de la unión; comparte exactamente las raíces de las mangas
    regiones.push(...antebrazosDelante); // antebrazos cruzados al frente se dibujan sobre el torso
    return { regiones, codosArticulados, torsoEstimado: !completo };
}
