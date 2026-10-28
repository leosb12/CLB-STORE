// Ensayo host optativo: SQLite real y transporte HTTP real hacia Keycloak/CatVTON.
// El corte se aplica en el adaptador HTTP de prueba; no demuestra ejecución en teléfono.
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:clb_store/datos/cola_generaciones_sqlite.dart';
import 'package:clb_store/datos/probador_fotografico_rest.dart';
import 'package:clb_store/dominio/cola_generaciones.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';

class _SesionEnsayo implements Sesion {
  _SesionEnsayo(this.token, this.sub);
  final String token, sub;
  @override
  Future<Titular?> titular() async => Titular(
    sub: sub,
    usuario: 'cliente.demo',
    nombre: 'Ensayo',
    roles: {'cliente'},
  );
  @override
  Future<String?> tokenVigente() async => token;
  @override
  Future<Titular> iniciar() async => (await titular())!;
  @override
  Future<void> cerrar() async {}
}

class _EnlaceEnsayo extends http.BaseClient {
  bool conectado = false;
  int envios = 0;
  final cliente = http.Client();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    if (!conectado) throw const SocketException('Enlace cortado por el ensayo');
    if (request.method == 'POST') envios++;
    return cliente.send(request);
  }

  @override
  void close() => cliente.close();
}

void main() {
  const configuracion = String.fromEnvironment('CLB_VTON_SESION');
  test(
    'cola host contra CLB: corte, reapertura, sincronización inmediata y borrado remoto real',
    () async {
      sqfliteFfiInit();
      final acceso =
          jsonDecode(await File(configuracion).readAsString())
              as Map<String, dynamic>;
      final sesion = _SesionEnsayo(acceso['token'], acceso['sub']);
      final raiz = Directory.current.parent.parent.path;
      final temporal = await Directory.systemTemp.createTemp(
        'clb_prueba_vton_real_',
      );
      final ruta = '${temporal.path}/cola.db';
      var almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        ruta,
        '${temporal.path}/imagenes',
      );
      final enlace = _EnlaceEnsayo();
      final motor = ProbadorFotograficoRest(
        sesion,
        '${temporal.path}/imagenes',
        enlace,
      );
      var cola = ColaGeneraciones(almacen, motor, sesion);
      final producto = Producto(
        identificador: 'qa-cola-host-${DateTime.now().millisecondsSinceEpoch}',
        sku: 'QA',
        nombre: 'Ensayo público',
        descripcion: '',
        categoria: 'Poleras',
        precioCentavos: 0,
        fechaActualizacion: '',
      );
      final persona = await File(
        '$raiz/investigacion/probador-realismo/fixtures/persona-base.jpg',
      ).readAsBytes();
      final prenda = await File(
        '$raiz/compartido/prendas/originales/polera-roja.png',
      ).readAsBytes();
      try {
        await cola.encolar(persona, prenda, producto);
        for (var i = 0; i < 100; i++) {
          final trabajo = (await cola.listar()).single;
          if (trabajo.estado == 'PENDIENTE' && trabajo.intentos > 0) break;
          await Future<void>.delayed(const Duration(milliseconds: 50));
        }
        expect((await cola.listar()).single.estado, 'PENDIENTE');
        await almacen.db.close();
        almacen = await ColaGeneracionesSqlite.abrir(
          databaseFactoryFfi,
          ruta,
          '${temporal.path}/imagenes',
        );
        cola = ColaGeneraciones(almacen, motor, sesion);
        expect((await cola.listar()).single.persona, persona);
        enlace.conectado = true;
        await cola.sincronizar(forzar: true);
        final listo = (await cola.listar()).single;
        expect(listo.estado, 'LISTO', reason: listo.mensaje);
        expect(
          File(listo.rutaResultado!).lengthSync(),
          greaterThan(10000),
        );
        expect(listo.persona, isNull);
        expect(enlace.envios, 1);
        await cola.eliminar(listo);
        for (
          var i = 0;
          i < 100 && (await almacen.borrados(acceso['sub'])).isNotEmpty;
          i++
        ) {
          await cola.sincronizar();
          await Future<void>.delayed(const Duration(milliseconds: 100));
        }
        expect(await cola.listar(), isEmpty);
        expect(await almacen.borrados(acceso['sub']), isEmpty);
        final respuesta = await enlace.get(
          Uri.parse(
            'http://127.0.0.1:18000/api/v1/probador/trabajos/${listo.clave}',
          ),
          headers: {'Authorization': 'Bearer ${acceso['token']}'},
        );
        expect(respuesta.statusCode, 404);
        expect(await Directory('${temporal.path}/imagenes').list().length, 0);
      } finally {
        await almacen.db.close();
        enlace.close();
        // Solo se retiran los recursos de este ensayo; nunca datos comerciales.
        final raizTemporal = await Directory.systemTemp.resolveSymbolicLinks();
        final destino = await temporal.resolveSymbolicLinks();
        expect(
          destino.startsWith(
            '$raizTemporal${Platform.pathSeparator}clb_prueba_vton_real_',
          ),
          isTrue,
        );
        await temporal.delete(recursive: true);
      }
    },
    skip: configuracion.isEmpty,
    timeout: const Timeout(Duration(minutes: 15)),
  );
}
