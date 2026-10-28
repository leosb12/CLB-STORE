import 'dart:async';
import 'dart:convert';

import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../apoyo.dart';

class _VentasEnEspera extends VentasFalsas {
  final iniciada = Completer<void>();
  final respuesta = Completer<List<PedidoVenta>>();
  @override
  Future<List<PedidoVenta>> historial(String token) {
    iniciada.complete();
    return respuesta.future;
  }
}

void main() {
  test('historial REST completo, persistente por cuenta; un corte de página conserva copia y cola', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final sesion = SesionFalsa();
    final ahora = DateTime.utc(2026, 10, 22, 12);
    final a = pedidoJson(idM), b = pedidoJson(idL);
    var cortar = false;
    final cliente = MockClient((r) async {
      expect(r.headers['Authorization'], 'Bearer token');
      expect(r.url.path, '/api/v1/pedidos');
      if (r.url.queryParameters['antes'] == null) {
        return http.Response(
          jsonEncode({
            'pedidos': [a],
            'siguiente': idM,
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      expect(r.url.queryParameters['antes'], idM);
      if (cortar) throw http.ClientException('Sin red');
      return http.Response(
        jsonEncode({
          'pedidos': [b],
          'siguiente': null,
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    addTearDown(cliente.close);
    final caso = SincronizarPedidos(almacen, VentasRest(ClienteJson(cliente)), sesion, () => ahora);
    const linea = LineaCarrito(
      identificadorVariante: idM,
      identificadorProducto: 'p',
      sku: 's',
      nombre: 'Camisa',
      talla: 'M',
      color: 'Azul',
      precioCentavos: 100,
      cantidad: 1,
    );
    final operacion = Operacion.pedido([linea], sesion.actual!.sub, ahora);
    await almacen.encolarPedido(operacion);
    await caso.actualizarHistorial();
    var copia = (await almacen.historial(sesion.actual!.sub))!;
    expect(copia.pedidos.map((p) => p.identificador), [idM, idL]);
    expect(copia.fecha, ahora);
    expect(await almacen.historial('otra cuenta'), isNull);
    cortar = true;
    await expectLater(caso.actualizarHistorial(), throwsA(isA<SinConexion>()));
    copia = (await almacen.historial(sesion.actual!.sub))!;
    expect(copia.pedidos.length, 2);
    expect(copia.fecha, ahora);
    final cola = await almacen.operaciones();
    expect(cola.length, 1);
    expect(cola.single.claveIdempotencia, operacion.claveIdempotencia);
    expect(cola.single.estado, EstadoOperacion.pendiente);
  });

  test('una descarga tardía después de cerrar sesión no se guarda para otra cuenta', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final ventas = _VentasEnEspera(), sesion = SesionFalsa();
    final sub = sesion.actual!.sub;
    final caso = SincronizarPedidos(almacen, ventas, sesion);
    final descarga = caso.actualizarHistorial();
    await ventas.iniciada.future;
    await sesion.cerrar();
    ventas.respuesta.complete([PedidoVenta.desdeJson(pedidoJson(idM))]);
    await descarga;
    expect(await almacen.historial(sub), isNull);
    expect(await almacen.operaciones(), isEmpty);
  });

  test('historial de otra cuenta y cursor repetido se rechazan sin guardar una descarga parcial', () async {
    final almacen = await almacenEnMemoria();
    addTearDown(almacen.cerrar);
    final sesion = SesionFalsa(), ventas = VentasFalsas();
    ventas.pedidos[idM] = {...pedidoJson(idM), 'identificador_cliente': 'otra'};
    await expectLater(
      SincronizarPedidos(almacen, ventas, sesion).actualizarHistorial(),
      throwsA(isA<ContratoInvalido>()),
    );
    expect(await almacen.historial(sesion.actual!.sub), isNull);
    final cliente = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'pedidos': [pedidoJson(idM)],
          'siguiente': idM,
        }),
        200,
      ),
    );
    addTearDown(cliente.close);
    await expectLater(VentasRest(ClienteJson(cliente)).historial('token'), throwsA(isA<ContratoInvalido>()));
  });
}
