"""Da de alta prendas nuevas por la ingesta real del probador (no se empaquetan en la web ni en Android).

Para cada prenda de `compartido/prendas/ingesta/ingesta.json`: crea el producto y sus variantes con stock de prueba en
Inventario, sube la fotografía original, espera a que el worker la prepare (fondo, control de calidad, modelo 3D y
espalda) y la publica solo si cumple el estándar. Una foto con avisos no se publica sin `--aceptar-avisos`; una no apta
nunca. Claves deterministas: repetirlo no duplica productos, variantes, stock ni publicaciones.
Requiere el stack local con `CLB_RECURSOS_PROBADOR=true` y el worker de prendas (`--profile prendas`).
"""
import json
import pathlib
import runpy
import sys
import time
import urllib.error
import urllib.request

CARPETA = pathlib.Path(__file__).resolve().parent
RAIZ = CARPETA.parent.parent
APIS = runpy.run_path(str(CARPETA / 'sembrar-gestion.py'))
PASARELA = 'http://127.0.0.1:18000'


def multipart(ruta: str, campos: dict, archivo: pathlib.Path, clave: str, acceso: str):
    """POST multipart con la biblioteca estándar (sin dependencias)."""
    limite = 'clb' + clave.replace('-', '')
    partes = [f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in campos.items()]
    partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="imagen"; filename="{archivo.name}"\r\n'
                  'Content-Type: image/png\r\n\r\n'.encode() + archivo.read_bytes() + b'\r\n')
    cuerpo = b''.join(partes) + f'--{limite}--\r\n'.encode()
    solicitud = urllib.request.Request(PASARELA + ruta, cuerpo, method='POST', headers={
        'Content-Type': f'multipart/form-data; boundary={limite}', 'Idempotency-Key': clave,
        'Authorization': f'Bearer {acceso}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(solicitud, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')


def exigir(estado, cuerpo, que):
    if estado not in (200, 201, 202):
        raise SystemExit(f'{que}: Inventario respondió {estado}: {cuerpo}')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    aceptar = '--aceptar-avisos' in sys.argv
    env = APIS['leer_env']()
    admin = APIS['token']('admin.demo', env['CLB_IDENTIDAD_CLAVE_ADMIN_DEMO'])
    llamar, clave = APIS['llamar'], APIS['uuid4_de']
    prendas = json.loads((RAIZ / 'compartido/prendas/ingesta/ingesta.json').read_text(encoding='utf-8'))
    resumen = []
    for p in prendas:
        estado, cuerpo = llamar('POST', '/api/v1/productos', {
            'sku': p['sku'], 'nombre': p['nombre'], 'categoría': p['categoria'], 'precio': p['precio'], 'activo': True,
            'descripción': f"Color: {p['color']}. Fotografía: PNGimg.com, CC BY-NC 4.0 ({p['fuente']}). Precio y stock de prueba.",
        }, clave('ingesta-producto-v1', p['sku']), admin)
        exigir(estado, cuerpo, p['sku'])
        producto = cuerpo['producto']
        identificador = producto['identificador']
        for talla in ('S', 'M', 'L', 'XL'):
            variante = clave('ingesta-variante-v1', p['sku'], talla)
            estado, cuerpo = llamar('POST', f'/api/v1/productos/{identificador}/variantes', {
                'identificador': variante, 'sku': f"{p['sku']}-{talla}", 'talla': talla, 'color': p['color'], 'activo': True,
            }, clave('ingesta-crear-variante-v1', variante), admin)
            exigir(estado, cuerpo, f"{p['sku']}-{talla}")
            estado, cuerpo = llamar('POST', f'/api/v1/variantes/{variante}/movimientos', {
                'tipo': 'ENTRADA', 'cantidad': 10, 'motivo': 'Ingreso inicial de stock de prueba de la colección ingerida',
                'versión_esperada': 1,
            }, clave('ingesta-entrada-inicial-v1', variante), admin)
            exigir(estado, cuerpo, f"stock {p['sku']}-{talla}")
        if producto.get('recurso_probador'):
            resumen.append((p['sku'], 'ya publicada', producto['recurso_probador'].get('calidad', {}).get('nivel', '?')))
            continue
        # Fotografía: carga → worker (fondo, calidad, modelo 3D) → revisión → publicación.
        trabajo = clave('ingesta-foto-v1', p['sku'])
        ruta = f'/api/v1/productos/{identificador}/recursos-probador'
        estado, cuerpo = multipart(ruta, {'color': p['color'], 'versión_esperada': producto['versión_sincronización']},
                                   RAIZ / f"compartido/prendas/ingesta/{p['archivo']}.png", trabajo, admin)
        exigir(estado, cuerpo, f"foto {p['sku']}")
        for _ in range(90):
            estado, cuerpo = llamar('GET', f'{ruta}/{trabajo}', None, None, admin)
            t = cuerpo.get('trabajo', {})
            if t.get('estado') not in ('PENDIENTE', 'PROCESANDO'):
                break
            time.sleep(2)
        nivel = (t.get('calidad') or {}).get('nivel', '?')
        motivos = [c['mensaje'] for c in (t.get('calidad') or {}).get('comprobaciones', []) if c['nivel'] != 'ok']
        if t.get('estado') == 'PUBLICADO':
            resumen.append((p['sku'], 'ya publicada', nivel))
        elif t.get('estado') == 'LISTO' and (nivel == 'apta' or (nivel == 'con_avisos' and aceptar)):
            estado, cuerpo = llamar('POST', f'{ruta}/{trabajo}/publicar', {
                'versión_esperada': producto['versión_sincronización'], **({'aceptar_avisos': True} if nivel == 'con_avisos' else {}),
            }, clave('ingesta-publicar-v1', p['sku']), admin)
            exigir(estado, cuerpo, f"publicar {p['sku']}")
            resumen.append((p['sku'], 'publicada', nivel))
        else:
            resumen.append((p['sku'], f"NO publicada ({t.get('estado')})", nivel + (': ' + ' '.join(motivos) if motivos else '')))
    for sku, que, nivel in resumen:
        print(f'{sku:18} {que:24} {nivel}')


if __name__ == '__main__':
    main()
