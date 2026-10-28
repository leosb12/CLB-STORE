import 'dart:convert';
import 'dart:typed_data';
import 'package:image/image.dart' as img;
import 'package:clb_store/dominio/pose.dart';
import 'package:clb_store/dominio/prenda_articulada.dart';
import '../integration_test/regiones_fixture.dart';

/// Punto UV opaco del fixture transformado por el triángulo que lo contiene.
PuntoMalla muestraManga(MallaTextura m) {
  const x = 20.0, y = 60.0;
  for (var i = 0; i < m.indices.length; i += 3) {
    final a = m.indices[i] * 2, b = m.indices[i + 1] * 2, c = m.indices[i + 2] * 2;
    final det = (m.uv[b] - m.uv[a]) * (m.uv[c + 1] - m.uv[a + 1]) - (m.uv[c] - m.uv[a]) * (m.uv[b + 1] - m.uv[a + 1]);
    final u = ((x - m.uv[a]) * (m.uv[c + 1] - m.uv[a + 1]) - (y - m.uv[a + 1]) * (m.uv[c] - m.uv[a])) / det;
    final v = ((y - m.uv[a + 1]) * (m.uv[b] - m.uv[a]) - (x - m.uv[a]) * (m.uv[b + 1] - m.uv[a + 1])) / det;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return PuntoMalla(
        m.vertices[a] + u * (m.vertices[b] - m.vertices[a]) + v * (m.vertices[c] - m.vertices[a]),
        m.vertices[a + 1] + u * (m.vertices[b + 1] - m.vertices[a + 1]) + v * (m.vertices[c + 1] - m.vertices[a + 1]),
      );
    }
  }
  throw StateError('Muestra opaca fuera de los triángulos de manga');
}

(Pose, Uint8List, Map<String, dynamic>) crearEscenaRegiones() {
  final f = jsonDecode(regionesFixtureJson), ancho = f['ancho'] as int, alto = f['alto'] as int;
  final imagen = img.Image(width: ancho, height: alto, numChannels: 4);
  for (final r in f['rectangulos']) {
    for (var y = r[1] as int; y < r[3]; y++) {
      for (var x = r[0] as int; x < r[2]; x++) {
        imagen.setPixelRgba(x, y, x % 16 < 2 ? 210 : 180, 30, 40, 255);
      }
    }
  }
  final r = f['hueco'];
  for (var y = r[1] as int; y < r[3]; y++) {
    for (var x = r[0] as int; x < r[2]; x++) {
      imagen.setPixelRgba(x, y, 0, 0, 0, 0);
    }
  }
  final pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
  for (final e in (f['puntos'] as Map).entries) {
    final p = e.value;
    pose[int.parse(e.key)] = PuntoClave((p[0] as num).toDouble(), (p[1] as num).toDouble(), (p[2] as num).toDouble());
  }
  return (Pose(pose, 640, 800), Uint8List.fromList(img.encodePng(imagen)), Map<String, dynamic>.from(f['anclas']));
}
