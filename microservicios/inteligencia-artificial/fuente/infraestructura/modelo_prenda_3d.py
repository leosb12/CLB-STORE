"""Modelo 3D de una prenda a partir de su fotografía frontal normalizada (768×1024 RGBA).

Separa torso, cuello, mangas y perneras de la silueta y deduce la espalda: el frente reflejado, sin logos, cierres ni
botones (inpainting de OpenCV) y con las franjas horizontales conservadas, que sí dan la vuelta a la prenda. El cliente
construye la malla y la ajusta al cuerpo que ve la cámara. Todas las coordenadas van normalizadas a la textura (0..1).
"""

import io

import cv2
import numpy as np
from PIL import Image

from fuente.dominio.prendas import PrendaNoPreparada, validar_modelo_3d

ESTACIONES = 8
FILAS_TORSO = 14


def _mascara(rgba: np.ndarray) -> np.ndarray:
    m = (rgba[..., 3] > 128).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, etiquetas, datos, _ = cv2.connectedComponentsWithStats(m, 8)
    if n < 2:
        raise PrendaNoPreparada("No se encontró la silueta de la prenda.")
    mayor = 1 + int(np.argmax(datos[1:, cv2.CC_STAT_AREA]))
    return etiquetas == mayor


def _tramo(fila: np.ndarray, centro: int, busqueda: int) -> tuple[int, int] | None:
    """Extensión opaca alrededor del centro; si el centro es un hueco (cuello o cierre abierto), une ambos lados."""
    ancho = fila.size
    if not fila[centro]:
        izq = next((x for x in range(centro, max(-1, centro - busqueda), -1) if fila[x]), None)
        der = next((x for x in range(centro, min(ancho, centro + busqueda)) if fila[x]), None)
        if izq is None or der is None:
            return None
    else:
        izq = der = centro
    while izq > 0 and fila[izq - 1]:
        izq -= 1
    while der < ancho - 1 and fila[der + 1]:
        der += 1
    return izq, der


def _estaciones(puntos: np.ndarray, raiz: np.ndarray) -> list[list[float]] | None:
    """Eje principal (PCA) de una manga o pernera, de la raíz a la punta, con su radio en cada estación."""
    if len(puntos) < 200:
        return None
    media = puntos.mean(0)
    _, _, ejes = np.linalg.svd(puntos - media, full_matrices=False)
    eje = ejes[0]
    t = (puntos - media) @ eje
    if np.dot(raiz - media, eje) > 0:  # la raíz queda en t mínimo
        eje, t = -eje, -t
    normal = np.array([-eje[1], eje[0]])
    s = (puntos - media) @ normal
    lo, hi = np.percentile(t, 1), np.percentile(t, 99)
    paso = (hi - lo) / (ESTACIONES - 1)
    salida = []
    for k in range(ESTACIONES):
        tk = lo + k * paso
        sel = np.abs(t - tk) <= max(2.0, paso * 0.5)
        if sel.sum() < 4:
            return None
        a, b = np.percentile(s[sel], 2), np.percentile(s[sel], 98)
        centro = media + eje * tk + normal * (a + b) / 2
        salida.append([float(centro[0]), float(centro[1]), float(max(1.0, (b - a) / 2))])
    return salida


def _superior(m: np.ndarray) -> dict:
    alto, ancho = m.shape
    ys, xs = np.nonzero(m)
    arriba, abajo = int(ys.min()), int(ys.max())
    h = abajo - arriba
    cx = int(np.median(xs))
    tramos = {y: _tramo(m[y], cx, int(ancho * 0.2)) for y in range(arriba, abajo + 1)}
    anchos = {y: (t[1] - t[0]) if t else 0 for y, t in tramos.items()}
    # Ancho del torso en la banda del dobladillo, donde el torso queda separado de los puños: los lados de la prenda
    # suben casi verticales desde ahí. Lo que queda fuera de esos lados son las mangas, cuelguen o estén extendidas.
    banda = [y for y in range(arriba + int(h * 0.78), arriba + int(h * 0.97)) if tramos[y]]
    if not banda:
        raise PrendaNoPreparada("No se reconoce el dobladillo de la prenda.")
    ancho_torso = float(np.percentile([anchos[y] for y in banda], 20))
    centro_torso = float(np.median([(tramos[y][0] + tramos[y][1]) / 2 for y in banda]))
    axila = next((y for y in range(arriba + int(h * 0.12), arriba + int(h * 0.6)) if anchos[y] <= ancho_torso * 1.06), arriba + int(h * 0.3))

    def bordes(y: int) -> tuple[float, float]:
        t = tramos[y] or (centro_torso, centro_torso)
        return max(float(t[0]), centro_torso - ancho_torso / 2), min(float(t[1]), centro_torso + ancho_torso / 2)

    # Cuello: hueco central superior (o la parte alta del cuello levantado de una chaqueta).
    fila_cuello = next((y for y in range(arriba, arriba + int(h * 0.3)) if m[y, cx]), arriba)
    hueco = [y for y in range(arriba, fila_cuello)]
    if hueco:
        t = tramos[arriba + 1] or (cx - ancho_torso * 0.2, cx + ancho_torso * 0.2)
        fila = m[arriba + 1]
        izq = next((x for x in range(cx, int(t[0]) - 1, -1) if fila[x]), cx)
        der = next((x for x in range(cx, int(t[1]) + 1) if fila[x]), cx)
        cuello = [arriba / alto, izq / ancho, der / ancho, fila_cuello / alto]
    else:
        cuello = [arriba / alto, (cx - ancho_torso * 0.18) / ancho, (cx + ancho_torso * 0.18) / ancho, arriba / alto]
    hombro_y = arriba + int(h * 0.05)
    filas = np.linspace(hombro_y, abajo, FILAS_TORSO).astype(int)
    torso = [[y / alto, *(v / ancho for v in bordes(int(y)))] for y in filas]

    # Mangas: lo opaco fuera del torso, a cada lado.
    region = np.zeros_like(m)
    for y in range(arriba, abajo + 1):
        izq, der = centro_torso - ancho_torso / 2, centro_torso + ancho_torso / 2
        region[y, max(0, int(izq)):int(der) + 1] = True
    mangas = []
    resto = m & ~region
    for lado, mitad in ((-1, resto[:, :cx]), (1, resto[:, cx:])):
        n, etiquetas, datos, _ = cv2.connectedComponentsWithStats(mitad.astype(np.uint8), 8)
        if n < 2:
            continue
        mayor = 1 + int(np.argmax(datos[1:, cv2.CC_STAT_AREA]))
        if datos[mayor, cv2.CC_STAT_AREA] < m.sum() * 0.02:
            continue
        py, px = np.nonzero(etiquetas == mayor)
        puntos = np.stack([px + (0 if lado < 0 else cx), py], 1).astype(float)
        raiz_x = centro_torso + (ancho_torso / 2) * lado
        estaciones = _estaciones(puntos, np.array([raiz_x, float(hombro_y)]))
        # Una manga nace arriba: lo que sobresale abajo (vuelo de una falda) es parte del cuerpo de la prenda.
        if estaciones and estaciones[0][1] < arriba + h * 0.5:
            largo = float(np.hypot(estaciones[-1][0] - estaciones[0][0], estaciones[-1][1] - estaciones[0][1]))
            mangas.append({"lado": lado, "larga": largo > h * 0.45,
                           "eje": [[x / ancho, y / alto, r / ancho] for x, y, r in estaciones]})
    return {"axila": axila / alto, "cuello": cuello, "torso": torso, "mangas": mangas}


def _inferior(m: np.ndarray) -> dict:
    alto, ancho = m.shape
    ys, xs = np.nonzero(m)
    arriba, abajo = int(ys.min()), int(ys.max())
    h = abajo - arriba
    cx = int(np.median(xs))
    # Entrepierna: primera fila bajo la cintura con hueco en el centro.
    entrepierna = next((y for y in range(arriba + int(h * 0.15), arriba + int(h * 0.7)) if not m[y, cx - 2:cx + 3].any()), None)
    if entrepierna is None:
        raise PrendaNoPreparada("No se distinguen las dos perneras del pantalón.")
    cadera = []
    for y in np.linspace(arriba, entrepierna, 5).astype(int):
        t = _tramo(m[y], cx, int(ancho * 0.2))
        if t:
            cadera.append([y / alto, t[0] / ancho, t[1] / ancho])
    piernas = []
    for lado, x0, x1 in ((-1, 0, cx), (1, cx, ancho)):
        sub = m[entrepierna:abajo + 1, x0:x1]
        py, px = np.nonzero(sub)
        puntos = np.stack([px + x0, py + entrepierna], 1).astype(float)
        estaciones = _estaciones(puntos, np.array([(x0 + x1) / 2, float(entrepierna)]))
        if not estaciones:
            raise PrendaNoPreparada("Una pernera no se reconoce completa.")
        piernas.append({"lado": lado, "eje": [[x / ancho, y / alto, r / ancho] for x, y, r in estaciones]})
    return {"cintura": arriba / alto, "entrepierna": entrepierna / alto, "cadera": cadera, "piernas": piernas}


def _espalda(rgba: np.ndarray, m: np.ndarray, superior: dict | None) -> np.ndarray:
    """Frente reflejado sin detalles locales: los logos, cierres y botones no se repiten atrás; las franjas sí."""
    rgb = rgba[..., :3].copy()
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    peso = m.astype(np.float32)
    # Suavizado solo horizontal (normalizado por la silueta): una franja es constante a lo largo de su fila y no se marca;
    # un logo, un cierre o un botón se apartan de su fila y sí.
    nucleo = (61, 3)
    suave = cv2.boxFilter(lab * peso[..., None], -1, nucleo, normalize=False) / np.maximum(cv2.boxFilter(peso, -1, nucleo, normalize=False), 1e-3)[..., None]
    distancia = np.sqrt(((lab - suave) ** 2).sum(-1))
    detalle = ((distancia > 13) & m).astype(np.uint8)
    detalle = cv2.morphologyEx(detalle, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, etiquetas, datos, _ = cv2.connectedComponentsWithStats(detalle, 8)
    retirar = np.zeros(m.shape, np.uint8)
    total = m.sum()
    for k in range(1, n):
        # El jaspeado o la trama del tejido dan motas diminutas: no son detalles y se dejan tal cual.
        if total * 0.0006 <= datos[k, cv2.CC_STAT_AREA] <= total * 0.05:
            retirar[etiquetas == k] = 1
    # Abertura central (chaqueta abierta, forro visible): atrás la prenda es cerrada y del color general.
    color = np.median(rgb[m], 0)
    lejos = (np.abs(rgb.astype(np.float32) - color).max(-1) > 70) & m
    alto, ancho = m.shape
    cols = np.nonzero(m.any(0))[0]
    centro = int(np.median(cols))
    franja = slice(max(0, centro - int(ancho * 0.08)), centro + int(ancho * 0.08))
    if lejos[:, franja].sum() > m[:, franja].sum() * 0.45:
        retirar[:, franja] |= lejos[:, franja].astype(np.uint8)
    if superior:
        # Atrás no hay botonadura, cierre central ni etiqueta frontal: franja central y zona bajo el cuello.
        _, xi, xd, y1 = superior["cuello"]
        cx = int((xi + xd) / 2 * ancho)
        filas = [fila[0] for fila in superior["torso"]]
        arriba_t, abajo_t = int(min(filas) * alto), int(max(filas) * alto)
        # La botonadura o el cierre es la columna cercana al centro con el borde vertical más continuo.
        gx = np.abs(cv2.Sobel(lab[..., 0], cv2.CV_32F, 1, 0, ksize=3))[arriba_t:abajo_t]
        busca = range(max(2, cx - int(ancho * 0.08)), min(ancho - 2, cx + int(ancho * 0.08)))
        continuidad = [float((gx[:, x - 2:x + 3].max(1) > 25).mean()) for x in busca]
        if continuidad and max(continuidad) > 0.35:
            cx = list(busca)[int(np.argmax(continuidad))]
        franja_central = (cx, int(ancho * 0.03), arriba_t, abajo_t)
        y_c = int(y1 * alto)
        retirar[y_c:y_c + int(alto * 0.07), cx - int(ancho * 0.07):cx + int(ancho * 0.07)] |= detalle[y_c:y_c + int(alto * 0.07), cx - int(ancho * 0.07):cx + int(ancho * 0.07)] | lejos[y_c:y_c + int(alto * 0.07), cx - int(ancho * 0.07):cx + int(ancho * 0.07)].astype(np.uint8)
    # Borde exterior de la silueta: no es un detalle.
    retirar &= cv2.erode(m.astype(np.uint8), np.ones((9, 9), np.uint8))
    retirar = cv2.dilate(retirar, np.ones((7, 7), np.uint8)) & m.astype(np.uint8)
    limpio = cv2.inpaint(rgb, retirar * 255, 9, cv2.INPAINT_TELEA)
    if superior:
        # Franja central: tela vecina copiada (conserva el jaspeado y las franjas de cada fila) con bordes fundidos.
        x, mitad, y0, y1 = franja_central
        origen = slice(x + mitad, x + 3 * mitad)
        if origen.stop < ancho:
            rampa = np.minimum(1.0, np.minimum(np.arange(2 * mitad) + 1, 2 * mitad - np.arange(2 * mitad)) / (mitad * 0.5))[None, :, None]
            destino = limpio[y0:y1, x - mitad:x + mitad].astype(np.float32)
            copia = limpio[y0:y1, origen].astype(np.float32)
            dentro = m[y0:y1, x - mitad:x + mitad, None] & m[y0:y1, origen, None]
            limpio[y0:y1, x - mitad:x + mitad] = np.where(dentro, destino * (1 - rampa) + copia * rampa, destino).astype(np.uint8)
    alfa = rgba[..., 3].copy()
    if superior:
        # La espalda no tiene la abertura del cuello delantero: se cierra salvo una curva poco profunda.
        alto, ancho = m.shape
        y0, xi, xd, y1 = superior["cuello"]
        y0, y1, xi, xd = int(y0 * alto), int(y1 * alto), int(xi * ancho), int(xd * ancho)
        if y1 > y0 + 2 and xd > xi:
            cierre = np.zeros(m.shape, np.uint8)
            prof = y0 + int((y1 - y0) * 0.3)
            cierre[prof:y1 + 1, xi:xd + 1] = 1
            alfa = np.where(cierre > 0, 255, alfa).astype(np.uint8)
            # Color de la tela bajo el cuello (no el forro interior, que suele ser de otro color).
            debajo = limpio[y1 + 2:y1 + 12, xi:xd + 1].reshape(-1, 3)
            tela = np.median(debajo, 0) if len(debajo) else color
            limpio[cierre > 0] = tela
            # Lo que se ve por la abertura delantera (interior y etiqueta de la espalda) es tela por fuera.
            interior = np.zeros(m.shape, bool)
            interior[y0:y1 + 1, xi:xd + 1] = m[y0:y1 + 1, xi:xd + 1]
            limpio[interior] = tela
    espalda = np.dstack([limpio, alfa])
    return espalda[:, ::-1].copy()


def _redondear(v):
    if isinstance(v, float):
        return round(v, 4)
    if isinstance(v, list):
        return [_redondear(x) for x in v]
    if isinstance(v, dict):
        return {k: _redondear(x) for k, x in v.items()}
    return v


def construir_modelo_3d(textura_png: bytes, tipo: str) -> tuple[dict, bytes]:
    """`tipo`: superior, inferior o completo (vestido). Devuelve el modelo validado y la espalda deducida en PNG."""
    imagen = Image.open(io.BytesIO(textura_png)).convert("RGBA")
    if imagen.size != (768, 1024):
        raise PrendaNoPreparada("El modelo 3D necesita la textura normalizada de 768×1024.")
    rgba = np.asarray(imagen).copy()
    m = _mascara(rgba)
    superior = _superior(m) if tipo in ("superior", "completo") else None
    inferior = _inferior(m) if tipo == "inferior" else None
    torso = rgba[..., :3][m]
    modelo = {
        "version": 1, "tipo": tipo, "espalda": "deducida",
        "color": [int(v) for v in np.median(torso, 0)],
        **({"superior": superior} if superior else {}),
        **({"inferior": inferior} if inferior else {}),
    }
    # Cuatro decimales (0,1 px de textura): el modelo cabe holgado en los 16 KB de metadatos de Inventario.
    modelo = _redondear(modelo)
    validar_modelo_3d(modelo)
    salida = io.BytesIO()
    Image.fromarray(_espalda(rgba, m, superior)).save(salida, "PNG")
    return modelo, salida.getvalue()
