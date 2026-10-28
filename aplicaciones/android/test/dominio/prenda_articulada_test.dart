import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:clb_store/dominio/pose.dart';
import 'package:clb_store/dominio/prenda_articulada.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final f =
      jsonDecode(File('../../compartido/prendas/fixtures/regiones-articuladas.json').readAsStringSync())
          as Map<String, dynamic>;
  (GeometriaPrenda, List<PuntoClave>, Transformacion) escena({bool larga = false}) {
    final ancho = f['ancho'] as int, alto = f['alto'] as int, alfa = Uint8List(ancho * alto);
    final s = (larga ? f['manga_larga'] : f) as Map<String, dynamic>;
    for (final r in s['rectangulos']) {
      for (var y = r[1] as int; y < r[3]; y++) {
        for (var x = r[0] as int; x < r[2]; x++) {
          alfa[y * ancho + x] = 255;
        }
      }
    }
    final r = s['hueco'];
    for (var y = (r?[1] ?? 0) as int; r != null && y < r[3]; y++) {
      for (var x = r[0] as int; x < r[2]; x++) {
        alfa[y * ancho + x] = 0;
      }
    }
    final g = analizarTextura(alfa, ancho, alto, Map<String, dynamic>.from(f['anclas']))!;
    final pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
    for (final e in (s['puntos'] as Map).entries) {
      final p = e.value;
      pose[int.parse(e.key)] = PuntoClave((p[0] as num).toDouble(), (p[1] as num).toDouble(), (p[2] as num).toDouble());
    }
    final ajuste = calcularAjuste(
      pose,
      TipoPrenda.superior,
      ancho.toDouble(),
      alto.toDouble(),
      Map<String, dynamic>.from(f['anclas']),
    );
    return (g, pose, ajuste.transformacion!);
  }

  final resultado = jsonDecode(File('../../compartido/prendas/fixtures/regiones-resultado.json').readAsStringSync());
  void comparar(PrendaArticulada m, Map esperado) {
    expect(m.codosArticulados, esperado['codosArticulados']);
    expect(m.regiones.length, (esperado['regiones'] as List).length);
    for (var i = 0; i < m.regiones.length; i++) {
      final r = m.regiones[i], e = esperado['regiones'][i];
      expect(r.indices, e['indices']);
      for (var j = 0; j < r.vertices.length; j++) {
        expect(r.vertices[j], closeTo(e['vertices'][j], 1e-6));
        expect(r.uv[j], closeTo(e['uv'][j], 1e-6));
      }
    }
  }

  test('malla coincide con fixture TypeScript: ambas mangas orientadas, vértices y UV sin inversiones', () {
    final (g, pose, t) = escena();
    final m = articularPrenda(g, pose, t)!;
    expect(m.codosArticulados, 2);
    expect(m.regiones.every(mallaSegura), isTrue);
    expect(m.regiones.fold(0, (int n, r) => n + r.indices.length ~/ 3), lessThanOrEqualTo(80));
    comparar(m, resultado);
  });
  test('manga larga: antebrazo sigue la muñeca igual que TypeScript', () {
    final (g, pose, t) = escena(larga: true);
    expect(g.mangas.every((m) => m.larga && m.abajo! > g.axila), isTrue);
    final m = articularPrenda(g, pose, t)!;
    expect(m.regiones.length, 5);
    expect(m.regiones.every(mallaSegura), isTrue);
    comparar(m, resultado['manga_larga']);
  });
  test('codo y cadera ocultos producen fallback acotado, nunca NaN', () {
    final (g, pose, t) = escena();
    pose[7] = const PuntoClave(230, 360, 0);
    pose[11] = const PuntoClave(285, 500, 0);
    final m = articularPrenda(g, pose, t)!;
    expect(m.codosArticulados, 1);
    expect(m.torsoEstimado, isTrue);
    expect(m.regiones.every(mallaSegura), isTrue);
    expect(m.regiones.first.vertices[22], closeTo(m.regiones.last.vertices[12], 1e-6));
  });
  test('alfa truncado o anclas inválidas no generan geometría', () {
    expect(analizarTextura(Uint8List(2), 200, 240, Map<String, dynamic>.from(f['anclas'])), isNull);
    expect(analizarTextura(Uint8List(200 * 240), 200, 240, {...f['anclas'], 'arriba': double.nan}), isNull);
  });
}
