import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../dominio/avisos.dart';
import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import 'rest.dart';

/// Preferencias y vínculo push en Clientes (REST de la tienda; el titular siempre es el del token).
class AvisosRest implements FuenteAvisos {
  AvisosRest(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<PreferenciasAvisos> preferencias(String token) async =>
      PreferenciasAvisos.desdeJson(
        (await _cliente.pedir(
          'GET',
          '/perfiles/yo/notificaciones',
          cabeceras: {'Authorization': 'Bearer $token'},
        ))['preferencias'],
      );

  @override
  Future<void> vincular(
    String instalacion,
    String tokenPush,
    String secreto,
    String token,
  ) => _cliente.pedir(
    'PUT',
    '/perfiles/yo/dispositivos/${Uri.encodeComponent(instalacion)}',
    cabeceras: {'Authorization': 'Bearer $token'},
    cuerpo: {'token': tokenPush, 'secreto': secreto},
  );

  @override
  Future<void> desvincular(String instalacion, String secreto) =>
      _cliente.pedir(
        'DELETE',
        '/dispositivos/${Uri.encodeComponent(instalacion)}',
        cabeceras: {'X-Clb-Instalacion-Secreto': secreto},
      );
}

/// Envía un cambio de preferencias de la cola con su versión esperada; un 409 (otro dispositivo cambió antes) pide revisión.
class ProcesadorPreferenciasAvisos implements ProcesadorOperacion {
  ProcesadorPreferenciasAvisos(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    final datos = op.datos!;
    final r = await _cliente.pedir(
      'PUT',
      '/perfiles/yo/notificaciones',
      cabeceras: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': op.claveIdempotencia,
      },
      cuerpo: {
        'push': datos['push'],
        'correo': datos['correo'],
        'versión': datos['versión'],
      },
    );
    final guardadas = PreferenciasAvisos.desdeJson(r['preferencias']);
    // El comprobante debe ser exactamente este cambio: versión siguiente y los mismos canales.
    if (guardadas.version != (datos['versión'] as int) + 1 ||
        guardadas.push != datos['push'] ||
        guardadas.correo != datos['correo']) {
      throw ContratoInvalido(
        'Las preferencias guardadas no corresponden a este cambio; se reintentará.',
      );
    }
    return {'preferencias': guardadas.json};
  }
}

/// UUID y secreto de esta instalación en FlutterSecureStorage (Keystore); se crean una vez y no salen del teléfono
/// salvo el secreto hacia Clientes, que guarda solo su huella.
class IdentidadInstalacionSegura implements IdentidadInstalacion {
  IdentidadInstalacionSegura([FlutterSecureStorage? almacen])
    : _almacen = almacen ?? const FlutterSecureStorage();
  final FlutterSecureStorage _almacen;

  @override
  Future<({String id, String secreto})> obtener() async {
    var id = await _almacen.read(key: 'instalacion_id');
    var secreto = await _almacen.read(key: 'instalacion_secreto');
    if (id == null || secreto == null) {
      final azar = Random.secure();
      id = nuevoUuid(azar);
      secreto = base64Url
          .encode(List<int>.generate(32, (_) => azar.nextInt(256)))
          .replaceAll('=', '');
      await _almacen.write(key: 'instalacion_id', value: id);
      await _almacen.write(key: 'instalacion_secreto', value: secreto);
    }
    return (id: id, secreto: secreto);
  }
}
