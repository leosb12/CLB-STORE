import 'dart:typed_data';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/pose.dart';
import 'package:clb_store/dominio/recurso_probador.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:clb_store/presentacion/pantalla_probador.dart';
import 'package:clb_store/presentacion/textura_articulada.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

import '../apoyo.dart';

class _Detector implements DetectorPose {
  _Detector(this.pose, this.imagen);
  final Pose pose;
  final Uint8List imagen;
  @override
  String get modelo => 'MoveNet de prueba';
  @override
  Future<(Pose, Uint8List)> detectar(Uint8List _) async => (pose, imagen);
}

class _Catalogo implements FuenteCatalogo {
  @override
  Future<List<Never>> productos() async => [];
  @override
  Future<List<Never>> variantes(String _) async => [];
  @override
  Future<Map<String, dynamic>> modeloTallas() async => {};
}

class _Recursos implements FuenteRecursosPrendas {
  _Recursos(this.bytes);
  final Uint8List bytes;
  @override
  Future<void> preparar(List<Producto> _) async {}
  @override
  Future<Uint8List?> leer(RecursoProbador _) async => bytes;
}

class _CompositorRechazo implements CompositorCamiseta {
  @override
  Future<Uint8List> componer(
    Uint8List foto,
    Uint8List textura,
    Map<String, dynamic> anclas,
    Pose pose,
  ) async {
    throw const FormatException(
      'Usa una camiseta base lisa, clara y ajustada, con buena luz.',
    );
  }
}

void main() {
  testWidgets(
    'modo y captura visibles antes del visor; un rechazo no pinta una superposición',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final almacen = await almacenEnMemoria();
      addTearDown(almacen.cerrar);
      final sesion = SesionFalsa();
      final fixture =
          jsonDecode(
                File(
                  '../../compartido/prendas/fixtures/ajuste-fotografico.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final recurso = RecursoProbador.validar(
        Map<String, dynamic>.from(fixture['recurso']),
      );
      final prenda = Producto(
        identificador: producto.identificador,
        sku: 'CLB-PRUEBA',
        nombre: 'Polera',
        descripcion: '',
        categoria: 'Poleras',
        precioCentavos: 9900,
        fechaActualizacion: producto.fechaActualizacion,
        recursoProbador: recurso,
      );
      final puntos = List.generate(17, (_) => const PuntoClave(0, 0, 0));
      puntos[5] = const PuntoClave(260, 200, .9);
      puntos[6] = const PuntoClave(540, 200, .9);
      puntos[7] = const PuntoClave(200, 400, .9);
      puntos[8] = const PuntoClave(600, 400, .9);
      puntos[11] = const PuntoClave(280, 650, .9);
      puntos[12] = const PuntoClave(520, 650, .9);
      final foto = Uint8List.fromList(
        img.encodePng(img.Image(width: 800, height: 1000)),
      );
      final estado = EstadoTienda(
        almacen: almacen,
        sincronizarCatalogo: SincronizarCatalogo(_Catalogo(), almacen),
        carrito: Carrito(almacen),
        confirmarPedido: ConfirmarPedido(almacen, sesion),
        sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
        tallas: RecomendarTalla(almacen),
        sesion: sesion,
        conectividad: const Stream.empty(),
        probador: () async =>
            ProbarPrenda(_Detector(Pose(puntos, 800, 1000), foto)),
        elegirFoto: (_) async => foto,
        recursosPrendas: _Recursos(
          base64Decode(fixture['png_base64'] as String),
        ),
        crearCompositor: () => _CompositorRechazo(),
      );
      addTearDown(estado.dispose);
      await tester.pumpWidget(
        MaterialApp(home: PantallaProbador(prenda, const [], estado: estado)),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      await tester.pumpAndSettle();
      final visor = tester.getRect(
        find.byKey(const ValueKey('visor-probador')),
      );
      expect(
        tester.getRect(find.text('Aplicar tejido sobre camiseta base')).bottom,
        lessThan(visor.top),
      );
      expect(tester.getRect(find.text('Galería')).bottom, lessThan(visor.top));
      expect(tester.getRect(find.text('Galería')).bottom, lessThan(844));
      await tester.tap(find.text('Galería'));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Usa una camiseta base lisa, clara y ajustada, con buena luz.',
        ),
        findsOneWidget,
      );
      expect(
        find
            .byType(CustomPaint)
            .evaluate()
            .where(
              (e) =>
                  e.widget is CustomPaint &&
                  (e.widget as CustomPaint).painter is PintorPrendaArticulada,
            ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Aplicar tejido sobre camiseta base'));
      await tester.pumpAndSettle();
      expect(find.text('Superposición por regiones'), findsOneWidget);
      expect(find.textContaining('No sustituye la camiseta'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  for (final escenario in [(true, false), (false, false), (true, true)]) {
    final (hombros, fotografia) = escenario;
    testWidgets(
      'visor recorta pintura transformada ${fotografia ? 'fotográfica' : 'ilustrada'} y orienta cuando faltan ${hombros ? 'caderas' : 'hombros'}',
      (tester) async {
        tester.view.physicalSize = const Size(320, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final almacen = await almacenEnMemoria();
        addTearDown(almacen.cerrar);
        final sesion = SesionFalsa();
        final puntos = List.generate(17, (_) => const PuntoClave(0, 0, 0));
        if (hombros) {
          // Escala grande con el torso fuera de cuadro: reproduce la fotografía reportada.
          puntos[5] = const PuntoClave(100, 800, .9);
          puntos[6] = const PuntoClave(700, 800, .9);
        }
        final bytes = Uint8List.fromList(
          img.encodePng(img.Image(width: 800, height: 1000)),
        );
        final estado = EstadoTienda(
          almacen: almacen,
          sincronizarCatalogo: SincronizarCatalogo(_Catalogo(), almacen),
          carrito: Carrito(almacen),
          confirmarPedido: ConfirmarPedido(almacen, sesion),
          sincronizarPedidos: SincronizarPedidos(
            almacen,
            VentasFalsas(),
            sesion,
          ),
          tallas: RecomendarTalla(almacen),
          sesion: sesion,
          conectividad: const Stream.empty(),
          probador: () async =>
              ProbarPrenda(_Detector(Pose(puntos, 800, 1000), bytes)),
          elegirFoto: (_) async => bytes,
        );
        addTearDown(estado.dispose);
        const captura = ValueKey('captura');
        final prenda = fotografia
            ? Producto(
                identificador: producto.identificador,
                sku: 'CLB-FOTO-POL-GRI',
                nombre: 'Polera gris jaspeada',
                descripcion: producto.descripcion,
                categoria: 'Poleras',
                precioCentavos: 9900,
                fechaActualizacion: producto.fechaActualizacion,
              )
            : producto;
        await tester.pumpWidget(
          RepaintBoundary(
            key: captura,
            child: MaterialApp(
              theme: ThemeData(
                scaffoldBackgroundColor: const Color(0xff123456),
              ),
              home: PantallaProbador(prenda, const [], estado: estado),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Galería'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining(
            hombros ? 'torso y la cadera' : 'foto de cuerpo entero',
          ),
          findsOneWidget,
        );
        final visor = tester.getRect(
          find.byKey(const ValueKey('visor-probador')),
        );
        expect(
          tester.getRect(find.text('Cámara')).top,
          greaterThan(visor.bottom),
        );
        final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(captura),
        );
        final pixels = await tester.runAsync(() async {
          final imagen = await boundary.toImage(pixelRatio: 1);
          try {
            return await imagen.toByteData(format: ui.ImageByteFormat.rawRgba);
          } finally {
            imagen.dispose();
          }
        });
        // La franja entre visor y botones conserva el fondo: un Transform sin ClipRect la pintaba de camisa.
        final offset = (((visor.bottom + 4).floor() * 320) + 160) * 4;
        expect(pixels!.buffer.asUint8List().sublist(offset, offset + 4), [
          0x12,
          0x34,
          0x56,
          0xff,
        ]);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'con RA disponible pero sin rendimiento medido se abre la vista rápida; un resultado ofrece los puntos del cuerpo sin red',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final almacen = await almacenEnMemoria();
      addTearDown(almacen.cerrar);
      final sesion = SesionFalsa();
      final fixture = jsonDecode(File('../../compartido/prendas/fixtures/ajuste-fotografico.json').readAsStringSync())
          as Map<String, dynamic>;
      final prenda = Producto(
        identificador: producto.identificador, sku: 'CLB-FOTO-POL-GRI', nombre: 'Polera gris', descripcion: '',
        categoria: 'Poleras', precioCentavos: 9900, fechaActualizacion: producto.fechaActualizacion,
        recursoProbador: RecursoProbador.validar(Map<String, dynamic>.from(fixture['recurso'])),
      );
      final puntos = List.generate(17, (_) => const PuntoClave(0, 0, 0));
      puntos[5] = const PuntoClave(260, 200, .9);
      puntos[6] = const PuntoClave(540, 200, .9);
      puntos[7] = const PuntoClave(200, 400, .9);
      puntos[8] = const PuntoClave(600, 400, .9);
      puntos[11] = const PuntoClave(280, 650, .9);
      puntos[12] = const PuntoClave(520, 650, .9);
      final foto = Uint8List.fromList(img.encodePng(img.Image(width: 800, height: 1000)));
      final estado = EstadoTienda(
        almacen: almacen,
        sincronizarCatalogo: SincronizarCatalogo(_Catalogo(), almacen),
        carrito: Carrito(almacen),
        confirmarPedido: ConfirmarPedido(almacen, sesion),
        sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
        tallas: RecomendarTalla(almacen),
        sesion: sesion,
        conectividad: const Stream.empty(),
        probador: () async => ProbarPrenda(_Detector(Pose(puntos, 800, 1000), foto)),
        elegirFoto: (_) async => foto,
        recursosPrendas: _Recursos(base64Decode(fixture['png_base64'] as String)),
        probadorRA: _AnfitrionSinUso(),
      );
      addTearDown(estado.dispose);
      await tester.pumpWidget(MaterialApp(home: PantallaProbador(prenda, const [], estado: estado)));
      await tester.pumpAndSettle();
      // RA disponible (prenda con modelo 3D), pero sin rendimiento medido en este teléfono: no es el modo inicial.
      expect(find.text('RA 3D'), findsOneWidget);
      final selector = tester.widget<SegmentedButton<ModoProbador>>(find.byType(SegmentedButton<ModoProbador>));
      expect(selector.selected, {ModoProbador.rapida});
      expect(find.textContaining('Funciona sin conexión'), findsOneWidget);
      expect(find.text('Cámara'), findsOneWidget);
      await tester.ensureVisible(find.text('Galería'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Galería'));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(find.text('Mostrar puntos del cuerpo'), find.byType(ListView).first, const Offset(0, -200));
      expect(find.text('Mostrar puntos del cuerpo'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}

class _AnfitrionSinUso implements AnfitrionProbadorRA {
  @override
  Future<Uri> iniciar() => throw StateError('La RA no debe abrirse en esta prueba.');
  @override
  Future<void> detener() async {}
}

