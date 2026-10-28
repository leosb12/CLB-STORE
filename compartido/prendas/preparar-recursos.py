"""Empaqueta fotografías originales sin modificarlas y genera el encuadre SVG del probador.

El SVG conserva el lienzo/anclas 420×460 existentes, por lo que no cambia MoveNet ni el contrato v1.
No descarga nada: las fotos originales y este manifiesto quedan disponibles para builds sin Internet.
"""
import base64
import hashlib
import html
import json
import pathlib
import shutil
import struct

CARPETA = pathlib.Path(__file__).resolve().parent
RAIZ = CARPETA.parent.parent
DESTINOS = [RAIZ / 'aplicaciones/web/public/prendas', RAIZ / 'aplicaciones/android/assets/prendas']
ANCLAS = {'superior': (155, 266, 96, 381), 'pantalon': (147, 273, 83, 379), 'vestido': (170, 250, 82, 379)}


def generar():
    prendas = json.loads((CARPETA / 'catalogo.json').read_text(encoding='utf-8'))
    creditos = ['Fotografías de prendas: PNGimg.com. Colección de demostración académica.',
                'Licencia indicada por la fuente: CC BY-NC 4.0 — https://creativecommons.org/licenses/by-nc/4.0/',
                'Fuente y condiciones: https://pngimg.com/license/',
                'Fotos originales sin cambios. El SVG únicamente define su encuadre para el probador 2D.', '']
    for p in prendas:
        original = CARPETA / 'originales' / (p['archivo'] + '.png')
        datos = original.read_bytes()
        if datos[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError(f'No es un PNG: {original.name}')
        ancho, alto = struct.unpack('>II', datos[16:24])
        izquierda, derecha, arriba, abajo = p['anclas']
        if not (0 <= izquierda < derecha <= ancho and 0 <= arriba < abajo <= alto):
            raise ValueError(f'Anclas inválidas: {original.name}')
        ti, td, ta, tb = ANCLAS[p['tipo']]
        sx, sy = (td-ti)/(derecha-izquierda), (tb-ta)/(abajo-arriba)
        x, y = ti-izquierda*sx, ta-arriba*sy
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
               f'width="420" height="460" viewBox="0 0 420 460">'
               f'<title>{html.escape(p["nombre"])}</title><desc>Fotografía: PNGimg.com, CC BY-NC 4.0. {p["fuente"]}</desc>'
               f'<image x="{x:.6f}" y="{y:.6f}" width="{ancho*sx:.6f}" height="{alto*sy:.6f}" '
               f'preserveAspectRatio="none" xlink:href="data:image/png;base64,{base64.b64encode(datos).decode()}"/></svg>')
        for destino in DESTINOS:
            destino.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, destino / original.name)
            (destino / (p['archivo'] + '.svg')).write_text(svg, encoding='utf-8')
        creditos.append(f'{p["sku"]}: {p["nombre"]} — {p["fuente"]} — SHA-256 {hashlib.sha256(datos).hexdigest()}')
    texto = '\n'.join(creditos) + '\n'
    for destino in [CARPETA, *DESTINOS]:
        (destino / 'CREDITOS.txt').write_text(texto, encoding='utf-8')
    # Tablas explícitas, generadas del mismo manifiesto: jamás se construye una ruta con un SKU remoto.
    mapa = {p['sku']: p['archivo'] for p in prendas}
    ts = '// Generado por compartido/prendas/preparar-recursos.py.\nexport const FOTOS_PRENDAS: Readonly<Record<string, string>> = ' + json.dumps(mapa, ensure_ascii=False, indent=2) + ';\n'
    (RAIZ / 'aplicaciones/web/fuente/catalogo/dominio/fotos-prendas.ts').write_text(ts, encoding='utf-8')
    dart = '// Generado por compartido/prendas/preparar-recursos.py.\nconst fotosPrendas = <String, String>{\n' + ''.join(f"  '{k}': '{v}',\n" for k, v in mapa.items()) + '};\n'
    (RAIZ / 'aplicaciones/android/lib/dominio/fotos_prendas.dart').write_text(dart, encoding='utf-8')
    print(f'{len(prendas)} fotografías y encuadres empaquetados para Web y Android.')


if __name__ == '__main__':
    generar()
