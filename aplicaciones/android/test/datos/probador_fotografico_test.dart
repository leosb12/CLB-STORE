import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:clb_store/datos/probador_fotografico_rest.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';

// Doble de contrato para almacenamiento/red. No representa una inferencia de CatVTON.
class SesionDeContrato implements Sesion {
  String cuenta = 'ana';
  @override
  Future<Titular?> titular() async =>
      Titular(sub: cuenta, usuario: cuenta, nombre: cuenta, roles: {'cliente'});
  @override
  Future<String?> tokenVigente() async => 'token-de-contrato';
  @override
  Future<Titular> iniciar() async => (await titular())!;
  @override
  Future<void> cerrar() async {
    cuenta = '';
  }
}

void main() {
  test(
    'caché fotográfica offline por titular, sin volver a subir la foto',
    () async {
      final carpeta = await Directory.systemTemp.createTemp('clb_prueba_vton_');
      final sesion = SesionDeContrato();
      var conectado = true, envios = 0;
      final fixture =
          jsonDecode(
                File(
                  '../../compartido/prendas/fixtures/ajuste-fotografico.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      final png = base64Decode(fixture['png_base64'] as String);
      final cliente = MockClient((solicitud) async {
        if (!conectado) throw const SocketException('Sin red en prueba');
        if (solicitud.method == 'POST') {
          envios++;
          expect(
            solicitud.headers['Authorization'],
            'Bearer token-de-contrato',
          );
          return http.Response(
            jsonEncode({'estado': 'LISTO', 'identificador': 'a' * 64}),
            202,
          );
        }
        return http.Response.bytes(
          png,
          200,
          headers: {'content-type': 'image/png'},
        );
      });
      final producto = Producto(
        identificador: 'p',
        sku: 'SKU',
        nombre: 'Polera',
        descripcion: '',
        categoria: 'Poleras',
        precioCentavos: 9900,
        fechaActualizacion: '2026-10-24T00:00:00Z',
      );
      final generador = ProbadorFotograficoRest(sesion, carpeta.path, cliente);
      final persona = Uint8List.fromList([1, 2, 3]);
      try {
        expect(
          await generador.generar(persona, png, producto, (_) {}, () => true),
          png,
        );
        expect(envios, 1);
        conectado = false;
        expect(
          await generador.generar(persona, png, producto, (_) {}, () => true),
          png,
        );
        expect(envios, 1);
        sesion.cuenta = 'bea';
        await expectLater(
          generador.generar(persona, png, producto, (_) {}, () => true),
          throwsA(isA<StateError>()),
        );
        await generador.borrarGuardadas();
        expect(await carpeta.list().length, 0);
      } finally {
        cliente.close();
        final raizTemporal = await Directory.systemTemp.resolveSymbolicLinks();
        final destino = await carpeta.resolveSymbolicLinks();
        expect(
          destino.startsWith(
            '$raizTemporal${Platform.pathSeparator}clb_prueba_vton_',
          ),
          isTrue,
        );
        await carpeta.delete(recursive: true);
      }
    },
  );
}
