import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:convert';
import 'dart:io';
import 'package:clb_store/dominio/material_camiseta.dart';
import 'package:clb_store/dominio/pose.dart';
import 'package:flutter_test/flutter_test.dart';

const anclas = {
  'izquierda': 0,
  'derecha': 1,
  'arriba': 0,
  'abajo': 1,
  'estampados': <List<double>>[],
};
RasterMaterial textura({bool ruido = false}) {
  final rgba = Uint8List(100 * 100 * 4);
  for (var y = 0; y < 100; y++) {
    for (var x = 0; x < 100; x++) {
      final i = (y * 100 + x) * 4,
          f = ruido ? 1 + .1 * math.sin(x * .25) + .05 * math.sin(y * .3) : 1.0;
      for (var k = 0; k < 3; k++) {
        rgba[i + k] = ([145, 180, 160][k] * f).round();
      }
      rgba[i + 3] = 255;
    }
  }
  return RasterMaterial(100, 100, rgba);
}

void main() {
  test(
    'bordado tenue conserva contraste y exige zonas válidas de preparación',
    () {
      final r = textura();
      for (var y = 30; y < 50; y++) {
        for (var x = 40; x < 60; x++) {
          if (x < 43 || x >= 57 || y >= 38 && y <= 41) {
            r.rgba.setRange((y * 100 + x) * 4, (y * 100 + x) * 4 + 4, [
              155,
              190,
              170,
              255,
            ]);
          }
        }
      }
      final m = prepararMaterialCamiseta(r, {
        ...anclas,
        'estampados': [
          [.35, .25, .65, .55],
        ],
      });
      int indice(double x, double y) =>
          (((y - .13) / .74 * 383).round() * 384 +
              ((x - .12) / .76 * 383).round()) *
          3;
      expect(
        (m.rgb[indice(.41, .33) + 1] - m.rgb[indice(.49, .33) + 1]) * 255,
        greaterThanOrEqualTo(7),
      );
      expect(
        () => prepararMaterialCamiseta(r, {
          'izquierda': 0,
          'derecha': 1,
          'arriba': 0,
          'abajo': 1,
        }),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'motivo',
            contains('preparación de estampados'),
          ),
        ),
      );
      expect(
        () => prepararMaterialCamiseta(r, {
          ...anclas,
          'estampados': [
            [0, 0, double.nan, 1],
          ],
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'el diseño cuadrado no se alarga aunque cambie la distancia a caderas',
    () {
      final tx = textura();
      for (var y = 30; y < 50; y++) {
        for (var x = 40; x < 60; x++) {
          tx.rgba.setRange((y * 100 + x) * 4, (y * 100 + x) * 4 + 4, [
            220,
            20,
            20,
            255,
          ]);
        }
      }
      final m = prepararMaterialCamiseta(tx, anclas);
      for (final cadera in [85.0, 110.0]) {
        final rgba = Uint8List(80 * 120 * 4),
            p = Float32List(256 * 256 * 6),
            pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
        for (var y = 0; y < 120; y++) {
          for (var x = 0; x < 80; x++) {
            rgba.setRange(
              (y * 80 + x) * 4,
              (y * 80 + x) * 4 + 4,
              x >= 20 && x <= 60 && y >= 35 && y <= 100
                  ? [215, 215, 215, 255]
                  : [20, 25, 30, 255],
            );
          }
        }
        for (var y = 0; y < 256; y++) {
          for (var x = 0; x < 256; x++) {
            final xx = (x + .5) * 80 / 256, yy = (y + .5) * 120 / 256;
            p[(y * 256 + x) * 6 +
                    (xx >= 20 && xx <= 60 && yy >= 35 && yy <= 100 ? 4 : 0)] =
                1;
          }
        }
        pose[5] = const PuntoClave(20, 35, .9);
        pose[6] = const PuntoClave(60, 35, .9);
        pose[7] = const PuntoClave(15, 70, .9);
        pose[8] = const PuntoClave(65, 70, .9);
        pose[11] = PuntoClave(30, cadera, .9);
        pose[12] = PuntoClave(50, cadera, .9);
        final r = transferirMaterialCamiseta(
              RasterMaterial(80, 120, rgba),
              p,
              pose,
              m,
            ),
            xs = <int>[],
            ys = <int>[];
        for (var y = 0; y < 120; y++) {
          for (var x = 0; x < 80; x++) {
            final i = (y * 80 + x) * 4;
            if (r.rgba[i] > r.rgba[i + 1] * 2) {
              xs.add(x);
              ys.add(y);
            }
          }
        }
        expect(xs.length, greaterThan(20));
        expect(
          ((xs.reduce(math.max) - xs.reduce(math.min)) -
                  (ys.reduce(math.max) - ys.reduce(math.min)))
              .abs(),
          lessThanOrEqualTo(1),
        );
      }
    },
  );
  test(
    'camiseta oscura cubre torso y mangas sin pintar pantalón, mano, teléfono o fondo; rechaza borde ambiguo',
    () {
      final d =
          jsonDecode(
                File(
                  '../../compartido/prendas/fixtures/camiseta-oscura.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final w = d['ancho'] as int, h = d['alto'] as int;
      Map<String, dynamic>? forma(double x, double y) {
        Map<String, dynamic>? resultado;
        for (final entrada in d['formas'] as List) {
          final s = entrada as Map<String, dynamic>, caja = s['caja'] as List;
          if (x >= caja[0] && x < caja[2] && y >= caja[1] && y < caja[3]) {
            resultado = s;
          }
        }
        return resultado;
      }

      final rgba = Uint8List(w * h * 4),
          p = Float32List(256 * 256 * 6),
          pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          final color =
              (forma(x.toDouble(), y.toDouble())?['color'] ?? d['fondo'])
                  as List;
          rgba.setRange((y * w + x) * 4, (y * w + x) * 4 + 4, [
            ...color.cast<int>(),
            255,
          ]);
        }
      }
      for (var y = 0; y < 256; y++) {
        for (var x = 0; x < 256; x++) {
          final clase =
              forma((x + .5) * w / 256, (y + .5) * h / 256)?['clase'] as int? ??
              0;
          p[(y * 256 + x) * 6 + clase] = 1;
        }
      }
      for (final punto in d['puntos'] as List) {
        pose[punto[0] as int] = PuntoClave(
          (punto[1] as num).toDouble(),
          (punto[2] as num).toDouble(),
          .9,
        );
      }
      final material = prepararMaterialCamiseta(textura(), anclas),
          r = transferirMaterialCamiseta(
            RasterMaterial(w, h, rgba),
            p,
            pose,
            material,
          );
      for (final punto in d['inalterados'] as List) {
        final i = ((punto[1] as int) * w + (punto[0] as int)) * 4;
        expect(r.rgba.sublist(i, i + 4), rgba.sublist(i, i + 4));
      }
      for (final punto in d['cubiertos'] as List) {
        final i = ((punto[1] as int) * w + (punto[0] as int)) * 4;
        expect(r.rgba[i + 1], greaterThan(r.rgba[i] + 15));
        expect(r.rgba[i + 1], isNot(rgba[i + 1]));
      }
      expect(
        (r.rgba[(120 * w + 99) * 4 + 1] - r.rgba[(120 * w + 115) * 4 + 1])
            .abs(),
        lessThan(25),
      );
      final ambiguo = Uint8List.fromList(rgba);
      for (var y = 230; y < 280; y++) {
        for (var x = 75; x < 185; x++) {
          ambiguo.setRange((y * w + x) * 4, (y * w + x) * 4 + 4, [
            48,
            58,
            60,
            255,
          ]);
        }
      }
      expect(
        () => transferirMaterialCamiseta(
          RasterMaterial(w, h, ambiguo),
          p,
          pose,
          material,
        ),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'motivo',
            contains('final de la camiseta'),
          ),
        ),
      );
    },
  );
  test('material conserva color y reduce variación fotográfica de tela', () {
    final m = prepararMaterialCamiseta(textura(ruido: true), anclas);
    var suma = 0.0, s2 = 0.0, n = 0;
    for (var y = 80; y < 300; y++) {
      for (var x = 80; x < 300; x++) {
        final v = m.rgb[(y * 384 + x) * 3 + 1];
        suma += v;
        s2 += v * v;
        n++;
      }
    }
    expect(math.sqrt(s2 / n - math.pow(suma / n, 2)), lessThan(.035));
    expect((suma / n - 180 / 255).abs(), lessThan(.03));
  });
  test('material conserva gráficos cromáticos y tinta negra fuerte', () {
    final r = textura();
    for (var y = 20; y < 50; y++) {
      for (var x = 35; x < 65; x++) {
        r.rgba.setRange((y * 100 + x) * 4, (y * 100 + x) * 4 + 4, [
          220,
          20,
          20,
          255,
        ]);
      }
    }
    for (var y = 60; y < 80; y++) {
      for (var x = 35; x < 65; x++) {
        r.rgba.setRange((y * 100 + x) * 4, (y * 100 + x) * 4 + 4, [
          5,
          5,
          5,
          255,
        ]);
      }
    }
    final m = prepararMaterialCamiseta(r, anclas),
        rojo = (100 * 384 + 192) * 3,
        negro = (300 * 384 + 192) * 3;
    expect(m.rgb[rojo], greaterThan(m.rgb[rojo + 1] * 3));
    expect(m.rgb[negro], lessThan(.1));
  });
  test(
    'material rechaza transparencia, máscara corrupta y pose insuficiente',
    () {
      final tx = textura();
      tx.rgba.fillRange(0, tx.rgba.length, 0);
      expect(() => prepararMaterialCamiseta(tx, anclas), throwsFormatException);
      final r = RasterMaterial(80, 120, Uint8List(80 * 120 * 4)),
          p = Float32List(256 * 256 * 6),
          m = prepararMaterialCamiseta(textura(), anclas);
      final pose = List.generate(17, (_) => const PuntoClave(0, 0, 0));
      expect(
        () => transferirMaterialCamiseta(r, p, pose, m),
        throwsFormatException,
      );
      p[0] = double.nan;
      expect(
        () => transferirMaterialCamiseta(r, p, pose, m),
        throwsFormatException,
      );
    },
  );
  test('media de caja respeta constantes y bordes', () {
    expect(
      mediaCajaMaterial(Float32List(12)..fillRange(0, 12, .5), 4, 3, 2),
      List.filled(12, .5),
    );
  });
}
