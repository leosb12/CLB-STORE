import 'dart:convert';
import 'dart:io';
import 'package:clb_store/datos/compositor_camiseta.dart';
import 'package:clb_store/datos/detector_movenet.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';

// Datos suministrados por el ensayo USB. Nunca se empaquetan fotos personales.
const carpeta = '/data/user/0/bo.clb.store/files/clb_pruebas_privadas';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('fotos privadas: modelos reales offline, cobertura y oclusión', (
    _,
  ) async {
    final datos =
        jsonDecode(await File('$carpeta/datos.json').readAsString())
            as Map<String, dynamic>;
    final textura = await File('$carpeta/textura.png').readAsBytes();
    final detector = await DetectorMoveNet.cargar();
    final compositor = CompositorCamisetaLocal();
    final tiempos = <int>[];
    try {
      for (var i = 1; i <= 4; i++) {
        final (pose, foto) = await detector.detectar(
          await File('$carpeta/$i.png').readAsBytes(),
        );
        final reloj = Stopwatch()..start();
        final salida = await compositor.componer(
          foto,
          textura,
          Map<String, dynamic>.from(datos['anclas']),
          pose,
        );
        tiempos.add(reloj.elapsedMilliseconds);
        final a = img.decodePng(salida)!, b = img.decodeImage(foto)!;
        expect(a.width, b.width);
        expect(a.height, b.height);
        // Referencias de evaluación externas al algoritmo, jamás reglas de ejecución.
        for (final punto in datos['inalterados'][i - 1]) {
          final x = ((punto[0] as num) * b.width).round(),
              y = ((punto[1] as num) * b.height).round();
          final p = a.getPixel(x, y), q = b.getPixel(x, y);
          expect(
            [p.r, p.g, p.b],
            [q.r, q.g, q.b],
            reason:
                'Fondo, piel, teléfono y pantalón deben conservarse: foto $i',
          );
        }
        for (final punto in datos['cubiertos'][i - 1]) {
          final x = ((punto[0] as num) * b.width).round(),
              y = ((punto[1] as num) * b.height).round();
          final p = a.getPixel(x, y), q = b.getPixel(x, y);
          expect(
            (p.r - q.r).abs() + (p.g - q.g).abs() + (p.b - q.b).abs(),
            greaterThan(50),
            reason: 'Cobertura de camiseta: foto $i',
          );
        }
        await File('$carpeta/resultado-$i.png').writeAsBytes(salida);
      }
      await File('$carpeta/listo').writeAsString('resultados disponibles');
      final espera = Stopwatch()..start();
      while (!await File('$carpeta/recogido').exists() && espera.elapsed.inSeconds < 90) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
      expect(await File('$carpeta/recogido').exists(), isTrue, reason: 'El ensayo USB debe recoger evidencia antes de cerrar');
      // ignore: avoid_print
      print('CLB_MATERIAL_FOTOS_MS=${jsonEncode(tiempos)}');
    } finally {
      detector.cerrar();
    }
  });
}
