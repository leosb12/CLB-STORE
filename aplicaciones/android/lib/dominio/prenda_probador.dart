import 'fotos_prendas.dart';
import 'modelos.dart';

/// Prenda en la forma del contrato v1 de `<clb-probador>` (`PrendaProbador`), con rutas del servidor local del
/// probador: `/prendas/…` (colección empaquetada) y `/recursos/<sha>.png` (texturas publicadas y descargadas).
Map<String, dynamic> prendaProbador(Producto p, List<Variante> variantes) {
  final r = p.recursoProbador;
  final base = fotosPrendas[p.sku];
  final foto = r == null ? null : '/recursos/${r.hash}.png';
  final espalda = r?.espalda;
  final modelo = r?.modelo3d;
  return {
    'identificador': p.identificador,
    'sku': p.sku,
    'nombre': p.nombre,
    'categoría': p.categoria,
    'imagen': base != null ? '/prendas/$base.png' : foto ?? '',
    if (r != null && r.soloGenerativo) 'imagenFotografica': foto,
    if (r != null) 'recurso': {'color': r.color},
    if (modelo != null && espalda != null)
      'modelo3d': {
        'modelo': modelo,
        'espalda': '/recursos/${espalda.hash}.png',
      },
    'tallas': {for (final v in variantes) v.talla}.toList(),
  };
}

/// Para combinar en un conjunto: prendas con foto (publicada o de la colección empaquetada), sin la que se abre.
bool combinable(Producto p, String abierta) =>
    p.identificador != abierta &&
    (p.recursoProbador != null || fotosPrendas.containsKey(p.sku));
