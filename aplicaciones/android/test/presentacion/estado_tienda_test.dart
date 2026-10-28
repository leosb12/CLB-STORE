import 'dart:async';

import 'package:flutter/material.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:clb_store/presentacion/pantalla_pedidos.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

void main() {
  test(
    'recupera el servidor sin evento de red y no confunde Wi-Fi con disponibilidad',
    () async {
      final almacen = await almacenEnMemoria();
      final sesion = SesionFalsa()..actual = null;
      final red = StreamController<bool>.broadcast();
      final fuente = _CatalogoIntermitente();
      final estado = EstadoTienda(
        almacen: almacen,
        sincronizarCatalogo: SincronizarCatalogo(fuente, almacen),
        carrito: Carrito(almacen),
        confirmarPedido: ConfirmarPedido(almacen, sesion),
        sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
        tallas: RecomendarTalla(almacen),
        sesion: sesion,
        conectividad: red.stream,
        probador: () => throw UnimplementedError(),
        elegirFoto: (_) async => null,
      );
      addTearDown(() async {
        estado.dispose();
        await red.close();
        await almacen.cerrar();
      });
      Future<void> esperar(bool Function() condicion, Duration plazo) async {
        final reloj = Stopwatch()..start();
        while (!condicion()) {
          if (reloj.elapsed > plazo) fail('No se recuperó el estado esperado');
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
      }

      await estado.iniciar();
      await esperar(() => !estado.enLinea, const Duration(seconds: 2));
      fuente.disponible = true; // vuelve el túnel USB; no hay evento de conectividad
      await esperar(() => estado.enLinea && estado.fechaCatalogo != null, const Duration(seconds: 35));
      expect(estado.productos.single.identificador, producto.identificador);
      red.add(false); // sin Wi-Fi, pero servidor accesible por USB
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(estado.enLinea, isTrue);
      fuente.disponible = false;
      red.add(true); // Wi-Fi conectado, servidor inaccesible
      await esperar(() => !estado.enLinea, const Duration(seconds: 2));
      expect(estado.productos.single.identificador, producto.identificador);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  test('cerrar el estado durante el arranque no crea suscripciones tardías ni temporizadores', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final sesion = _SesionEnEspera();
    final conectividad = StreamController<bool>.broadcast();
    addTearDown(conectividad.close);
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_SinRed(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: conectividad.stream,
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
    );
    final inicio = estado.iniciar();
    await sesion.solicitada.future;
    estado.dispose();
    sesion.respuesta.complete(null);
    await inicio;
    expect(conectividad.hasListener, isFalse);
    expect(estado.sincronizandoCatalogo, isFalse);
  });

  testWidgets('pedidos combina historial y pendientes sin duplicar; fecha offline en una pantalla pequeña', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa();
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_SinRed(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: const Stream<bool>.empty(),
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
    );
    addTearDown(estado.dispose);
    addTearDown(almacen.cerrar);
    const linea = LineaCarrito(
      identificadorVariante: idM,
      identificadorProducto: 'p',
      sku: 's',
      nombre: 'Camisa',
      talla: 'M',
      color: 'Blanco',
      precioCentavos: 100,
      cantidad: 1,
    );
    for (final conPedido in [false, true]) {
      estado.operaciones = conPedido
          ? [
              Operacion.pedido([linea], sesion.actual!.sub, DateTime.utc(2026, 10, 22)),
            ]
          : [];
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(1.3)),
            child: child!,
          ),
          home: PantallaPedidos(estado),
        ),
      );
      expect(find.text('Mis pedidos'), findsOneWidget);
      expect(find.textContaining('todos tus dispositivos'), findsOneWidget);
      expect(find.text(conPedido ? 'En el teléfono, por enviar' : 'Aún no hay pedidos'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
    final local = estado.operaciones.single;
    estado.operaciones = [
      local,
      Operacion.pedido([linea], sesion.actual!.sub, DateTime.utc(2026, 10, 22)),
    ];
    estado.historial = [PedidoVenta.desdeJson(pedidoJson(local.identificador))];
    estado.fechaHistorial = DateTime.utc(2026, 10, 22, 12);
    estado.enLinea = false;
    await tester.pumpWidget(MaterialApp(home: PantallaPedidos(estado)));
    expect(find.text('Confirmado'), findsOneWidget);
    expect(find.text('En el teléfono, por enviar'), findsOneWidget);
    expect(find.byType(ExpansionTile), findsNWidgets(2));
    expect(find.textContaining('Último historial guardado:'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  test('en un teléfono compartido cada cuenta ve solo sus pedidos; sin sesión, ninguno', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa()..token = null;
    final ahora = DateTime.utc(2026, 10, 22);
    const linea = LineaCarrito(
      identificadorVariante: idM,
      identificadorProducto: 'p',
      sku: 's',
      nombre: 'Camisa',
      talla: 'M',
      color: 'Blanco',
      precioCentavos: 100,
      cantidad: 1,
    );
    await almacen.encolarPedido(Operacion.pedido([linea], sesion.actual!.sub, ahora));
    await almacen.encolarPedido(Operacion.pedido([linea], 'otra-cuenta', ahora));

    final conectividad = StreamController<bool>();
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_SinRed(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: conectividad.stream,
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
    );
    await estado.iniciar();
    expect(estado.operaciones.map((o) => o.titular), [sesion.actual!.sub]);
    expect(estado.pendientes, 1);

    await estado.cerrarSesion();
    expect(estado.operaciones, isEmpty);
    estado.dispose();
    await conectividad.close();
  });
}

class _SinRed implements FuenteCatalogo {
  @override
  Future<List<Producto>> productos() => throw SinConexion();
  @override
  Future<List<Variante>> variantes(String id) => throw SinConexion();
  @override
  Future<Map<String, dynamic>> modeloTallas() => throw SinConexion();
}

class _CatalogoIntermitente implements FuenteCatalogo {
  bool disponible = false;
  @override
  Future<List<Producto>> productos() async => disponible ? [producto] : throw SinConexion();
  @override
  Future<List<Variante>> variantes(String id) async => [];
  @override
  Future<Map<String, dynamic>> modeloTallas() async => {};
}

class _SesionEnEspera extends SesionFalsa {
  final solicitada = Completer<void>();
  final respuesta = Completer<Titular?>();
  @override
  Future<Titular?> titular() {
    if (!solicitada.isCompleted) solicitada.complete();
    return respuesta.future;
  }
}
