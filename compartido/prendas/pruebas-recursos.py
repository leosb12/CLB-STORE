"""Verifica los recursos reales que consumen ambas aplicaciones, sin acceso a Internet."""
import base64
import json
import pathlib
import re
import unittest
import xml.etree.ElementTree as XML

CARPETA = pathlib.Path(__file__).resolve().parent
RAIZ = CARPETA.parent.parent


class RecursosFotograficosTest(unittest.TestCase):
    def test_fotos_y_encuadres_son_identicos_offline_y_no_cargan_recursos_externos(self):
        prendas = json.loads((CARPETA / 'catalogo.json').read_text(encoding='utf-8'))
        self.assertEqual(len({p['sku'] for p in prendas}), 8)
        for p in prendas:
            original = (CARPETA / 'originales' / (p['archivo'] + '.png')).read_bytes()
            self.assertEqual(original[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(original[25], 6, 'La foto debe incluir canal alfa RGBA.')
            paquetes = []
            for destino in ['aplicaciones/web/public/prendas', 'aplicaciones/android/assets/prendas']:
                ruta = RAIZ / destino
                self.assertEqual((ruta / (p['archivo'] + '.png')).read_bytes(), original)
                svg = (ruta / (p['archivo'] + '.svg')).read_bytes()
                raiz = XML.fromstring(svg)
                self.assertEqual(raiz.attrib['viewBox'], '0 0 420 460')
                imagen = raiz.find('{http://www.w3.org/2000/svg}image')
                url = imagen.attrib['{http://www.w3.org/1999/xlink}href']
                self.assertTrue(url.startswith('data:image/png;base64,'))
                self.assertEqual(base64.b64decode(url.split(',', 1)[1]), original)
                self.assertIsNone(raiz.find('{http://www.w3.org/2000/svg}script'))
                self.assertIn(p['fuente'], (ruta / 'CREDITOS.txt').read_text(encoding='utf-8'))
                paquetes.append(svg)
            self.assertEqual(*paquetes)

    def test_manifiestos_de_ambos_clientes_tienen_la_misma_coleccion(self):
        prendas = json.loads((CARPETA / 'catalogo.json').read_text(encoding='utf-8'))
        ts = (RAIZ / 'aplicaciones/web/fuente/catalogo/dominio/fotos-prendas.ts').read_text(encoding='utf-8')
        dart = (RAIZ / 'aplicaciones/android/lib/dominio/fotos_prendas.dart').read_text(encoding='utf-8')
        for p in prendas:
            self.assertIn(f'"{p["sku"]}": "{p["archivo"]}"', ts)
            self.assertIn(f"'{p['sku']}': '{p['archivo']}'", dart)
        config = json.loads((RAIZ / 'aplicaciones/web/ngsw-config.json').read_text())
        self.assertIn('/prendas/**', config['assetGroups'][0]['resources']['files'])
        self.assertIn('assets/prendas/', (RAIZ / 'aplicaciones/android/pubspec.yaml').read_text())


if __name__ == '__main__':
    unittest.main()
