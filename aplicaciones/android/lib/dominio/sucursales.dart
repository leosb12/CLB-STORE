import 'package:latlong2/latlong.dart';

/// Sucursal de demostración: ubicaciones ficticias para la presentación, no locales reales de CLB Store.
class Sucursal {
  const Sucursal(this.nombre, this.zona, this.punto);
  final String nombre, zona;
  final LatLng punto;
}

/// Santa Cruz de la Sierra, Bolivia: plaza 24 de Septiembre y una sucursal hacia cada punto cardinal.
const centroSantaCruz = LatLng(-17.7833, -63.1821);

const sucursalesDemo = [
  Sucursal('CLB Store Centro', 'Casco viejo, primer anillo', centroSantaCruz),
  Sucursal(
    'CLB Store Norte',
    'Zona Norte, cuarto anillo',
    LatLng(-17.7520, -63.1790),
  ),
  Sucursal(
    'CLB Store Sur',
    'Zona Sur, cuarto anillo',
    LatLng(-17.8150, -63.1850),
  ),
  Sucursal(
    'CLB Store Este',
    'Zona Este, cuarto anillo',
    LatLng(-17.7800, -63.1450),
  ),
  Sucursal(
    'CLB Store Oeste',
    'Zona Oeste, cuarto anillo',
    LatLng(-17.7850, -63.2150),
  ),
];

const _distancia = Distance();

/// Distancia geográfica en línea recta (haversine), en metros. No es la distancia por calle.
double metrosEnLineaRecta(LatLng a, LatLng b) => _distancia(a, b);

/// La sucursal de demostración más cercana en línea recta y su distancia en metros.
(Sucursal, double) masCercana(LatLng punto) {
  var mejor = sucursalesDemo.first;
  var metros = metrosEnLineaRecta(punto, mejor.punto);
  for (final s in sucursalesDemo.skip(1)) {
    final m = metrosEnLineaRecta(punto, s.punto);
    if (m < metros) (mejor, metros) = (s, m);
  }
  return (mejor, metros);
}

/// «850 m» o «3,4 km».
String textoDistancia(double metros) => metros < 1000
    ? '${metros.round()} m'
    : '${(metros / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';
