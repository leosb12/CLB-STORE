"""Pruebas de contrato y rechazo. No sustituyen la evaluación fotográfica independiente."""

import hashlib
import io
import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from fuente.aplicacion.preparar_prenda import PrepararPrenda
from fuente.dominio.prendas import AnclasPrenda, PrendaNoPreparada
from fuente.infraestructura.prendas_onnx import (
    PreparadorU2Net,
    abrir_original,
    extraer_anclas,
    refinar_alfa,
)
from fuente.infraestructura.worker_prendas import ProcesadorAislado
from PIL import Image


def test_refinado_alfa_elimina_rebabas_y_motas_sin_cerrar_huecos_ni_ocultar_otra_prenda():
    alfa = np.zeros((300, 400), np.uint8)
    alfa[40:260, 40:200] = 255
    alfa[70:100, 90:130] = 0
    alfa[150, 200:206] = 255
    alfa[20:22, 250:252] = 255
    alfa[80:240, 280:360] = 255
    salida = refinar_alfa(alfa)
    assert salida[20:22, 250:252].max() == 0
    assert salida[150, 204] == 0
    assert salida[85, 110] == 0  # abertura conservada
    assert salida[120, 300] == 255  # segundo objeto: no ocultar un caso inválido
    assert np.count_nonzero((salida > 0) & (salida < 255)) > 100
    assert abs(int((salida >= 128).sum()) - int((alfa >= 128).sum())) / (alfa >= 128).sum() < 0.01


@pytest.mark.parametrize("fallo", ["timeout", "desconexion"])
def test_worker_libera_proceso_tras_fallo_y_no_conserva_sesion_rota(fallo):
    class Proceso:
        vivo = True

        def is_alive(self):
            return self.vivo

        def terminate(self):
            self.vivo = False

        def join(self, *_):
            pass

    class Conexion:
        cerrada = False

        def send(self, _):
            if fallo == "desconexion":
                raise BrokenPipeError

        def poll(self, _):
            return False

        def close(self):
            self.cerrada = True

    worker = ProcesadorAislado("modelo-local", "sha")
    proceso, conexion = Proceso(), Conexion()
    worker.proceso, worker.conexion = proceso, conexion
    resultado, textura, maestro, espalda = worker.ejecutar(b"original", "Poleras")
    assert resultado["estado"] == "ERROR"
    assert textura is maestro is None
    assert conexion.cerrada and not proceso.vivo
    assert worker.proceso is worker.conexion is None


def test_anclas_rechazan_nan_e_inversion():
    with pytest.raises(PrendaNoPreparada):
        AnclasPrenda(0.8, 0.2, 0.1, 0.9, (0.5, 0.15), 0.4, 0.9)
    with pytest.raises(PrendaNoPreparada):
        AnclasPrenda(0.2, 0.8, 0.1, 0.9, (0.5, 0.15), float("nan"), 0.9)


def test_categoria_no_soportada_no_infiere():
    class NoDebeProcesar:
        def preparar(self, _):
            pytest.fail("No debe ejecutar el modelo para una categoría no soportada")

    with pytest.raises(PrendaNoPreparada):
        PrepararPrenda(NoDebeProcesar()).ejecutar(b"", "Calzado")


def test_entrada_segura_y_exif_eliminable():
    with pytest.raises(PrendaNoPreparada):
        abrir_original(b"<svg onload='alert(1)'/>")
    with pytest.raises(PrendaNoPreparada):
        abrir_original(b"a" * (10 * 1024 * 1024 + 1))
    imagen = Image.new("RGB", (200, 300), "red")
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "metadato privado"
    salida = io.BytesIO()
    imagen.save(salida, format="JPEG", exif=exif)
    normalizada = abrir_original(salida.getvalue())
    assert normalizada.size == (300, 200)
    assert normalizada.info == {}
    from fuente.infraestructura.prendas_onnx import codificar

    with Image.open(io.BytesIO(codificar(normalizada, 1024))) as png:
        assert not png.getexif()
        assert "icc_profile" not in png.info


def test_silueta_sintetica_y_rechazo_de_objetos_multiples():
    mascara = np.zeros((400, 400), np.uint8)
    puntos = np.array(
        [
            [150, 40],
            [180, 40],
            [200, 70],
            [220, 40],
            [250, 40],
            [330, 130],
            [285, 170],
            [255, 130],
            [255, 350],
            [145, 350],
            [145, 130],
            [115, 170],
            [70, 130],
        ],
        np.int32,
    )
    cv2.fillPoly(mascara, [puntos], 255)
    anclas = extraer_anclas(mascara)
    assert anclas.izquierda < 0.5 < anclas.derecha
    assert anclas.arriba < anclas.pecho < anclas.abajo
    mascara[:] = 0
    cv2.rectangle(mascara, (40, 40), (140, 350), 255, -1)
    cv2.rectangle(mascara, (230, 40), (330, 350), 255, -1)
    with pytest.raises(PrendaNoPreparada, match="varios objetos"):
        extraer_anclas(mascara)


def test_no_descarga_modelo_faltante_ni_acepta_hash_incorrecto(tmp_path, monkeypatch):
    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_args, **_kw: pytest.fail("No debe acceder a Internet"))
    with pytest.raises(RuntimeError, match="MODELO_PRENDAS_NO_DISPONIBLE"):
        PreparadorU2Net(str(tmp_path / "ausente.onnx"), "a" * 64)
    falso = tmp_path / "falso.onnx"
    falso.write_bytes(b"no es un modelo")
    with pytest.raises(RuntimeError, match="MODELO_PRENDAS_NO_DISPONIBLE"):
        PreparadorU2Net(str(falso), "a" * 64)


def test_inferencia_onnx_real_sin_descarga(monkeypatch):
    raiz = Path(__file__).resolve().parents[1]
    modelo = raiz / "modelos-prendas/u2net.onnx"
    if not modelo.exists():
        pytest.skip("Preparar pesos locales antes de la prueba real; no se descargan durante pytest")
    import urllib.request

    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *_args, **_kw: pytest.fail("No debe descargar durante inferencia")
    )
    manifiesto = json.loads((raiz / "modelos-prendas/manifiesto.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(modelo.read_bytes()).hexdigest() == manifiesto["sha256"]
    preparador = PreparadorU2Net(str(modelo), manifiesto["sha256"])
    # Un fondo vacío debe rechazarse, nunca convertirse en una prenda publicable.
    salida = io.BytesIO()
    Image.new("RGB", (400, 400), "white").save(salida, format="PNG")
    with pytest.raises(PrendaNoPreparada):
        preparador.preparar(salida.getvalue())

    # Regresión: también las prendas superiores nuevas deben llegar a CatVTON
    # sin depender del orden de anclas del probador local anterior.
    foto = raiz.parents[1] / "compartido/prendas/originales/camisa.png"
    preparada = PrepararPrenda(preparador).ejecutar(foto.read_bytes(), "Camisas")
    assert preparada.metadatos["esquema"] == 2
    assert preparada.metadatos["tipo"] == "superior"
    assert "anclas" not in preparada.metadatos
    with Image.open(io.BytesIO(preparada.textura)) as imagen:
        assert imagen.size == (768, 1024)
        assert imagen.mode == "RGBA"
        assert imagen.getchannel("A").getextrema() == (0, 255)
