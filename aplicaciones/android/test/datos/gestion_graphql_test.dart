import 'dart:convert';

import 'package:clb_store/datos/administracion_rest.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/dominio/administracion.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// R5: la gestión del móvil usa GraphQL y conserva las garantías de la cola (misma clasificación de errores que REST).
http.Response _json(Object cuerpo, [int estado = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(cuerpo)),
  estado,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> _errorGraphQL(int estado, String codigo) => {
  'data': null,
  'errors': [
    {
      'message': 'rechazo $codigo',
      'extensions': {'codigo': codigo, 'estado_http': estado},
    },
  ],
};

Operacion _atender(String evento) {
  final ahora = DateTime.utc(2026, 11, 9);
  return Operacion(
    identificador: 'op-1',
    tipo: atenderAlerta,
    claveIdempotencia: 'op-1',
    titular: 'admin-sub',
    fechaCreacion: ahora,
    estado: EstadoOperacion.pendiente,
    intentos: 0,
    proximoIntento: ahora,
    carrito: const [],
    datos: {'evento': evento},
  );
}

void main() {
  test(
    'la alerta atendida desde la cola va por GraphQL con el token del titular',
    () async {
      final pedidas = <http.Request>[];
      final cliente = MockClient((r) async {
        pedidas.add(r);
        return _json({
          'data': {
            'atenderNotificacion': {'evento': 'e-1', 'estado': 'ATENDIDA'},
          },
        });
      });
      final r = await ProcesadorAtenderAlerta(
        ClienteJson(cliente, base: 'http://x/api/v1'),
      ).enviar(_atender('e-1'), 'tok');
      expect(r['notificacion']['estado'], 'ATENDIDA');
      expect(pedidas.single.url.path, '/api/v1/graphql');
      expect(pedidas.single.headers['Authorization'], 'Bearer tok');
      final cuerpo = jsonDecode(pedidas.single.body) as Map;
      expect(cuerpo['query'], contains('atenderNotificacion(evento: \$e)'));
      expect(cuerpo['variables'], {'e': 'e-1'});
    },
  );

  test(
    'estado_http se conserva: 503/429 se reintentan y 404/409/422 piden revisión',
    () async {
      for (final (estado, reintentable) in [
        (503, true),
        (429, true),
        (404, false),
        (409, false),
        (422, false),
      ]) {
        final cliente = MockClient(
          (_) async => _json(_errorGraphQL(estado, 'C$estado')),
        );
        final error =
            await ProcesadorAtenderAlerta(
                  ClienteJson(cliente, base: 'http://x/api/v1'),
                )
                .enviar(_atender('e-1'), 'tok')
                .then<Object?>((_) => null, onError: (Object e) => e);
        expect(
          error,
          isA<ErrorRemoto>().having((e) => e.estado, 'estado', estado),
        );
        expect(esReintentable(error!), reintentable, reason: 'estado $estado');
      }
    },
  );

  test(
    'un rechazo HTTP de la sesión (401/403) sigue llegando como antes',
    () async {
      final cliente = MockClient(
        (_) async => _json({
          'mensaje': 'No tienes permiso.',
          'código': 'ACCESO_DENEGADO',
        }, 403),
      );
      expect(
        AdministracionRest(
          ClienteJson(cliente, base: 'http://x/api/v1'),
        ).propuestas('tok'),
        throwsA(isA<ErrorRemoto>().having((e) => e.estado, 'estado', 403)),
      );
    },
  );

  test(
    'un resultado que no confirma la alerta se reintenta con la misma clave',
    () async {
      final cliente = MockClient(
        (_) async => _json({
          'data': {
            'atenderNotificacion': {'evento': 'otro', 'estado': 'ATENDIDA'},
          },
        }),
      );
      expect(
        ProcesadorAtenderAlerta(
          ClienteJson(cliente, base: 'http://x/api/v1'),
        ).enviar(_atender('e-1'), 'tok'),
        throwsA(isA<ContratoInvalido>()),
      );
    },
  );

  test(
    'misión y reporte por mutación; los alias devuelven los nombres del dominio',
    () async {
      final consultas = <String>[];
      final cliente = MockClient((r) async {
        final q = (jsonDecode(r.body) as Map)['query'] as String;
        consultas.add(q);
        return _json({
          'data': q.contains('ejecutarMision')
              ? {
                  'ejecutarMision': {
                    'mision': 'm',
                    'agentes': [],
                    'generativa': false,
                    'fecha': 'f',
                  },
                }
              : {
                  'generarReporte': {
                    'identificador': 'r-1',
                    'datos_al': '2026-11-09',
                  },
                },
        });
      });
      final gestion = AdministracionRest(
        ClienteJson(cliente, base: 'http://x/api/v1'),
      );
      expect((await gestion.mision('Monitorea', 'tok'))['mision'], 'm');
      expect(
        (await gestion.reporte('ventas por talla', 'tok'))['datos_al'],
        '2026-11-09',
      );
      expect(consultas.last, contains('datos_al: datosAl'));
    },
  );

  group('F1b-II: existencias por GraphQL', () {
    const varianteId = '0b6f7c1e-1a2b-4c3d-8e9f-001122334455';
    Map<String, dynamic> variante(int version) => {
      'identificador': varianteId,
      'identificador_producto': 'p1',
      'sku': 'CLB-M',
      'talla': 'M',
      'color': 'Negro',
      'física': 5,
      'reservada': 0,
      'disponible': 5,
      'mínimo': 2,
      'versión_sincronización': version,
    };
    Operacion movimiento() => operacionExistencias(
      tipo: registrarMovimiento,
      variante: VarianteAdmin.validar(variante(3)),
      cuerpo: {'tipo': 'ENTRADA', 'cantidad': 2, 'motivo': 'Recuento'},
      titular: 'admin-sub',
      ahora: DateTime.utc(2026, 11, 9),
      cola: const [],
    );

    test(
      'el movimiento lleva la misma clave y versión en cada reintento',
      () async {
        final cuerpos = <Map>[];
        final cliente = MockClient((r) async {
          cuerpos.add(jsonDecode(r.body) as Map);
          return _json({
            'data': {
              'registrarMovimiento': {'variante': variante(4)},
            },
          });
        });
        final procesador = ProcesadorExistencias(
          ClienteJson(cliente, base: 'http://x/api/v1'),
        );
        final op = movimiento();
        await procesador.enviar(op, 'tok');
        await procesador.enviar(op, 'tok');
        expect(
          cuerpos[0]['query'],
          contains(
            'registrarMovimiento(variante: \$v, clave: \$c, datos: \$d)',
          ),
        );
        expect(cuerpos[0]['variables']['c'], op.claveIdempotencia);
        expect(cuerpos[0]['variables']['v'], varianteId);
        expect(cuerpos[0]['variables']['d']['versión_esperada'], 3);
        expect(
          cuerpos[0]['variables']['d'].containsKey('identificador_variante'),
          isFalse,
        );
        expect(jsonEncode(cuerpos[0]), jsonEncode(cuerpos[1]));
      },
    );

    test(
      'conflicto 409 pide revisión; comprobante con otra versión se reintenta',
      () async {
        final conflicto = MockClient(
          (_) async => _json(_errorGraphQL(409, 'CONFLICTO_VERSION')),
        );
        final error =
            await ProcesadorExistencias(
                  ClienteJson(conflicto, base: 'http://x/api/v1'),
                )
                .enviar(movimiento(), 'tok')
                .then<Object?>((_) => null, onError: (Object e) => e);
        expect(esReintentable(error!), isFalse);
        final desfasado = MockClient(
          (_) async => _json({
            'data': {
              'registrarMovimiento': {'variante': variante(9)},
            },
          }),
        );
        expect(
          ProcesadorExistencias(
            ClienteJson(desfasado, base: 'http://x/api/v1'),
          ).enviar(movimiento(), 'tok'),
          throwsA(isA<ContratoInvalido>()),
        );
      },
    );
  });
}
