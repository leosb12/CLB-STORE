"""Estándar de calidad de la foto de una prenda: reglas del dominio y medición sobre siluetas sintéticas."""

from dataclasses import replace

import numpy as np

from fuente.dominio.calidad_prenda import MedidasPrenda, evaluar_prenda
from fuente.infraestructura.calidad_cv import medir_silueta

BUENA = MedidasPrenda(tipo="superior", area=0.4, segunda_pieza=0.0, toca_borde=False, lado_px=800, aspecto=1.2,
                      simetria=0.93, borde_difuso=0.02, mangas=2, modelo_3d=True)


def codigos(informe, nivel):
    return {c.codigo for c in informe.comprobaciones if c.nivel == nivel}


def test_foto_buena_es_apta_y_cada_comprobacion_tiene_mensaje():
    informe = evaluar_prenda(BUENA)
    assert informe.nivel == "apta" and informe.puntuacion == 100
    assert all(c.mensaje for c in informe.comprobaciones)


def test_lo_grave_bloquea():
    for cambio, codigo in [({"area": 0.01}, "PRENDA_NO_ENCONTRADA"), ({"segunda_pieza": 0.3}, "VARIAS_PIEZAS"),
                           ({"toca_borde": True}, "RECORTADA"), ({"lado_px": 200}, "RESOLUCION"),
                           ({"simetria": 0.4}, "SIMETRIA"), ({"aspecto": 3.0}, "FORMA")]:
        informe = evaluar_prenda(replace(BUENA, **cambio))
        assert informe.nivel == "no_apta" and codigo in codigos(informe, "bloqueo"), cambio
        assert informe.puntuacion == 0


def test_lo_menor_avisa_y_permite_publicar():
    informe = evaluar_prenda(replace(BUENA, simetria=0.7, lado_px=420, mangas=0))
    assert informe.nivel == "con_avisos"
    assert codigos(informe, "aviso") == {"SIMETRIA", "RESOLUCION", "MANGAS"}
    assert informe.puntuacion == 100 - 15 * 3


def test_sin_modelo_3d_bloquea_un_pantalon_pero_solo_avisa_en_una_prenda_superior():
    assert "MODELO_3D" in codigos(evaluar_prenda(replace(BUENA, tipo="inferior", aspecto=2.0, modelo_3d=False, mangas=None, motivo_modelo="sin perneras")), "bloqueo")
    assert "MODELO_3D" in codigos(evaluar_prenda(replace(BUENA, modelo_3d=False, mangas=None)), "aviso")


def silueta(ancho=400, alto=500):
    alfa = np.zeros((alto, ancho), np.uint8)
    alfa[100:400, 120:280] = 255
    return alfa


def test_medicion_simetria_varias_piezas_y_borde():
    m = medir_silueta(silueta(), "superior", None)
    assert m.simetria > 0.99 and m.segunda_pieza == 0 and not m.toca_borde and m.lado_px == 160
    otra = silueta()
    otra[20:80, 10:90] = 255
    assert medir_silueta(otra, "superior", None).segunda_pieza > 0.08
    cortada = silueta()
    cortada[100:500, 120:280] = 255
    assert medir_silueta(cortada, "superior", None).toca_borde
    # Un PNG ya recortado puede tocar el borde del lienzo sin estar cortado.
    assert not medir_silueta(cortada, "superior", None, recorte=True).toca_borde


def test_piel_visible_avisa_que_una_persona_lleva_la_prenda():
    rgb = np.zeros((500, 400, 3), np.uint8)
    rgb[...] = (40, 60, 120)  # mezclilla: no es piel
    assert medir_silueta(silueta(), "inferior", None, rgb=rgb).piel == 0
    rgb[300:360, 150:210] = (224, 172, 140)  # una mano sobre la prenda
    m = medir_silueta(silueta(), "superior", None, rgb=rgb)
    assert m.piel > 0.015
    assert "PERSONA" in codigos(evaluar_prenda(replace(BUENA, piel=m.piel)), "aviso")


def test_medicion_detecta_una_prenda_girada():
    girada = np.zeros((500, 400), np.uint8)
    for y in range(100, 400):
        x = 120 + (y - 100) // 2
        girada[y, x : x + 80] = 255
    assert medir_silueta(girada, "inferior", None).simetria < 0.55
