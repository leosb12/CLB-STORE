import 'dart:convert';

import 'package:clb_store/datos/avisos_rest.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/dominio/avisos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response respuesta(Object cuerpo, [int estado = 200]) =>
    http.Response.bytes(utf8.encode(jsonEncode(cuerpo)), estado);

void main() {
  test('vincular acepta 204 y desvincular no requiere JWT anterior', () async {
    final solicitudes = <http.Request>[];
    final fuente = AvisosRest(ClienteJson(MockClient((r) async {
      solicitudes.add(r);
      return http.Response('', 204);
    })));
    await fuente.vincular('inst-1', 'push-falso', 'secreto-falso', 'jwt-falso');
    await fuente.desvincular('inst-1', 'secreto-falso');
    expect(solicitudes[0].headers['Authorization'], 'Bearer jwt-falso');
    expect(jsonDecode(solicitudes[0].body), {
      'token': 'push-falso', 'secreto': 'secreto-falso',
    });
    expect(solicitudes[1].method, 'DELETE');
    expect(solicitudes[1].headers['Authorization'], isNull);
    expect(solicitudes[1].headers['X-Clb-Instalacion-Secreto'], 'secreto-falso');
  });

  test('preferencias conserva ambos canales, versión y disponibilidad de correo', () async {
    final fuente = AvisosRest(ClienteJson(MockClient((_) async => respuesta({
      'preferencias': {'push': false, 'correo': true, 'versión': 4,
        'correo_disponible': true},
    }))));
    final p = await fuente.preferencias('jwt-falso');
    expect(p.push, isFalse);
    expect(p.correo, isTrue);
    expect(p.version, 4);
    expect(p.correoDisponible, isTrue);
  });

  test('reintento tras respuesta perdida conserva clave, titular y versión', () async {
    final solicitudes = <http.Request>[];
    final procesador = ProcesadorPreferenciasAvisos(ClienteJson(MockClient((r) async {
      solicitudes.add(r);
      if (solicitudes.length == 1) throw http.ClientException('respuesta perdida');
      return respuesta({'preferencias': {'push': false, 'correo': true, 'versión': 3}});
    })));
    final op = operacionPreferencias(push: false, correo: true, versionEsperada: 2,
        titular: 'cliente-a', ahora: DateTime.utc(2026, 11, 9));
    await expectLater(procesador.enviar(op, 'jwt-a'), throwsA(isA<SinConexion>()));
    final resultado = await procesador.enviar(op, 'jwt-a');
    expect(resultado['preferencias']['versión'], 3);
    expect(op.titular, 'cliente-a');
    expect(solicitudes[0].headers['Idempotency-Key'], op.claveIdempotencia);
    expect(solicitudes[1].headers['Idempotency-Key'], op.claveIdempotencia);
    expect(solicitudes[0].body, solicitudes[1].body);
    expect(jsonDecode(solicitudes[1].body)['versión'], 2);
  });

  test('conflicto 409 se conserva para revisión y no se confirma como éxito', () async {
    final procesador = ProcesadorPreferenciasAvisos(ClienteJson(MockClient((_) async =>
      respuesta({'mensaje': 'Otra sesión cambió las preferencias'}, 409))));
    final op = operacionPreferencias(push: true, correo: false, versionEsperada: 1,
        titular: 'cliente-a', ahora: DateTime.utc(2026, 11, 9));
    await expectLater(procesador.enviar(op, 'jwt-a'),
      throwsA(isA<ErrorRemoto>().having((e) => e.estado, 'estado', 409)));
  });

  test('una versión de respuesta ajena no confirma la operación', () async {
    final procesador = ProcesadorPreferenciasAvisos(ClienteJson(MockClient((_) async =>
      respuesta({'preferencias': {'push': true, 'correo': false, 'versión': 99}}))));
    final op = operacionPreferencias(push: true, correo: false, versionEsperada: 1,
        titular: 'cliente-a', ahora: DateTime.utc(2026, 11, 9));
    await expectLater(procesador.enviar(op, 'jwt-a'), throwsA(isA<ContratoInvalido>()));
  });

  test('versión correcta con canales distintos al cambio tampoco confirma', () async {
    final procesador = ProcesadorPreferenciasAvisos(ClienteJson(MockClient((_) async =>
      respuesta({'preferencias': {'push': true, 'correo': true, 'versión': 2}}))));
    final op = operacionPreferencias(push: true, correo: false, versionEsperada: 1,
        titular: 'cliente-a', ahora: DateTime.utc(2026, 11, 9));
    await expectLater(procesador.enviar(op, 'jwt-a'), throwsA(isA<ContratoInvalido>()));
  });
}
