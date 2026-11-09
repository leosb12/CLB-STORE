// Gestión por GraphQL con el servicio IA caído (lo detiene y lo vuelve a iniciar):
//   CLB_INTEGRACION=1 CLB_PRUEBA_IA_CAIDA=1 flutter test test/integracion/ia_caida_stack_test.dart
// Usa la variante de prueba indicada en CLB_PRUEBA_VARIANTE (p. ej. una [PRUEBA F1b]); no toca productos reales.
library;

import 'dart:io';

import 'package:clb_store/datos/administracion_rest.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/dominio/administracion.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../apoyo.dart';
import 'administracion_stack_test.dart' show tokenAdminDemo;
import 'stack_test.dart' show SesionConToken;

final _env = Platform.environment;
final _activa = _env['CLB_INTEGRACION'] == '1' && _env['CLB_PRUEBA_IA_CAIDA'] == '1' && _env['CLB_PRUEBA_VARIANTE'] != null;

Future<void> _docker(String accion) async {
  final r = await Process.run('docker', [accion, 'clb_backend_ia']);
  expect(r.exitCode, 0, reason: '${r.stderr}');
}

Future<void> _esperarIa() async {
  for (var i = 0; i < 90; i++) {
    try {
      final r = await http.get(Uri.parse('http://127.0.0.1:18000/salud/ia')).timeout(const Duration(seconds: 3));
      if (r.statusCode == 200) return;
    } on Object {
      // Aún iniciando.
    }
    await Future<void>.delayed(const Duration(seconds: 2));
  }
  fail('IA no volvió a estar disponible');
}

void main() {
  test('con IA caída el movimiento queda pendiente y reintentable; al volver se aplica una sola vez', () async {
    final token = await tokenAdminDemo();
    final cliente = ClienteJson(http.Client());
    final api = AdministracionRest(cliente);
    final idVariante = _env['CLB_PRUEBA_VARIANTE']!;
    final producto = (await consultarGestion(cliente, token, r'query($v: String!) { varianteAdmin(variante: $v) }',
        variables: {'v': idVariante}))['varianteAdmin']['variante']['identificador_producto'] as String;
    final antes = (await api.variantesAdmin(producto, token)).singleWhere((v) => v.identificador == idVariante);

    final almacen = await almacenEnMemoria();
    final sesion = SesionConToken(token);
    final op = operacionExistencias(tipo: registrarMovimiento, variante: antes,
        cuerpo: {'tipo': 'ENTRADA', 'cantidad': 1, 'motivo': 'PRUEBA F1b IA caida'},
        titular: (await sesion.titular())!.sub, ahora: DateTime.now(), cola: await almacen.operaciones());
    await almacen.encolarOperacion(op);
    final sincronizar = SincronizarPedidos(almacen, VentasFalsas(), sesion, null, {registrarMovimiento: ProcesadorExistencias(cliente)});
    Future<Operacion> leer() async => (await almacen.operaciones()).single;

    await _docker('stop');
    try {
      await sincronizar.ejecutar(forzar: true);
      final pendiente = await leer();
      expect(pendiente.estado, EstadoOperacion.pendiente, reason: 'IA caída es transitorio: no pide revisión');
      expect(pendiente.error, isNotNull);
      expect(pendiente.claveIdempotencia, op.claveIdempotencia);
    } finally {
      await _docker('start');
    }
    await _esperarIa();
    await sincronizar.ejecutar(forzar: true);
    expect((await leer()).estado, EstadoOperacion.confirmada);
    // Respuesta perdida: reenviar la misma operación no suma de nuevo.
    await ProcesadorExistencias(cliente).enviar(await leer(), token);
    final despues = (await api.variantesAdmin(producto, token)).singleWhere((v) => v.identificador == idVariante);
    expect(despues.json['física'], (antes.json['física'] as int) + 1);
    expect(despues.version, antes.version + 1);
    await almacen.cerrar();
  }, skip: !_activa, timeout: const Timeout(Duration(minutes: 5)));
}
