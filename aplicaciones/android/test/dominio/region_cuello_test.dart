import 'dart:convert';
import 'dart:io';

import 'package:clb_store/dominio/pose.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'regionCuello coincide con el fixture compartido con el probador web',
    () {
      final f = jsonDecode(
        File(
          '../../compartido/prendas/fixtures/region-cuello.json',
        ).readAsStringSync(),
      );
      final pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
      (f['puntos'] as Map<String, dynamic>).forEach((i, p) {
        final v = (p as List).cast<num>();
        pose[int.parse(i)] = PuntoClave(
          v[0].toDouble(),
          v[1].toDouble(),
          v[2].toDouble(),
        );
      });
      final region = regionCuello(pose)!;
      final esperado = f['region'] as List;
      expect(region.length, esperado.length);
      for (var k = 0; k < region.length; k++) {
        expect(region[k].$1, closeTo(esperado[k]['x'], 1e-6));
        expect(region[k].$2, closeTo(esperado[k]['y'], 1e-6));
      }
    },
  );

  test('sin los dos hombros no hay región', () {
    final pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
    pose[5] = const PuntoClave(300, 400, 0.9);
    expect(regionCuello(pose), isNull);
  });
}
