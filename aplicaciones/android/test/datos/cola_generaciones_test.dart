import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:clb_store/datos/cola_generaciones_sqlite.dart';
import 'package:clb_store/datos/probador_fotografico_rest.dart';
import 'package:clb_store/dominio/cola_generaciones.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'probador_fotografico_test.dart' show SesionDeContrato;

final producto = Producto(
  identificador: 'p',
  sku: 'SKU',
  nombre: 'Polera',
  descripcion: '',
  categoria: 'Poleras',
  precioCentavos: 9900,
  fechaActualizacion: '',
);
final persona = Uint8List.fromList([1, 2, 3]);
final png = base64Decode(
  (jsonDecode(
        File(
          '../../compartido/prendas/fixtures/ajuste-fotografico.json',
        ).readAsStringSync(),
      )
      as Map)['png_base64'],
);

Future<void> esperar(Future<bool> Function() listo) async {
  for (var i = 0; i < 200; i++) {
    if (await listo()) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  fail('La cola no alcanzó el estado esperado');
}

void main() {
  sqfliteFfiInit();
  test(
    'migración VTON v1 a v2 conserva originales pendientes e invalida caché del motor anterior',
    () async {
      final carpeta = await Directory.systemTemp.createTemp(
        'clb_migracion_vton_',
      );
      final ruta = '${carpeta.path}/cola.db';
      final anterior = await databaseFactoryFfi.openDatabase(
        ruta,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (db, _) async {
            await db.execute(
              'CREATE TABLE generaciones (clave TEXT PRIMARY KEY, titular TEXT NOT NULL, producto TEXT NOT NULL, estado TEXT NOT NULL, mensaje TEXT NOT NULL, creado INTEGER NOT NULL, intentos INTEGER NOT NULL, proximo INTEGER NOT NULL, persona BLOB, prenda BLOB, resultado BLOB)',
            );
          },
        ),
      );
      final datos = {
        'titular': 'ana',
        'producto': jsonEncode({
          'id': 'p',
          'sku': 'SKU',
          'nombre': 'Polera',
          'categoria': 'Poleras',
        }),
        'mensaje': '',
        'creado': 1,
        'intentos': 0,
        'proximo': 0,
      };
      await anterior.insert('generaciones', {
        ...datos,
        'clave': 'a' * 64,
        'estado': 'ERROR',
        'persona': persona,
        'prenda': png,
      });
      await anterior.insert('generaciones', {
        ...datos,
        'clave': 'b' * 64,
        'estado': 'LISTO',
        'resultado': png,
      });
      await anterior.close();
      final nuevo = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        ruta,
        '${carpeta.path}/vton',
      );
      final trabajos = await nuevo.listar('ana');
      expect(trabajos.length, 1);
      expect(trabajos.single.persona, persona);
      expect(
        File(
          '${carpeta.path}/vton/${trabajos.single.clave}.persona',
        ).existsSync(),
        isTrue,
      );
      expect(
        File('${carpeta.path}/vton/${'b' * 64}.png').existsSync(),
        isFalse,
      );
      expect(trabajos.single.estado, 'PENDIENTE');
      expect(trabajos.single.clave, isNot('a' * 64));
      expect(
        await nuevo.borrados('ana'),
        containsAll(['a' * 64, 'b' * 64, '*']),
      );
      expect(await nuevo.borrados('bea'), isEmpty);
      await nuevo.db.close();
    },
  );
  test(
    'sin red persiste, deduplica y recupera la foto tras cerrar SQLite; al reconectar termina y elimina originales',
    () async {
      final carpeta = await Directory.systemTemp.createTemp('clb_cola_prueba_');
      final ruta = '${carpeta.path}/cola.db';
      final directorio = '${carpeta.path}/vton';
      var almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        ruta,
        directorio,
      );
      final sesion = SesionDeContrato();
      var conectado = false, envios = 0;
      final cliente = MockClient((solicitud) async {
        if (!conectado) throw const SocketException('sin conexión');
        if (solicitud.method == 'DELETE') return http.Response('', 204);
        if (solicitud.method == 'POST') {
          envios++;
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
      final motor = ProbadorFotograficoRest(sesion, directorio, cliente);
      var cola = ColaGeneraciones(almacen, motor, sesion);
      await cola.encolar(persona, png, producto);
      await esperar(
        () async =>
            (await cola.listar()).single.estado == 'PENDIENTE' &&
            (await cola.listar()).single.intentos == 1,
      );
      await cola.encolar(persona, png, producto);
      expect((await cola.listar()).length, 1);
      expect(envios, 0);
      final trabajo = (await cola.listar()).single;
      // Simula un cierre durante un envío; abrir la base debe recuperar el trabajo.
      await almacen.actualizar(trabajo, 'ENVIANDO', 'Envío interrumpido');
      await almacen.db.close();
      almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        ruta,
        directorio,
      );
      cola = ColaGeneraciones(almacen, motor, sesion);
      expect((await cola.listar()).single.persona, persona);
      conectado = true;
      final recuperado = (await cola.listar()).single;
      await almacen.actualizar(
        recuperado,
        'PENDIENTE',
        'Espera larga',
        proximoIntento: DateTime.now().millisecondsSinceEpoch + 3600000,
      );
      await Future.wait([cola.sincronizar(forzar: true), cola.sincronizar()]);
      final resultado = (await cola.listar()).single;
      expect(resultado.estado, 'LISTO');
      expect(File(resultado.rutaResultado!).readAsBytesSync(), png);
      expect(resultado.persona, isNull);
      expect(resultado.prenda, isNull);
      expect(envios, 1);
      await cola.sincronizar();
      expect(envios, 1);
      sesion.cuenta = 'bea';
      expect(await cola.listar(), isEmpty);
      await expectLater(
        motor.generar(
          persona,
          png,
          producto,
          (_) {},
          () => true,
          titularEsperado: 'ana',
        ),
        throwsA(isA<ErrorGeneracionFotografica>()),
      );
      sesion.cuenta = 'ana';
      await cola.borrarResultados();
      expect(await cola.listar(), isEmpty);
      expect(await Directory(directorio).list().length, 0);
      await esperar(() async => (await almacen.borrados('ana')).isEmpty);
      await cola.encolar(persona, png, producto);
      await esperar(() async => (await cola.listar()).single.estado == 'LISTO');
      expect(envios, 2); // No vuelve a aparecer la copia eliminada.
      await almacen.db.close();
      cliente.close();
    },
  );

  test(
    'rechazo 422 requiere revisión y no se reenvía automáticamente; cola acotada y borrado por titular',
    () async {
      final carpeta = await Directory.systemTemp.createTemp(
        'clb_cola_rechazo_',
      );
      final almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        inMemoryDatabasePath,
        carpeta.path,
        instanciaUnica: false,
      );
      final sesion = SesionDeContrato();
      var envios = 0;
      final cliente = MockClient((_) async {
        envios++;
        return http.Response(
          jsonEncode({'mensaje': 'Foto sin cuerpo visible.'}),
          422,
        );
      });
      final cola = ColaGeneraciones(
        almacen,
        ProbadorFotograficoRest(sesion, carpeta.path, cliente),
        sesion,
      );
      await cola.encolar(persona, png, producto);
      await esperar(() async => (await cola.listar()).single.estado == 'ERROR');
      await cola.sincronizar();
      expect(envios, 1);
      final trabajo = (await cola.listar()).single;
      expect(trabajo.mensaje, contains('sin cuerpo'));
      await cola.encolar(persona, png, producto);
      await esperar(
        () async =>
            (await cola.listar()).single.estado == 'ERROR' &&
            (await cola.listar()).single.intentos == 2,
      );
      expect(
        envios,
        2,
      ); // Pulsar Generar después de un error no queda deduplicado sin reintentar.
      for (var i = 0; i < 3; i++) {
        await almacen.encolar('ana', Uint8List.fromList([i]), png, producto);
      }
      await expectLater(
        almacen.encolar('ana', Uint8List.fromList([9]), png, producto),
        throwsStateError,
      );
      await almacen.eliminar(trabajo.clave, 'bea');
      expect((await almacen.listar('ana')).length, 4);
      await cola.eliminar(trabajo);
      expect((await cola.listar()).length, 3);
      await almacen.db.close();
      cliente.close();
    },
  );

  test(
    'migración v2 a v3 saca BLOB de más de 2 MB de la fila a archivos privados',
    () async {
      final carpeta = await Directory.systemTemp.createTemp('clb_v2_v3_');
      final ruta = '${carpeta.path}/cola.db';
      final grande = Uint8List.fromList(
        List.generate(3 * 1024 * 1024 + 17, (i) => i % 251),
      );
      final anterior = await databaseFactoryFfi.openDatabase(
        ruta,
        options: OpenDatabaseOptions(
          version: 2,
          onCreate: (db, _) async {
            await db.execute(
              'CREATE TABLE generaciones (clave TEXT PRIMARY KEY, titular TEXT NOT NULL, producto TEXT NOT NULL, estado TEXT NOT NULL, mensaje TEXT NOT NULL, creado INTEGER NOT NULL, intentos INTEGER NOT NULL, proximo INTEGER NOT NULL, persona BLOB, prenda BLOB, resultado BLOB)',
            );
            await db.execute(
              'CREATE TABLE borrados (clave TEXT NOT NULL, titular TEXT NOT NULL, PRIMARY KEY (clave, titular))',
            );
          },
        ),
      );
      final datos = {
        'titular': 'ana',
        'producto': jsonEncode({
          'id': 'p',
          'sku': 'SKU',
          'nombre': 'Polera',
          'categoria': 'Poleras',
        }),
        'mensaje': '',
        'intentos': 0,
        'proximo': 0,
      };
      await anterior.insert('generaciones', {
        ...datos,
        'clave': 'a' * 64,
        'creado': 1,
        'estado': 'ENVIANDO',
        'persona': grande,
        'prenda': png,
      });
      await anterior.insert('generaciones', {
        ...datos,
        'clave': 'b' * 64,
        'creado': 2,
        'estado': 'LISTO',
        'resultado': grande,
      });
      await anterior.close();
      final directorio = '${carpeta.path}/vton';
      // Un temporal cortado y un PNG sin fila no sobreviven a la apertura.
      await Directory(directorio).create();
      File('$directorio/${'c' * 64}.png').writeAsBytesSync([1]);
      File('$directorio/${'a' * 64}.persona.tmp').writeAsBytesSync([1]);
      final nuevo = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        ruta,
        directorio,
      );
      final trabajos = await nuevo.listar('ana');
      expect(trabajos.map((t) => t.estado), ['PENDIENTE', 'LISTO']);
      expect(trabajos.first.persona, grande);
      expect(trabajos.first.prenda, png);
      expect(File(trabajos.last.rutaResultado!).readAsBytesSync(), grande);
      final blobs = await nuevo.db.rawQuery(
        'SELECT count(*) AS n FROM generaciones WHERE persona IS NOT NULL OR prenda IS NOT NULL OR resultado IS NOT NULL',
      );
      expect(blobs.single['n'], 0);
      expect(File('$directorio/${'c' * 64}.png').existsSync(), isFalse);
      expect(File('$directorio/${'a' * 64}.persona.tmp').existsSync(), isFalse);
      await nuevo.db.close();
    },
  );

  test(
    'ERROR reintentable del servidor vuelve a PENDIENTE; cinco fallos piden Reintentar y la red no agota',
    () async {
      final carpeta = await Directory.systemTemp.createTemp('clb_cola_error_');
      final almacen = await ColaGeneracionesSqlite.abrir(
        databaseFactoryFfi,
        inMemoryDatabasePath,
        carpeta.path,
        instanciaUnica: false,
      );
      final sesion = SesionDeContrato();
      var modo = 'red', envios = 0;
      final grande = Uint8List.fromList(
        List.generate(3 * 1024 * 1024, (i) => i % 7),
      );
      final cliente = MockClient((solicitud) async {
        if (modo == 'red') throw const SocketException('sin conexión');
        if (solicitud.method == 'DELETE') return http.Response('', 204);
        if (solicitud.method == 'POST') {
          envios++;
          return http.Response(
            jsonEncode(
              modo == 'servidor'
                  ? {
                      'estado': 'ERROR',
                      'identificador': 'a' * 64,
                      'reintentable': true,
                      'mensaje': 'El worker se reinició.',
                    }
                  : {'estado': 'LISTO', 'identificador': 'a' * 64},
            ),
            202,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response.bytes(
          png,
          200,
          headers: {
            'content-type': 'image/png',
            'x-contenido-sha256': modo == 'corrupto'
                ? '0' * 64
                : sha256.convert(png).toString(),
          },
        );
      });
      final cola = ColaGeneraciones(
        almacen,
        ProbadorFotograficoRest(sesion, carpeta.path, cliente),
        sesion,
      );
      // Un intento más, aunque haya otra sincronización en curso.
      Future<TrabajoGeneracion> intento([String? hasta]) async {
        final antes = (await cola.listar()).single.intentos;
        await esperar(() async {
          await cola.sincronizar(forzar: true);
          final t = (await cola.listar()).single;
          return t.intentos > antes &&
              t.estado != 'ENVIANDO' &&
              (hasta == null || t.estado == hasta);
        });
        return (await cola.listar()).single;
      }

      await cola.encolar(grande, png, producto);
      for (var i = 0; i < 6; i++) {
        await intento();
      }
      expect((await cola.listar()).single.estado, 'PENDIENTE');
      expect((await cola.listar()).single.persona, grande);
      modo = 'servidor';
      final tras = await intento('ERROR');
      // ponytail del dominio: los cortes de red también cuentan, así que el tope llega en el primer fallo del servidor.
      expect(tras.estado, 'ERROR');
      expect(tras.mensaje, contains('Reintentar'));
      final otra = await almacen.encolar('ana', png, png, producto);
      await cola.eliminar(tras);
      expect((await cola.listar()).single.clave, otra.clave);
      final pendiente = await intento();
      expect(pendiente.estado, 'PENDIENTE');
      expect(pendiente.mensaje, contains('Se reintentará automáticamente'));
      modo = 'corrupto';
      final corrupto = await intento();
      expect(corrupto.estado, 'PENDIENTE');
      expect(corrupto.mensaje, contains('incompleta'));
      expect(File('${carpeta.path}/${'a' * 64}.png').existsSync(), isFalse);
      modo = 'listo';
      final listo = await intento('LISTO');
      expect(listo.estado, 'LISTO');
      expect(File(listo.rutaResultado!).readAsBytesSync(), png);
      expect(envios, greaterThanOrEqualTo(4));
      await cola.borrarDatosLocales();
      expect(await cola.listar(), isEmpty);
      // Cerrar sesión no deja fotos corporales ni resultados.
      expect(await Directory(carpeta.path).list().length, 0);
      await almacen.db.close();
      cliente.close();
    },
  );
}
