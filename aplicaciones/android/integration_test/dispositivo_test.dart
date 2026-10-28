// Pruebas en un teléfono o emulador Android real: `flutter test integration_test -d <dispositivo>`.
// Ejercen lo que no corre en el host: el intérprete TensorFlow Lite (LiteRT) con MoveNet y el SQLite del sistema.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:clb_store/dominio/prenda_articulada.dart';
import 'package:clb_store/presentacion/textura_articulada.dart';
import '../test/apoyo_regiones.dart';
import 'package:http/testing.dart';
import 'package:clb_store/datos/recursos_prendas.dart';
import 'package:clb_store/dominio/recurso_probador.dart';

import 'package:clb_store/datos/almacen_sqlite.dart';
import 'package:clb_store/datos/detector_movenet.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/pose.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import 'persona_jpg.dart';
import 'recurso_fixture.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('malla offline: 50 composiciones GPU articuladas con recursos liberados', (_) async {
    final (pose, bytes, anclas) = crearEscenaRegiones();
    final textura = await TexturaArticulada.cargar(bytes, anclas);
    final ajuste = calcularAjuste(
      pose.puntos,
      TipoPrenda.superior,
      textura.imagen.width.toDouble(),
      textura.imagen.height.toDouble(),
      anclas,
    );
    final cpu = <int>[], render = <int>[];
    try {
      for (var i = 0; i < 50; i++) {
        final reloj = Stopwatch()..start();
        final m = articularPrenda(textura.geometria!, pose.puntos, ajuste.transformacion!)!;
        cpu.add(reloj.elapsedMicroseconds);
        expect(m.codosArticulados, 2);
        final pintura = PrendaPintable(textura.imagen, m), recorder = ui.PictureRecorder();
        PintorPrendaArticulada(pintura).paint(Canvas(recorder), const Size(640, 800));
        final picture = recorder.endRecording(), imagen = await picture.toImage(640, 800);
        final datos = await imagen.toByteData(format: ui.ImageByteFormat.rawRgba);
        final punto = muestraManga(m.regiones.first);
        expect(datos!.getUint8((punto.y.round() * 640 + punto.x.round()) * 4 + 3), greaterThan(200));
        imagen.dispose();
        picture.dispose();
        pintura.dispose();
        render.add(reloj.elapsedMicroseconds);
      }
      cpu.sort();
      render.sort();
      // ignore: avoid_print
      print('CLB_MALLA_50_CPU_P95_US=${cpu[47]}; TOTAL_CPU_PINTURA_LECTURA_P95_US=${render[47]}');
      expect(cpu[47], lessThan(16000));
    } finally {
      textura.dispose();
    }
  });

  testWidgets('MoveNet en TensorFlow Lite encuentra hombros y cadera y la prenda se ajusta, sin red', (_) async {
    final detector = await DetectorMoveNet.cargar();
    final resultado = await ProbarPrenda(detector).ejecutar(base64Decode(personaJpgBase64), 'Poleras');
    final p = resultado.pose;
    PuntoClave punto(String nombre) => p.puntos[puntos.indexOf(nombre)];

    expect([p.ancho, p.alto], [320, 494]);
    for (final n in ['hombro_izquierdo', 'hombro_derecho', 'cadera_izquierda', 'cadera_derecha']) {
      expect(punto(n).confianza, greaterThan(confianzaMinima), reason: n);
    }
    // La persona está de pie y de frente: hombros sobre la cadera, y la cara sobre los hombros.
    expect(punto('hombro_izquierdo').y, lessThan(punto('cadera_izquierda').y));
    expect(punto('nariz').y, lessThan(punto('hombro_derecho').y));
    expect(resultado.ajuste.ajustado, isTrue);
    expect(resultado.ajuste.largoEstimado, isFalse);
    detector.cerrar();
  });

  testWidgets('el SQLite del sistema guarda la cola y vacía el carrito en la misma transacción', (_) async {
    final ruta = join(await getDatabasesPath(), 'clb_prueba_${nuevoUuid()}.db');
    final almacen = await AlmacenSqlite.abrir(databaseFactory, ruta, instanciaUnica: false);
    try {
      const linea = LineaCarrito(
        identificadorVariante: 'a842e928-d9bf-4a0a-81b8-e02626ccc955',
        identificadorProducto: 'bbac86c9ecd26898f1e3f757b1efad44',
        sku: 'CLB-SEM-CAM-LIN-M-BLA',
        nombre: 'Camisa de lino',
        talla: 'M',
        color: 'Blanco',
        precioCentavos: 21900,
        cantidad: 2,
      );
      await almacen.guardarLinea(linea);
      final op = Operacion.pedido(await almacen.carrito(), 'sub', DateTime.now());
      await almacen.encolarPedido(op);
      expect(await almacen.carrito(), isEmpty);
      expect((await almacen.operaciones()).single.claveIdempotencia, op.claveIdempotencia);
    } finally {
      await almacen.cerrar();
      await deleteDatabase(ruta);
    }
  });
  testWidgets('textura dinámica, SQLite y TFLite reales sin red en el dispositivo', (_) async {
    final f = jsonDecode(recursoFixtureJson) as Map<String, dynamic>;
    final r = RecursoProbador.validar(Map<String, dynamic>.from(f['recurso'] as Map));
    final datos = base64Decode(f['png_base64'] as String);
    final carpeta = await Directory(join(await getDatabasesPath(), 'clb_prueba_foto_${nuevoUuid()}')).create();
    final ruta = join(carpeta.path, 'prueba.db');
    final recursos = RecursosPrendas(
      carpeta.path,
      MockClient((_) async => throw StateError('La lectura offline no debe usar HTTP')),
      'http://127.0.0.1:18000',
    );
    final detector = await DetectorMoveNet.cargar();
    try {
      await File(join(carpeta.path, '${r.hash}.png')).writeAsBytes(datos, flush: true);
      final almacen = await AlmacenSqlite.abrir(databaseFactory, ruta, instanciaUnica: false);
      final producto = Producto(
        identificador: 'a' * 32,
        sku: 'CLB-PRUEBA',
        nombre: 'Polera',
        descripcion: '',
        categoria: 'Poleras',
        precioCentavos: 9900,
        fechaActualizacion: '2026-10-23T00:00:00Z',
        recursoProbador: r,
      );
      await almacen.reemplazarCatalogo([producto], [], DateTime.now());
      await almacen.cerrar();
      final reabierto = await AlmacenSqlite.abrir(databaseFactory, ruta, instanciaUnica: false);
      final guardado = (await reabierto.productos()).single;
      expect(await recursos.leer(guardado.recursoProbador!), datos);
      await reabierto.cerrar();
      final tiempos = <int>[];
      for (var i = 0; i < 10; i++) {
        final reloj = Stopwatch()..start();
        final resultado = await ProbarPrenda(detector).ejecutar(base64Decode(personaJpgBase64), 'Poleras', r);
        reloj.stop();
        tiempos.add(reloj.elapsedMilliseconds);
        expect(resultado.ajuste.ajustado, isTrue);
      }
      tiempos.sort();
      // Evidencia observable en el resultado de flutter test; no es benchmark de teléfonos de 4 GB.
      // ignore: avoid_print
      print('CLB_TFLITE_FOTO_10_INFERENCIAS_MS=$tiempos; p95=${tiempos[9]}');
    } finally {
      detector.cerrar();
      await deleteDatabase(ruta);
      await carpeta.delete(recursive: true);
    }
  });
}
