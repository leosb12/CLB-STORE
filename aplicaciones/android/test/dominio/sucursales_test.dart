import 'package:clb_store/dominio/sucursales.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  test('cinco sucursales de demostración dentro de Santa Cruz de la Sierra', () {
    expect(sucursalesDemo, hasLength(5));
    for (final s in sucursalesDemo) {
      // Todas a menos de 6 km de la plaza 24 de Septiembre.
      expect(metrosEnLineaRecta(centroSantaCruz, s.punto), lessThan(6000), reason: s.nombre);
    }
  });

  test('la más cercana es la de la zona del punto, con distancia en línea recta', () {
    final (norte, m) = masCercana(const LatLng(-17.7450, -63.1780));
    expect(norte.nombre, 'CLB Store Norte');
    expect(m, inInclusiveRange(700, 900));
    expect(masCercana(const LatLng(-17.7840, -63.2300)).$1.nombre, 'CLB Store Oeste');
    expect(masCercana(centroSantaCruz), (sucursalesDemo.first, 0.0));
    expect(textoDistancia(850), '850 m');
    expect(textoDistancia(3420), '3,4 km');
  });
}
