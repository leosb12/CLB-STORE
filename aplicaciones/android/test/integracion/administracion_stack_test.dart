// Administración desde el móvil contra el stack Docker real (pasarela 127.0.0.1:18000):
//   CLB_INTEGRACION=1 flutter test test/integracion/administracion_stack_test.dart
// Crea una prenda [DEMO] propia (SKU único) con admin.demo; no toca productos reales.
library;

import 'dart:convert';
import 'dart:io';

import 'package:clb_store/datos/administracion_rest.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/datos/sesion_keycloak.dart';
import 'package:clb_store/dominio/administracion.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../apoyo.dart';
import 'stack_test.dart' show SesionConToken;

final _activa = Platform.environment['CLB_INTEGRACION'] == '1';
final _raiz = '../../';

Future<String> tokenAdminDemo() async {
  final env = {
    for (final l in File('${_raiz}infraestructura/bases-de-datos/.env').readAsLinesSync())
      if (l.contains('=') && !l.startsWith('#')) l.substring(0, l.indexOf('=')): l.substring(l.indexOf('=') + 1),
  };
  final r = await http.post(Uri.parse('${SesionKeycloak.emisor}/protocol/openid-connect/token'), body: {
    'grant_type': 'password', 'client_id': 'clb-demostracion', 'username': 'admin.demo',
    'password': env['CLB_IDENTIDAD_CLAVE_ADMIN_DEMO']!, 'scope': 'openid',
  });
  expect(r.statusCode, 200, reason: r.body);
  return jsonDecode(r.body)['access_token'] as String;
}

void main() {
  test('existencias offline → reconexión una sola vez, versión encadenada e ingesta de foto con calidad y publicación', () async {
    final token = await tokenAdminDemo();
    final cliente = ClienteJson(http.Client());
    final api = AdministracionRest(cliente);
    final sufijo = nuevoUuid().substring(0, 6).toUpperCase();
    final con = {'Authorization': 'Bearer $token'};

    // Prenda [DEMO] con una variante sin stock.
    final producto = (await cliente.pedir('POST', '/productos', cabeceras: {...con, 'Idempotency-Key': nuevoUuid()}, cuerpo: {
      'sku': 'CLB-MOVIL-$sufijo', 'nombre': '[DEMO] Buzo móvil $sufijo', 'descripción': 'Prueba de administración móvil.',
      'categoría': 'Buzos', 'precio': '150.00', 'activo': true,
    }))['producto'] as Map<String, dynamic>;
    final idProducto = producto['identificador'] as String;
    final idVariante = nuevoUuid();
    await cliente.pedir('POST', '/productos/$idProducto/variantes', cabeceras: {...con, 'Idempotency-Key': nuevoUuid()}, cuerpo: {
      'identificador': idVariante, 'sku': 'CLB-MOVIL-$sufijo-M', 'talla': 'M', 'color': 'Azul', 'activo': true,
    });
    final variante = (await api.variantesAdmin(idProducto, token)).single;
    expect(variante.disponible, 0);

    // «Modo avión»: la misma cola con un procesador que no alcanza la pasarela.
    final almacen = await almacenEnMemoria();
    final sesion = SesionConToken(token);
    final sinRed = ProcesadorExistencias(ClienteJson(http.Client(), base: 'http://127.0.0.1:9/api/v1'));
    final conRed = ProcesadorExistencias(cliente);
    final ahora = DateTime.now();
    Future<Operacion> encolar(int cantidad, DateTime fecha) async {
      final op = operacionExistencias(tipo: registrarMovimiento, variante: variante,
          cuerpo: {'tipo': 'ENTRADA', 'cantidad': cantidad, 'motivo': 'Recepción desde el móvil (prueba)'},
          titular: (await sesion.titular())!.sub, ahora: fecha, cola: await almacen.operaciones());
      await almacen.encolarOperacion(op);
      return op;
    }
    final primera = await encolar(5, ahora);
    final segunda = await encolar(3, ahora.add(const Duration(seconds: 1)));
    await SincronizarPedidos(almacen, VentasFalsas(), sesion, null, {registrarMovimiento: sinRed}).ejecutar(forzar: true);
    Future<Operacion> leer(Operacion o) async => (await almacen.operaciones()).firstWhere((x) => x.identificador == o.identificador);
    expect((await leer(primera)).estado, EstadoOperacion.pendiente);
    expect((await leer(primera)).error, isNotNull);

    // Reconexión: la primera confirma; la segunda toma su versión del comprobante y confirma en el ciclo siguiente.
    final sincronizar = SincronizarPedidos(almacen, VentasFalsas(), sesion, null, {registrarMovimiento: conRed});
    await sincronizar.ejecutar(forzar: true);
    await sincronizar.ejecutar(forzar: true);
    expect((await leer(primera)).estado, EstadoOperacion.confirmada);
    final s = await leer(segunda);
    expect(s.estado, EstadoOperacion.confirmada);
    expect(s.datos!['versión_esperada'], 2);

    // Repetir la primera con su misma clave (respuesta perdida) devuelve el comprobante original y no suma stock.
    await conRed.enviar(await leer(primera), token);
    final final_ = (await api.variantesAdmin(idProducto, token)).single;
    expect(final_.disponible, 8);
    expect(final_.version, 3);

    // Ingesta: foto real de la colección → informe de calidad → publicación (con avisos solo si se aceptan).
    final foto = File('${_raiz}compartido/prendas/ingesta/buzo-azul-capucha.png').readAsBytesSync();
    final clave = nuevoUuid();
    final carga = await api.cargar(idProducto, clave, producto['versión_sincronización'] as int, 'Azul', foto, token);
    expect((carga['trabajo'] as Map)['estado'], isIn(['PENDIENTE', 'PROCESANDO']));
    Map<String, dynamic> trabajo = {};
    for (var i = 0; i < 60; i++) {
      trabajo = (await api.trabajo(idProducto, clave, token))['trabajo'] as Map<String, dynamic>;
      if (!const {'PENDIENTE', 'PROCESANDO'}.contains(trabajo['estado'])) break;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    expect(trabajo['estado'], 'LISTO', reason: '$trabajo');
    final calidad = trabajo['calidad'] as Map;
    expect(calidad['nivel'], isIn(['apta', 'con_avisos']));
    expect((await api.previsualizacion(idProducto, clave, token)).sublist(1, 4), utf8.encode('PNG'));
    final publicado = await api.publicar(idProducto, clave, nuevoUuid(), producto['versión_sincronización'] as int,
        calidad['nivel'] == 'con_avisos', token);
    expect((publicado['trabajo'] as Map)['estado'], 'PUBLICADO');
    final recurso = (await cliente.pedir('GET', '/productos/$idProducto'))['producto']['recurso_probador'] as Map;
    expect(recurso['modelo3d'], isNotNull);
    expect(recurso['espalda'], isNotNull);
  }, skip: !_activa, timeout: const Timeout(Duration(minutes: 4)));
}
