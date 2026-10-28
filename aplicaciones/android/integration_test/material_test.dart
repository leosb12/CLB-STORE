import 'dart:convert';
import 'dart:typed_data';
import 'package:clb_store/datos/compositor_camiseta.dart';
import 'package:clb_store/datos/detector_movenet.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
import 'camiseta_base_fixture.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'material offline: LiteRT semántico real y composición en isolate',
    (_) async {
      final detector = await DetectorMoveNet.cargar();
      try {
        final (pose, foto) = await detector.detectar(
          base64Decode(camisetaBaseJpg),
        );
        final tela = img.Image(width: 100, height: 100, numChannels: 4);
        img.fill(tela, color: img.ColorRgba8(80, 145, 110, 255));
        final textura = Uint8List.fromList(img.encodePng(tela));
        final compositor = CompositorCamisetaLocal(),
            reloj = Stopwatch()..start();
    const repeticiones=int.fromEnvironment('CLB_REPETICIONES_MATERIAL',defaultValue:2);
    final mediciones=<int>[];
    for (var i = 0; i < repeticiones; i++) {
      final medicion=Stopwatch()..start();
          final salida = await compositor.componer(foto, textura, {
            'izquierda': 0,
            'derecha': 1,
            'arriba': 0,
            'abajo': 1,
            'estampados': <List<double>>[],
          }, pose);
      mediciones.add(medicion.elapsedMilliseconds);
          final resultado = img.decodePng(salida)!,
              entrada = img.decodeImage(foto)!;
          expect(resultado.width, pose.ancho);
          expect(resultado.height, pose.alto);
          // Fondo y rostro fuera de camiseta: exactitud, no parecido subjetivo.
          for (final punto in [
            (10, 10),
            ((pose.ancho * .5).round(), (pose.alto * .2).round()),
          ]) {
            final a = resultado.getPixel(punto.$1, punto.$2),
                b = entrada.getPixel(punto.$1, punto.$2);
            expect([a.r, a.g, a.b], [b.r, b.g, b.b]);
          }
          final pecho = resultado.getPixel(
            (pose.ancho * .5).round(),
            (pose.alto * .5).round(),
          );
          expect(pecho.g, greaterThan(pecho.r));
        }
        // Solo duración; esta prueba no transmite ni guarda la fotografía personal.
        // ignore: avoid_print
    print('CLB_MATERIAL_FOTOS_MS=${jsonEncode(mediciones)}; TOTAL_MS=${reloj.elapsedMilliseconds}');
      } finally {
        detector.cerrar();
      }
    },
  );
}
