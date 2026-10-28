import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:clb_store/datos/detector_movenet.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/datos/sesion_keycloak.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../apoyo.dart';

Map<String, dynamic> productoJson(String id, {String nombre = 'Camisa'}) => {
  'identificador': id,
  'sku': 'CLB-$id',
  'nombre': nombre,
  'descripción': 'Prenda',
  'categoría': 'Camisas',
  'precio': '219.00',
  'moneda': 'BOB',
  'activo': true,
  'fecha_creación': '2026-10-22T13:14:30Z',
  'fecha_actualización': '2026-10-22T13:14:30Z',
  'versión_sincronización': 1,
};

http.Response json(Object cuerpo, [int estado = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(cuerpo)), estado, headers: {'content-type': 'application/json'});

void main() {
  group('SQLite', () {
    test('los parámetros SQL son datos y un reemplazo fallido revierte toda la transacción', () async {
      final almacen = await almacenEnMemoria();
      addTearDown(almacen.cerrar);
      final fecha = DateTime.utc(2026, 10, 22);
      await almacen.reemplazarCatalogo([producto], [variante(idM, 'M')], fecha);
      expect(await almacen.variantes("' OR 1=1 --"), isEmpty);
      await expectLater(
        almacen.reemplazarCatalogo([producto, producto], [], fecha.add(const Duration(days: 1))),
        throwsA(anything),
      );
      expect((await almacen.productos()).single.identificador, producto.identificador);
      expect((await almacen.variantes(producto.identificador)).single.identificador, idM);
      expect(await almacen.fechaCatalogo(), fecha);
    });

    test('el catálogo se reemplaza entero y las variantes salen en orden de tienda', () async {
      final almacen = await almacenEnMemoria();
      await almacen.reemplazarCatalogo(
        [producto],
        [variante(idL, 'XL'), variante(idM, 'M'), variante(nuevoUuid(), 'S')],
        DateTime.utc(2026, 10, 22),
      );
      expect((await almacen.productos()).single.precioCentavos, 21900);
      expect([for (final v in await almacen.variantes(producto.identificador)) v.talla], ['S', 'M', 'XL']);
      expect(await almacen.fechaCatalogo(), DateTime.utc(2026, 10, 22));
      await almacen.reemplazarCatalogo([], [], DateTime.utc(2026, 10, 23));
      expect(await almacen.variantes(producto.identificador), isEmpty);
    });

    test(
      'el carrito conserva el orden al cambiar cantidades y encolar el pedido lo vacía en la misma transacción',
      () async {
        final almacen = await almacenEnMemoria();
        final m = LineaCarrito.desdeJson({
          ...{
            'identificador_variante': idM,
            'identificador_producto': producto.identificador,
            'sku': 'A',
            'nombre': 'Camisa',
          },
          ...{'talla': 'M', 'color': 'Blanco', 'precio_centavos': 21900, 'cantidad': 1},
        });
        final l = LineaCarrito.desdeJson({...m.aJson(), 'identificador_variante': idL, 'talla': 'L'});
        await almacen.guardarLinea(m);
        await almacen.guardarLinea(l);
        await almacen.guardarLinea(m.conCantidad(3));
        expect([for (final x in await almacen.carrito()) '${x.talla}${x.cantidad}'], ['M3', 'L1']);

        final op = Operacion.pedido(await almacen.carrito(), 'sub', DateTime.utc(2026, 10, 22));
        await almacen.encolarPedido(op);
        expect(await almacen.carrito(), isEmpty);
        final guardada = (await almacen.operaciones()).single;
        expect(
          [guardada.identificador, guardada.claveIdempotencia, guardada.totalReferenciaCentavos],
          [op.identificador, op.claveIdempotencia, 21900 * 4],
        );
        expect(guardada.solicitud, op.solicitud);
      },
    );

    test('una operación que quedó ENVIANDO vuelve a PENDIENTE con la misma clave al arrancar', () async {
      final almacen = await almacenEnMemoria();
      final op = Operacion.pedido(
        [
          LineaCarrito.desdeJson({
            ...{
              'identificador_variante': idM,
              'identificador_producto': producto.identificador,
              'sku': 'A',
              'nombre': 'Camisa',
            },
            ...{'talla': 'M', 'color': 'Blanco', 'precio_centavos': 21900, 'cantidad': 1},
          }),
        ],
        'sub',
        DateTime.utc(2026, 10, 22),
      );
      await almacen.encolarPedido(op);
      await almacen.guardarOperacion(op.copiar(estado: EstadoOperacion.enviando));
      await almacen.recuperarEnviando();
      final recuperada = (await almacen.operaciones()).single;
      expect([recuperada.estado, recuperada.claveIdempotencia], [EstadoOperacion.pendiente, op.claveIdempotencia]);
    });
  });

  group('REST', () {
    test('descarga todas las páginas del catálogo con parámetros en español', () async {
      final ids = List.generate(150, (i) => i.toRadixString(16).padLeft(32, '0'));
      final pedidas = <Uri>[];
      final cliente = MockClient((r) async {
        pedidas.add(r.url);
        final pagina = int.parse(r.url.queryParameters['página']!);
        return json({
          'productos': [for (final id in ids.skip((pagina - 1) * 100).take(100)) productoJson(id)],
          'paginación': {'página': pagina, 'límite': 100, 'total': 150, 'páginas': 2},
        });
      });
      final productos = await CatalogoRest(ClienteJson(cliente, base: 'http://x/api/v1')).productos();
      expect(productos.length, 150);
      expect(pedidas.map((u) => u.queryParameters['límite']), ['100', '100']);
    });

    test('si el total cambia durante la descarga no se acepta un catálogo a medias', () async {
      var total = 150;
      final cliente = MockClient(
        (r) async => json({
          'productos': [for (var i = 0; i < 100; i++) productoJson(i.toRadixString(16).padLeft(32, '0'))],
          'paginación': {'página': int.parse(r.url.queryParameters['página']!), 'total': total++},
        }),
      );
      expect(CatalogoRest(ClienteJson(cliente, base: 'http://x/api/v1')).productos(), throwsA(isA<ContratoInvalido>()));
    });

    test('solo se guardan variantes activas del producto pedido', () async {
      final base = {
        'sku': 'S',
        'talla': 'M',
        'color': 'Azul',
        'disponible': 3,
        'identificador_producto': producto.identificador,
      };
      final cliente = MockClient(
        (r) async => json({
          'variantes': [
            {...base, 'identificador': idM, 'activo': true},
            {...base, 'identificador': idL, 'activo': false},
          ],
        }),
      );
      final variantes = await CatalogoRest(
        ClienteJson(cliente, base: 'http://x/api/v1'),
      ).variantes(producto.identificador);
      expect(variantes.map((v) => v.identificador), [idM]);
    });

    test('el pedido viaja con su Idempotency-Key, el token y exactamente el cuerpo de la operación', () async {
      final op = Operacion.pedido(
        [
          LineaCarrito.desdeJson({
            ...{
              'identificador_variante': idM,
              'identificador_producto': producto.identificador,
              'sku': 'A',
              'nombre': 'Camisa',
            },
            ...{'talla': 'M', 'color': 'Blanco', 'precio_centavos': 21900, 'cantidad': 2},
          }),
        ],
        'sub',
        DateTime.utc(2026, 10, 22),
      );
      late http.Request recibida;
      final cliente = MockClient((r) async {
        recibida = r;
        return json({'pedido': pedidoJson(op.identificador)}, 201);
      });
      final pedido = await VentasRest(ClienteJson(cliente, base: 'http://x/api/v1')).confirmar(op, 'abc');
      expect(pedido.estado, EstadoPedido.confirmado);
      expect(recibida.headers['Idempotency-Key'], op.claveIdempotencia);
      expect(recibida.headers['Authorization'], 'Bearer abc');
      expect(jsonDecode(recibida.body), {
        'identificador': op.identificador,
        'líneas': [
          {'identificador_variante': idM, 'cantidad': 2},
        ],
      });
    });

    test('los errores se traducen al dominio: estado HTTP, sin red y respuesta ilegible', () async {
      Future<void> pedir(MockClient c) => ClienteJson(c, base: 'http://x/api/v1').pedir('GET', '/productos');
      await expectLater(
        pedir(MockClient((_) async => json({'mensaje': 'Caído'}, 503))),
        throwsA(isA<ErrorRemoto>().having((e) => e.estado, 'estado', 503).having((e) => e.mensaje, 'mensaje', 'Caído')),
      );
      await expectLater(
        pedir(MockClient((_) async => throw const SocketException('sin red'))),
        throwsA(isA<SinConexion>()),
      );
      await expectLater(pedir(MockClient((_) async => http.Response('<html>', 200))), throwsA(isA<ContratoInvalido>()));
    });
  });

  test('el titular sale de los claims del token de Keycloak', () {
    String parte(Object o) => base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
    final jwt =
        '${parte({'alg': 'RS256'})}.${parte({
          'sub': 'c820b640-d877-45f3-ab1f-e0740c6b4cd4',
          'preferred_username': 'cliente.demo',
          'name': 'Cliente Demostración',
          'exp': 1792710636,
          'realm_access': {
            'roles': ['cliente', 'offline_access'],
          },
        })}.firma';
    final t = titularDesdeToken(jwt);
    expect(
      [t.sub, t.usuario, t.nombre],
      ['c820b640-d877-45f3-ab1f-e0740c6b4cd4', 'cliente.demo', 'Cliente Demostración'],
    );
    expect(t.roles, contains('cliente'));
    expect(vencimientoDe(jwt), DateTime.fromMillisecondsSinceEpoch(1792710636000, isUtc: true));
  });

  group('MoveNet', () {
    test('el modelo empaquetado es el MoveNet Lightning v4 verificado', () {
      final hash = sha256.convert(File(DetectorMoveNet.recurso).readAsBytesSync()).toString();
      expect(hash, '0fac2226112d0371903ca86e3853cec24ef603a0b2f96f589b180f0ebdd135ab');
    });

    test('la foto se orienta, se rellena a cuadrado y se reduce a 192 × 192 RGB', () {
      final r = prepararImagen(File('test/fixtures/persona.jpg').readAsBytesSync(), ladoMaximo: 640);
      expect(r.rgb.length, 192 * 192 * 3);
      expect(r.alto, 640);
      expect(r.ancho, lessThan(640));
      expect(r.jpg.sublist(0, 2), [0xFF, 0xD8]);
    });

    test('los puntos normalizados del cuadrado vuelven a píxeles de la imagen', () {
      final salida = Float32List(51);
      salida.setAll(5 * 3, [0.25, 0.5, 0.9]); // hombro izquierdo: y, x, confianza
      final p = puntosDesdeSalida(salida, 300, 400)[5];
      expect([p.x, p.y, p.confianza], [200, 100, closeTo(0.9, 1e-6)]);
      expect(() => puntosDesdeSalida(Float32List(10), 1, 1), throwsFormatException);
    });
  });
}
