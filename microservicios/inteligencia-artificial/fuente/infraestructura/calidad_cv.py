"""Mide la silueta segmentada de una prenda para el estándar de calidad (`fuente/dominio/calidad_prenda.py`)."""

import cv2
import numpy as np

from fuente.dominio.calidad_prenda import MedidasPrenda


def fraccion_piel(rgb: np.ndarray, mascara: np.ndarray) -> float:
    """Píxeles de la prenda con color de piel (YCrCb, rango clásico de Chai y Ngan): manos, piernas o cara de una
    persona que la lleva puesta. Sin modelo extra; una prenda beige o rosada puede parecer piel, por eso solo avisa."""
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    piel = (ycrcb[..., 1] >= 138) & (ycrcb[..., 1] <= 173) & (ycrcb[..., 2] >= 77) & (ycrcb[..., 2] <= 127) & (ycrcb[..., 0] > 60)
    piel = cv2.morphologyEx((piel & mascara).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)
    return float(piel.sum() / max(1, mascara.sum()))


def medir_silueta(alfa: np.ndarray, tipo: str, modelo: dict | None, motivo_modelo: str = "", recorte: bool = False,
                  rgb: np.ndarray | None = None) -> MedidasPrenda:
    """`alfa`: transparencia 0..255 de la foto procesada completa (antes de recortar la prenda).

    `recorte`: la foto ya venía con fondo transparente (un PNG recortado). Ahí tocar el borde del lienzo es el recorte
    ajustado, no una prenda cortada por la cámara, así que no se marca.
    """
    alto, ancho = alfa.shape
    opaco = (alfa >= 128).astype(np.uint8)
    # Un cierre morfológico leve une el cuello o un cierre abierto con el resto de la prenda.
    unido = cv2.morphologyEx(opaco, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, etiquetas, datos, _ = cv2.connectedComponentsWithStats(unido, 8)
    areas = sorted(datos[1:, cv2.CC_STAT_AREA], reverse=True) if n > 1 else [0]
    principal = 1 + int(np.argmax(datos[1:, cv2.CC_STAT_AREA])) if n > 1 else 0
    if not principal:
        return MedidasPrenda(tipo, 0.0, 0.0, False, 0, 1.0, 0.0, 0.0, None, False, "no hay silueta")
    x, y, w, h = (int(v) for v in datos[principal, :4])
    mascara = (etiquetas == principal)[y : y + h, x : x + w]
    reflejo = mascara[:, ::-1]
    simetria = float(np.logical_and(mascara, reflejo).sum() / max(1, np.logical_or(mascara, reflejo).sum()))
    margen = max(2, int(min(alto, ancho) * 0.01))
    toca = not recorte and (x < margen or y < margen or x + w > ancho - margen or y + h > alto - margen)
    region = alfa[y : y + h, x : x + w]
    difuso = float(((region >= 32) & (region < 224)).sum() / max(1, (region >= 128).sum()))
    mangas = len(modelo["superior"]["mangas"]) if modelo and modelo.get("superior") else None
    piel = fraccion_piel(rgb[y : y + h, x : x + w], mascara) if rgb is not None else 0.0
    return MedidasPrenda(
        tipo=tipo,
        area=float(areas[0]) / (alto * ancho),
        segunda_pieza=float(areas[1]) / max(1, areas[0]) if len(areas) > 1 else 0.0,
        toca_borde=bool(toca),
        lado_px=min(w, h),
        aspecto=h / max(1, w),
        simetria=simetria,
        borde_difuso=difuso,
        mangas=mangas,
        modelo_3d=modelo is not None,
        motivo_modelo=motivo_modelo,
        piel=piel,
    )
