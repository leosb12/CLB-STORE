// Capa de datos de la app contra el stack Docker real (pasarela 127.0.0.1:18000):
//   CLB_INTEGRACION=1 flutter test test/integracion
// Crea un pedido real de 1 unidad (igual que las demostraciones) con el usuario cliente.demo. El token se obtiene con el
// cliente local clb-demostracion (password grant, solo scripts); la app usa Code + PKCE.
library;

import 'dart:convert';
import 'dart:io';

import 'package:clb_store/datos/recursos_prendas.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/datos/sesion_keycloak.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/tallas.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../apoyo.dart';

final _activa = Platform.environment['CLB_INTEGRACION'] == '1';

Future<String> tokenClienteDemo() async {
  final env = {
    for (final l in File('../../infraestructura/bases-de-datos/.env').readAsLinesSync())
      if (l.contains('=') && !l.startsWith('#')) l.substring(0, l.indexOf('=')): l.substring(l.indexOf('=') + 1),
  };
  final r = await http.post(
    Uri.parse('${SesionKeycloak.emisor}/protocol/openid-connect/token'),
    body: {
      'grant_type': 'password',
      'client_id': 'clb-demostracion',
      'username': 'cliente.demo',
      'password': env['CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO']!,
      'scope': 'openid',
    },
  );
  expect(r.statusCode, 200, reason: r.body);
  return jsonDecode(r.body)['access_token'] as String;
}

class SesionConToken implements Sesion {
  SesionConToken(this.token);
  final String token;
  @override
  Future<Titular?> titular() async => titularDesdeToken(token);
  @override
  Future<String?> tokenVigente() async => token;
  @override
  Future<Titular> iniciar() => throw UnimplementedError();
  @override
  Future<void> cerrar() async {}
}

void main() {
  test(
    'catálogo, modelo de tallas y compra idempotente contra la pasarela real',
    () async {
      final cliente = ClienteJson(http.Client());
      final almacen = await almacenEnMemoria();
      final sesion = SesionConToken(await tokenClienteDemo());

      // Catálogo completo con variantes y modelo de tallas, guardados en SQLite.
      // Prendas con foto publicada: sus texturas (y la espalda del modelo 3D) se descargan y verifican como en la app.
      final texturas = await Directory.systemTemp.createTemp('clb_texturas_');
      addTearDown(() => texturas.delete(recursive: true));
      await SincronizarCatalogo(CatalogoRest(cliente), almacen, null,
          RecursosPrendas(texturas.path, http.Client(), pasarela)).ejecutar();
      final productos = await almacen.productos();
      expect(productos, isNotEmpty);
      expect(await RecomendarTalla(almacen).modelo(), isA<ModeloTallas>());
      Producto? producto;
      Variante? variante;
      for (final p in productos) {
        final conStock = (await almacen.variantes(p.identificador)).where((v) => v.disponible > 5);
        if (conStock.isNotEmpty) {
          producto = p;
          variante = conStock.first;
          break;
        }
      }
      expect(variante, isNotNull, reason: 'se necesita una variante con stock (sembrar-gestion.py)');

      // Pedido por la cola: SAGA real en Ventas, Inventario y Clientes.
      await Carrito(almacen).agregar(producto!, variante!);
      final op = await ConfirmarPedido(almacen, sesion).ejecutar();
      final ventas = VentasRest(cliente);
      expect(await SincronizarPedidos(almacen, ventas, sesion).ejecutar(), 1);
      final confirmada = (await almacen.operaciones()).single;
      expect(confirmada.resultado!.estado, EstadoPedido.confirmado);
      expect(confirmada.resultado!.json['identificador_cliente'], titularDesdeToken(sesion.token).sub);

      // Reenvío con la misma Idempotency-Key: mismo pedido, sin una segunda reserva (el stock no vuelve a bajar).
      final antes = (await CatalogoRest(
        cliente,
      ).variantes(producto.identificador)).firstWhere((v) => v.identificador == variante!.identificador).disponible;
      final repetido = await ventas.confirmar(op, sesion.token);
      expect(repetido.identificador, op.identificador);
      final despues = (await CatalogoRest(
        cliente,
      ).variantes(producto.identificador)).firstWhere((v) => v.identificador == variante!.identificador).disponible;
      expect(despues, antes);

      // La misma clave con otro cuerpo es un conflicto definitivo, no un pedido nuevo.
      final otra = Operacion(
        identificador: nuevoUuid(),
        tipo: op.tipo,
        claveIdempotencia: op.claveIdempotencia,
        titular: op.titular,
        fechaCreacion: op.fechaCreacion,
        estado: EstadoOperacion.pendiente,
        intentos: 0,
        proximoIntento: op.fechaCreacion,
        carrito: op.carrito,
      );
      await expectLater(
        ventas.confirmar(otra, sesion.token),
        throwsA(isA<ErrorRemoto>().having((e) => esReintentable(e), 'reintentable', isFalse)),
      );
    },
    skip: _activa ? false : 'Requiere el stack Docker: CLB_INTEGRACION=1',
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
