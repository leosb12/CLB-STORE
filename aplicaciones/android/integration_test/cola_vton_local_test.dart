import 'dart:io';
// Ensayo USB optativo con SQLite Android, Keycloak y worker CatVTON reales.
// El auxiliar local solo entrega credenciales efímeras y fotos públicas de prueba.
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:clb_store/datos/cola_generaciones_sqlite.dart';
import 'package:clb_store/datos/probador_fotografico_rest.dart';
import 'package:clb_store/dominio/cola_generaciones.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';

class SesionDelEnsayo implements Sesion {
  SesionDelEnsayo(this.acceso, this.sub);
  final String acceso, sub;
  @override
  Future<Titular?> titular() async => Titular(
    sub: sub,
    usuario: 'cliente.demo',
    nombre: 'Ensayo',
    roles: {'cliente'},
  );
  @override
  Future<String?> tokenVigente() async => acceso;
  @override
  Future<Titular> iniciar() async => (await titular())!;
  @override
  Future<void> cerrar() async {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'cola real: ADB sin enlace, SQLite reabierto y recuperación automática al restaurarlo',
    (_) async {
      final cliente = http.Client();
      final datos =
          jsonDecode(
                (await cliente.get(
                  Uri.parse('http://127.0.0.1:14352/sesion'),
                )).body,
              )
              as Map<String, dynamic>;
      final persona = (await cliente.get(
        Uri.parse('http://127.0.0.1:14352/persona'),
      )).bodyBytes;
      final prenda = (await cliente.get(
        Uri.parse('http://127.0.0.1:14352/prenda'),
      )).bodyBytes;
      final sesion = SesionDelEnsayo(datos['token'], datos['sub']);
      final ruta = p.join(await getDatabasesPath(), 'clb_prueba_cola_vton.db');
      await deleteDatabase(ruta);
      final directorio = p.join(
        await getDatabasesPath(),
        'clb_prueba_cache_vton_${DateTime.now().millisecondsSinceEpoch}',
      );
      var almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactory,
        ruta,
        directorio,
      );
      final motor = ProbadorFotograficoRest(sesion, directorio, cliente);
      var cola = ColaGeneraciones(almacen, motor, sesion);
      final producto = Producto(
        identificador: 'qa',
        sku: 'CLB-FOTO-POL-ROJ',
        nombre: 'Polera roja de prueba',
        descripcion: '',
        categoria: 'Poleras',
        precioCentavos: 9900,
        fechaActualizacion: '',
      );
      await cliente.get(Uri.parse('http://127.0.0.1:14352/cortar'));
      await cola.encolar(persona, prenda, producto);
      final plazo = DateTime.now().add(const Duration(seconds: 90));
      while (true) {
        final trabajo = (await cola.listar()).single;
        if (trabajo.estado == 'PENDIENTE' && trabajo.intentos > 0) break;
        if (DateTime.now().isAfter(plazo)) {
          fail('La solicitud no quedó pendiente sin enlace ADB.');
        }
        await Future<void>.delayed(const Duration(milliseconds: 200));
      }
      await almacen.db.close();
      almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactory,
        ruta,
        directorio,
      );
      cola = ColaGeneraciones(almacen, motor, sesion);
      expect((await cola.listar()).single.persona, persona);
      debugPrint(
        'CLB_COLA_OFFLINE_LISTA: foto persistida; restaurar reverse 18000.',
      );
      await cliente.get(Uri.parse('http://127.0.0.1:14352/restaurar'));
      final finaliza = DateTime.now().add(const Duration(minutes: 11));
      while ((await cola.listar()).single.estado != 'LISTO') {
        await cola.sincronizar();
        final trabajo = (await cola.listar()).single;
        if (trabajo.estado == 'ERROR') fail(trabajo.mensaje);
        if (DateTime.now().isAfter(finaliza)) {
          fail('No se recuperó el resultado del worker real.');
        }
        await Future<void>.delayed(const Duration(seconds: 2));
      }
      final trabajo = (await cola.listar()).single;
      expect(File(trabajo.rutaResultado!).lengthSync(), greaterThan(10000));
      expect(trabajo.persona, isNull);
      expect(trabajo.prenda, isNull);
      expect(trabajo.intentos, greaterThanOrEqualTo(2));
      debugPrint(
        'CLB_COLA_REAL_LISTO: resultado descargado sin pulsar Generar de nuevo.',
      );
      await almacen.db.close();
      await deleteDatabase(ruta);
      cliente.close();
    },
    skip: !const bool.fromEnvironment('CLB_PRUEBA_COLA'),
    timeout: const Timeout(Duration(minutes: 13)),
  );
}
