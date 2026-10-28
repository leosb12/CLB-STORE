import 'dart:convert';
import 'dart:io';

import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

class CatalogoFalso implements FuenteCatalogo {
  bool fallarVariantes = false;
  bool fallarModelo = false;
  @override
  Future<List<Producto>> productos() async => [producto];
  @override
  Future<List<Variante>> variantes(String id) async =>
      fallarVariantes ? throw SinConexion() : [variante(idM, 'M'), variante(idL, 'L')];
  @override
  Future<Map<String, dynamic>> modeloTallas() async => fallarModelo
      ? throw ErrorRemoto(503, 'IA apagada')
      : (jsonDecode(File('test/fixtures/modelo-tallas.json').readAsStringSync())['modelo'] as Map<String, dynamic>);
}

class SesionQueCambia extends SesionFalsa {
  bool cambiar = true;
  @override
  Future<String?> tokenVigente() async {
    if (cambiar) actual = const Titular(sub: 'B', usuario: 'B', nombre: 'B', roles: {'cliente'});
    return 'token-B';
  }
}

void main() {
  var ahora = DateTime.utc(2026, 10, 22, 12);
  DateTime reloj() => ahora;

  test('el catálogo solo se reemplaza si todo llegó; IA apagada no impide sincronizarlo', () async {
    final almacen = await almacenEnMemoria();
    final fuente = CatalogoFalso();
    await SincronizarCatalogo(fuente, almacen, reloj).ejecutar();
    expect((await almacen.variantes(producto.identificador)).length, 2);
    expect(await RecomendarTalla(almacen).modelo(), isNotNull);

    fuente.fallarVariantes = true;
    await expectLater(SincronizarCatalogo(fuente, almacen, reloj).ejecutar(), throwsA(isA<SinConexion>()));
    expect((await almacen.variantes(producto.identificador)).length, 2, reason: 'la copia anterior sigue intacta');

    fuente
      ..fallarVariantes = false
      ..fallarModelo = true;
    await SincronizarCatalogo(fuente, almacen, reloj).ejecutar();
    expect(await RecomendarTalla(almacen).modelo(), isNotNull, reason: 'se conserva el modelo guardado');
  });

  test('confirmar sin sesión no encola nada; con sesión deja el pedido pendiente y vacía el carrito', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa()..actual = null;
    final carrito = Carrito(almacen);
    await carrito.agregar(producto, variante(idM, 'M'), 2);
    await expectLater(ConfirmarPedido(almacen, sesion, reloj).ejecutar(), throwsA(isA<SinSesion>()));
    expect((await carrito.lineas()).single.cantidad, 2);

    sesion.actual = SesionFalsa().actual;
    final op = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    expect(op.estado, EstadoOperacion.pendiente);
    expect(op.totalReferenciaCentavos, 43800);
    expect(await carrito.lineas(), isEmpty);
  });

  test('sin red el pedido sigue pendiente; al volver se envía con la misma clave y Ventas registra uno solo', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa();
    final ventas = VentasFalsas()..fallos.add(SinConexion());
    await Carrito(almacen).agregar(producto, variante(idM, 'M'), 2);
    final op = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);

    expect(await sincronizar.ejecutar(), 0);
    var guardada = (await almacen.operaciones()).single;
    expect([guardada.estado, guardada.intentos], [EstadoOperacion.pendiente, 1]);
    expect(guardada.proximoIntento, ahora.add(const Duration(seconds: 5)));
    expect(await sincronizar.ejecutar(), 0, reason: 'respeta la espera');

    // La red vuelve pero se corta tras registrar el pedido: la respuesta se pierde (el caso de «se registra dos veces»).
    ventas.perderRespuesta = true;
    ahora = ahora.add(const Duration(seconds: 6));
    expect(await sincronizar.ejecutar(), 0);
    ahora = ahora.add(const Duration(seconds: 11));
    expect(await sincronizar.ejecutar(), 1);

    guardada = (await almacen.operaciones()).single;
    expect(guardada.estado, EstadoOperacion.confirmada);
    expect(guardada.resultado!.identificador, op.identificador);
    expect([ventas.envios, ventas.pedidos.length, ventas.claves.keys.single], [3, 1, op.claveIdempotencia]);

    // Reenvío forzado de la misma operación: mismo pedido, ninguno nuevo.
    final repetido = await sincronizar.reenviar(guardada);
    expect([repetido.identificador, ventas.pedidos.length], [op.identificador, 1]);
  });

  test('un 4xx definitivo pide revisión; un pedido de otra sesión o sin token no se envía', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa();
    final ventas = VentasFalsas();
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);

    sesion.actual = const Titular(sub: 'otra', usuario: 'otra', nombre: 'Otra', roles: {});
    await sincronizar.ejecutar();
    sesion
      ..actual = SesionFalsa().actual
      ..token = null;
    await sincronizar.ejecutar();
    expect(ventas.envios, 0);

    sesion.token = 'token';
    ventas.fallos.add(ErrorRemoto(422, 'Variante inexistente.'));
    await sincronizar.ejecutar();
    final op = (await almacen.operaciones()).single;
    expect([op.estado, op.error], [EstadoOperacion.requiereRevision, 'Variante inexistente.']);
  });

  test('403 detiene los reintentos; 401 y 503 conservan el pedido y su clave hasta confirmar', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa();
    final ventas = VentasFalsas()..fallos.add(ErrorRemoto(403, 'Sin permiso para comprar.'));
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    final op = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);

    expect(await sincronizar.ejecutar(), 0);
    final rechazada = (await almacen.operaciones()).single;
    expect(rechazada.estado, EstadoOperacion.requiereRevision);
    expect(rechazada.error, 'Sin permiso para comprar.');
    expect(rechazada.claveIdempotencia, op.claveIdempotencia);
    await sincronizar.ejecutar(forzar: true);
    expect(ventas.envios, 1, reason: 'ni siquiera el envío forzado reintenta un 403');

    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    final pendiente = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    for (final codigo in [401, 503]) {
      ventas.fallos.add(ErrorRemoto(codigo, 'Error temporal'));
      expect(await sincronizar.ejecutar(forzar: true), 0);
      final guardada = (await almacen.operaciones()).firstWhere((o) => o.identificador == pendiente.identificador);
      expect(guardada.estado, EstadoOperacion.pendiente);
      expect(guardada.claveIdempotencia, pendiente.claveIdempotencia);
      expect(guardada.solicitud, pendiente.solicitud);
    }
    expect(await sincronizar.ejecutar(forzar: true), 1);
    expect(ventas.pedidos.length, 1);
    expect(ventas.claves.keys.single, pendiente.claveIdempotencia);
  });

  test('un pedido entregado se refresca hasta quedar definitivo y con comprobante', () async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa();
    final ventas = VentasFalsas();
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    final op = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);
    await sincronizar.ejecutar();
    ventas.pedidos[op.identificador] = pedidoJson(op.identificador, comprobante: true);
    await sincronizar.actualizarEstados();
    expect((await almacen.operaciones()).single.resultado!.comprobanteDisponible, isTrue);
  });

  test('confirmaciones concurrentes comparten un pedido y una clave', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final sesion = SesionFalsa();
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    final confirmar = ConfirmarPedido(almacen, sesion, reloj);
    final operaciones = await Future.wait([confirmar.ejecutar(), confirmar.ejecutar(), confirmar.ejecutar()]);
    expect(operaciones.map((o) => o.identificador).toSet().length, 1);
    expect((await almacen.operaciones()).length, 1);
    expect(await almacen.carrito(), isEmpty);
  });

  test('si cambia la cuenta al obtener el token, ni el envío ni el reenvío usan la cuenta nueva', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final sesion = SesionQueCambia();
    final titularA = sesion.actual;
    final ventas = VentasFalsas();
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    final op = await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);
    expect(await sincronizar.ejecutar(), 0);
    expect(ventas.envios, 0);
    sesion.actual = titularA;
    await expectLater(sincronizar.reenviar(op), throwsA(isA<SinSesion>()));
    expect(ventas.envios, 0);
    expect((await almacen.operaciones()).single.claveIdempotencia, op.claveIdempotencia);
  });

  test('envíos simultáneos comparten un solo ciclo', () async {
    final almacen = await almacenEnMemoria();
    final ventas = VentasFalsas();
    final sesion = SesionFalsa();
    await Carrito(almacen).agregar(producto, variante(idM, 'M'));
    await ConfirmarPedido(almacen, sesion, reloj).ejecutar();
    final sincronizar = SincronizarPedidos(almacen, ventas, sesion, reloj);
    await Future.wait([sincronizar.ejecutar(), sincronizar.ejecutar(), sincronizar.ejecutar()]);
    expect(ventas.envios, 1);
  });
}
