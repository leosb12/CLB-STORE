"""Pruebas del compositor aislado: no afirman fidelidad fotográfica."""

import json
import unittest
from pathlib import Path

import numpy as np
from material import componer, filtro_guiado
from PIL import Image

CARPETA = Path(__file__).resolve().parents[2] / "temporales/laboratorio-realismo"


class MaterialPrueba(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foto = np.asarray(
            Image.open(CARPETA / "persona-entrada.png").convert("RGB")
        )
        cls.probs = np.fromfile(CARPETA / "probabilidades.f32", np.float32).reshape(
            256, 256, 6
        )
        cls.pose = json.loads((CARPETA / "pose.json").read_text())
        # Material uniforme sintético: permite medir la iluminación sin sombras de origen.
        cls.textura = np.full((100, 100, 4), [75, 140, 105, 255], np.uint8)
        cls.resultado, cls.mascara = componer(
            cls.foto, cls.textura, cls.probs, cls.pose
        )

    def test_fondo_externo_exactamente_intacto(self):
        fondo = self.mascara == 0
        self.assertGreater(fondo.mean(), 0.4)
        np.testing.assert_array_equal(self.resultado[fondo], self.foto[fondo])

    def test_piel_y_cabello_de_alta_confianza_intactos(self):
        import cv2

        piel = (
            cv2.resize(self.probs[:, :, 1:4].sum(axis=2), self.foto.shape[1::-1]) > 0.9
        )
        self.assertGreater(piel.sum(), 1000)
        np.testing.assert_array_equal(self.resultado[piel], self.foto[piel])

    def test_conserva_orden_de_luz_de_los_pliegues(self):
        region = self.mascara > 0.99
        antes = self.foto.mean(axis=2)[region]
        despues = self.resultado.mean(axis=2)[region]
        self.assertGreater(np.corrcoef(antes, despues)[0, 1], 0.98)
        self.assertGreater(np.std(despues), 3)

    def test_no_modifica_entradas(self):
        original = self.foto.copy()
        probabilidades = self.probs.copy()
        componer(self.foto, self.textura, self.probs, self.pose)
        np.testing.assert_array_equal(original, self.foto)
        np.testing.assert_array_equal(probabilidades, self.probs)

    def test_rechaza_base_oscura(self):
        with self.assertRaisesRegex(ValueError, "camiseta base clara"):
            componer(self.foto // 3, self.textura, self.probs, self.pose)

    def test_rechaza_pose_sin_caderas(self):
        pose = [list(p) for p in self.pose]
        pose[11][2] = 0.1
        with self.assertRaisesRegex(ValueError, "caderas visibles"):
            componer(self.foto, self.textura, self.probs, pose)

    def test_rechaza_textura_transparente(self):
        textura = self.textura.copy()
        textura[:, :, 3] = 0
        with self.assertRaisesRegex(ValueError, "Textura de torso insuficiente"):
            componer(self.foto, textura, self.probs, self.pose)

    def test_rechaza_mascara_vacia(self):
        with self.assertRaisesRegex(ValueError, "No se identificó"):
            componer(self.foto, self.textura, np.zeros_like(self.probs), self.pose)

    def test_rechaza_mascara_nan(self):
        probs = self.probs.copy()
        probs[0, 0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "Máscara semántica inválida"):
            componer(self.foto, self.textura, probs, self.pose)

    def test_filtro_guiado_preserva_discontinuidad(self):
        guia = np.zeros((64, 64), np.float32)
        guia[:, 32:] = 1
        mascara = guia.copy()
        resultado = filtro_guiado(guia, mascara)
        self.assertLess(resultado[32, 30], 0.01)
        self.assertGreater(resultado[32, 33], 0.99)


if __name__ == "__main__":
    unittest.main(verbosity=2)
