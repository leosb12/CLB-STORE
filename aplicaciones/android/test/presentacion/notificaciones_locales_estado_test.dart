import 'dart:async';

import 'package:clb_store/datos/almacen_sqlite.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

class _Avisos implements AvisosLocales {
  int carrito = 0;
  final pedidos = <bool>[];
  bool fallar = false;
  @override
  Future<void> productoAgregado() async {
    if (fallar) throw StateError('Permiso denegado');
    carrito++;
  }

  @override
  Future<void> pedidoRegistrado({required bool pendiente}) async {
    if (fallar) throw StateError('Permiso denegado');
    pedidos.add(pendiente);
  }
}

class _Catalogo implements FuenteCatalogo {
  @override
  Future<List<Producto>> productos() async => throw SinConexion();
  @override
  Future<List<Variante>> variantes(String id) async => throw SinConexion();
  @override
  Future<Map<String, dynamic>> modeloTallas() async => throw SinConexion();
}

void main() {
  Future<(EstadoTienda, AlmacenSqlite, VentasFalsas, _Avisos, SesionFalsa)>
  crear({bool red = false}) async {
    final almacen = await almacenEnMemoria();
    await almacen.reemplazarCatalogo(
      [producto],
      [variante(idM, 'M')],
      DateTime.now(),
    );
    final sesion = SesionFalsa(), ventas = VentasFalsas(), avisos = _Avisos();
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_Catalogo(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, ventas, sesion),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: const Stream.empty(),
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
      avisosLocales: avisos,
    )..titular = sesion.actual;
    estado.enLinea = red;
    addTearDown(() async {
      await estado.enviarPedidos();
      await pumpEventQueue();
      estado.dispose();
      await almacen.cerrar();
    });
    return (estado, almacen, ventas, avisos, sesion);
  }

  Future<void> drenar(EstadoTienda estado) async {
    await estado.enviarPedidos();
    // La notificación consulta SQLite después del ciclo de envío.
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }

  test(
    'carrito offline: avisa después de guardar; un fallo no emite otro aviso',
    () async {
      final (estado, almacen, _, avisos, _) = await crear();
      await estado.agregar(producto, variante(idM, 'M'));
      expect((await almacen.carrito()).single.cantidad, 1);
      expect(avisos.carrito, 1);
      await estado.carrito.cambiar((await almacen.carrito()).single, cantidadMaxima);
      await expectLater(
        estado.agregar(producto, variante(idM, 'M')),
        throwsArgumentError,
      );
      expect(avisos.carrito, 1);
    },
  );

  test(
    'offline: un solo pendiente tras guardar; reconexión y reenvíos no duplican',
    () async {
      final (estado, almacen, ventas, avisos, _) = await crear();
      await estado.agregar(producto, variante(idM, 'M'));
      ventas.fallos.add(SinConexion());
      final resultados = await Future.wait([
        estado.confirmar(),
        estado.confirmar(),
      ]);
      expect(resultados[0].identificador, resultados[1].identificador);
      expect((await almacen.operaciones()).length, 1);
      expect(avisos.pedidos, [true]);
      await drenar(estado);
      await estado.enviarPedidos(forzar: true);
      await estado.enviarPedidos(forzar: true);
      expect(avisos.pedidos, [true]);
    },
  );

  test(
    'online: registrado solo tras la respuesta real y sin duplicados concurrentes',
    () async {
      final (estado, almacen, _, avisos, _) = await crear(red: true);
      await estado.agregar(producto, variante(idM, 'M'));
      await Future.wait([estado.confirmar(), estado.confirmar()]);
      await drenar(estado);
      expect(
        (await almacen.operaciones()).single.estado,
        EstadoOperacion.confirmada,
      );
      expect(avisos.pedidos, [false]);
      await estado.enviarPedidos(forzar: true);
      expect(avisos.pedidos, [false]);
    },
  );

  test('red caída durante envío: pendiente, nunca registrado', () async {
    final (estado, _, ventas, avisos, _) = await crear(red: true);
    ventas.fallos.add(SinConexion());
    await estado.agregar(producto, variante(idM, 'M'));
    await estado.confirmar();
    await drenar(estado);
    expect(avisos.pedidos, [true]);
  });

  test(
    'rechazo definitivo del pedido: no anuncia éxito ni pendiente',
    () async {
      final (estado, _, ventas, avisos, _) = await crear(red: true);
      ventas.fallos.add(ErrorRemoto(422, 'Pedido rechazado'));
      await estado.agregar(producto, variante(idM, 'M'));
      await estado.confirmar();
      await drenar(estado);
      expect(avisos.pedidos, isEmpty);
    },
  );

  test('carrito vacío o sin sesión: no se notifica un pedido', () async {
    final (estado, _, _, avisos, sesion) = await crear();
    await expectLater(estado.confirmar(), throwsArgumentError);
    await estado.agregar(producto, variante(idM, 'M'));
    sesion.actual = null;
    await expectLater(estado.confirmar(), throwsA(isA<SinSesion>()));
    expect(avisos.pedidos, isEmpty);
  });

  test(
    'un error del sistema de notificaciones no invalida el carrito ni el pedido guardado',
    () async {
      final (estado, almacen, _, avisos, _) = await crear();
      avisos.fallar = true;
      await estado.agregar(producto, variante(idM, 'M'));
      await estado.confirmar();
      expect((await almacen.operaciones()).length, 1);
    },
  );
}
