import 'dart:convert';

import 'package:clb_store/datos/rest.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'selecciona el propietario sin alterar consulta, cuerpo ni idempotencia',
    () async {
      final solicitudes = <http.Request>[];
      final cliente = ClienteJson(
        MockClient((solicitud) async {
          solicitudes.add(solicitud);
          return http.Response('{}', 200);
        }),
        base: 'https://api.clb.invalid/api/v1',
        destinos: const {
          '/pedidos': 'https://ventas.clb.invalid/api/v1',
          '/graphql': 'https://ia.clb.invalid/api/v1',
          '/perfiles': 'https://clientes.clb.invalid/api/v1',
        },
      );

      await cliente.pedir(
        'POST',
        '/pedidos',
        cabeceras: {
          'Idempotency-Key': 'misma-clave',
          'Authorization': 'Bearer sesion',
        },
        cuerpo: {'cantidad': 2},
      );
      await cliente.pedir(
        'GET',
        '/pedidos/un-pedido',
        consulta: {'límite': '10'},
      );
      await cliente.pedir(
        'POST',
        '/graphql',
        cuerpo: {'query': '{ stockBajo { sku } }'},
      );
      await cliente.pedir('GET', '/perfiles/yo/notificaciones');
      await cliente.pedir('GET', '/productos');
      await cliente.pedir('GET', '/pedidos-ajenos');

      expect(solicitudes.map((s) => s.url.host).toList(), [
        'ventas.clb.invalid',
        'ventas.clb.invalid',
        'ia.clb.invalid',
        'clientes.clb.invalid',
        'api.clb.invalid',
        'api.clb.invalid',
      ]);
      expect(solicitudes.first.url.path, '/api/v1/pedidos');
      expect(solicitudes.first.headers['Idempotency-Key'], 'misma-clave');
      expect(solicitudes.first.headers['Authorization'], 'Bearer sesion');
      expect(jsonDecode(solicitudes.first.body), {'cantidad': 2});
      expect(solicitudes[1].url.queryParameters['límite'], '10');
    },
  );

  test(
    'las descargas y los formularios usan también el destino de su contrato',
    () async {
      final destinos = <Uri>[];
      final cliente = ClienteJson(
        MockClient((solicitud) async {
          destinos.add(solicitud.url);
          return http.Response('{}', 200);
        }),
        destinos: const {
          '/reportes': 'https://ia.clb.invalid/api/v1',
          '/voz': 'https://ia.clb.invalid/api/v1',
        },
      );
      await cliente.bytes('/reportes/un-reporte/pdf');
      await cliente.multipart(
        '/voz',
        campos: {},
        archivo: http.MultipartFile.fromString('audio', 'audio de ensayo'),
      );
      expect(destinos.map((u) => u.toString()).toList(), [
        'https://ia.clb.invalid/api/v1/reportes/un-reporte/pdf',
        'https://ia.clb.invalid/api/v1/voz',
      ]);
    },
  );
}
