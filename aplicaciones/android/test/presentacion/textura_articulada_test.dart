import 'dart:io';
import 'dart:ui' as ui;
import 'package:clb_store/dominio/pose.dart';
import 'package:clb_store/dominio/prenda_articulada.dart';
import 'package:clb_store/presentacion/textura_articulada.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../apoyo_regiones.dart';

void main() {
  testWidgets('drawVertices pinta la textura opaca en la manga articulada y libera recursos', (tester) async {
    await tester.runAsync(() async {
      final (pose, bytes, anclas) = crearEscenaRegiones();
      final textura = await TexturaArticulada.cargar(bytes, anclas);
      final ajuste = calcularAjuste(
        pose.puntos,
        TipoPrenda.superior,
        textura.imagen.width.toDouble(),
        textura.imagen.height.toDouble(),
        anclas,
      );
      final m = articularPrenda(textura.geometria!, pose.puntos, ajuste.transformacion!)!;
      final pintura = PrendaPintable(textura.imagen, m);
      final recorder = ui.PictureRecorder();
      PintorPrendaArticulada(pintura).paint(Canvas(recorder), const Size(640, 800));
      final picture = recorder.endRecording(), imagen = await picture.toImage(640, 800);
      try {
        final rgba = (await imagen.toByteData(format: ui.ImageByteFormat.rawRgba))!;
        // Píxel dentro de la abertura bajada de la manga izquierda; no estaba aquí en el afín.
        final punto = muestraManga(m.regiones.first);
        final i = (punto.y.round() * 640 + punto.x.round()) * 4;
        final png = await imagen.toByteData(format: ui.ImageByteFormat.png);
        final archivo = File('../../temporales/articulacion-fixture-flutter.png');
        await archivo.parent.create(recursive: true);
        await archivo.writeAsBytes(png!.buffer.asUint8List());
        expect(rgba.getUint8(i), greaterThan(100));
        expect(rgba.getUint8(i + 3), greaterThan(200));
      } finally {
        imagen.dispose();
        picture.dispose();
        pintura.dispose();
        textura.dispose();
      }
    });
  });
}
