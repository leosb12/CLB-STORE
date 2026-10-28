"""Carga la colección fotográfica local mediante Inventario, sin modificar prendas existentes.

Productos, variantes y entrada inicial tienen claves deterministas: repetir no duplica ni repone stock vendido.
Las fotografías están empaquetadas por SKU en Web/Android; no se cambia el esquema de ninguna base.
"""
import json
import pathlib
import runpy
import sys

CARPETA = pathlib.Path(__file__).resolve().parent
RAIZ = CARPETA.parent.parent
APIS = runpy.run_path(str(CARPETA / 'sembrar-gestion.py'))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    env = APIS['leer_env']()
    admin = APIS['token']('admin.demo', env['CLB_IDENTIDAD_CLAVE_ADMIN_DEMO'])
    llamar, clave = APIS['llamar'], APIS['uuid4_de']
    prendas = json.loads((RAIZ / 'compartido/prendas/catalogo.json').read_text(encoding='utf-8'))
    for p in prendas:
        estado, cuerpo = llamar('POST', '/api/v1/productos', {
            'sku': p['sku'], 'nombre': p['nombre'], 'categoría': p['categoria'], 'precio': p['precio'], 'activo': True,
            'descripción': f"Colección fotográfica de demostración. Color: {p['color']}. "
                           f"Fotografía: PNGimg.com, CC BY-NC 4.0 ({p['fuente']}). Precio y stock de prueba.",
        }, clave('foto-producto-v1', p['sku']), admin)
        exigir(estado, cuerpo)
        identificador = cuerpo['producto']['identificador']
        for talla in ('S', 'M', 'L', 'XL'):
            variante = clave('foto-variante-v1', p['sku'], talla)
            estado, cuerpo = llamar('POST', f'/api/v1/productos/{identificador}/variantes', {
                'identificador': variante, 'sku': f"{p['sku']}-{talla}", 'talla': talla, 'color': p['color'], 'activo': True,
            }, clave('foto-crear-variante-v1', variante), admin)
            exigir(estado, cuerpo)
            estado, cuerpo = llamar('POST', f'/api/v1/variantes/{variante}/movimientos', {
                'tipo': 'ENTRADA', 'cantidad': 12, 'motivo': 'Ingreso inicial de stock de demostración de la colección fotográfica',
                'versión_esperada': 1,
            }, clave('foto-entrada-inicial-v1', variante), admin)
            exigir(estado, cuerpo)
        print(f"OK {p['sku']} · {p['nombre']} · S/M/L/XL")
    print('Colección lista: 8 productos y 32 variantes. La repetición conserva las mismas claves e identificadores.')


def exigir(estado, cuerpo):
    if estado not in (200, 201):
        raise SystemExit(f'Inventario rechazó la operación ({estado}): {cuerpo}')


if __name__ == '__main__':
    main()
