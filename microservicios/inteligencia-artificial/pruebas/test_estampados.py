"""La detección protege regiones; no es generación de texto ni certificación visual."""

from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from fuente.infraestructura.estampados_onnx import DetectorEstampadosLocal

MODELO = Path(__file__).resolve().parents[1] / "modelos-prendas/texto-prenda.onnx"


def test_modelo_texto_faltante_o_modificado_se_rechaza(tmp_path):
    with pytest.raises(RuntimeError, match="MODELO_ESTAMPADOS_NO_DISPONIBLE"):
        DetectorEstampadosLocal(str(tmp_path / "ausente.onnx"))
    corrupto = tmp_path / "corrupto.onnx"
    corrupto.write_bytes(b"incorrecto")
    with pytest.raises(RuntimeError, match="MODELO_ESTAMPADOS_NO_DISPONIBLE"):
        DetectorEstampadosLocal(str(corrupto))


@pytest.mark.skipif(not MODELO.exists(), reason="Preparar el detector ONNX local antes de la prueba real")
def test_texto_sintetico_se_detecta_local_y_el_liso_no_inventa_zonas(monkeypatch):
    import socket

    def bloquear_red(*_args, **_kwargs):
        raise AssertionError("El detector de producto no debe abrir conexiones")

    monkeypatch.setattr(socket.socket, "connect", bloquear_red)
    detector = DetectorEstampadosLocal(str(MODELO))
    imagen = Image.new("RGBA", (512, 640), (145, 180, 160, 255))
    anclas = {"izquierda": .1, "derecha": .9, "arriba": .1, "abajo": .95}
    assert detector.detectar(imagen, anclas) == []
    dibujo = ImageDraw.Draw(imagen)
    dibujo.text((90, 180), "CLB STORE", font=ImageFont.load_default(size=55), fill=(220, 235, 225, 255))
    zonas = detector.detectar(imagen, anclas)
    assert zonas
    assert any(z[0] < .25 and z[1] < .34 and z[2] > .7 and z[3] > .34 for z in zonas)
    assert all(len(z) == 4 and 0 <= z[0] < z[2] <= 1 and 0 <= z[1] < z[3] <= 1 for z in zonas)
    assert detector.sesion.get_providers() == ["CPUExecutionProvider"]
