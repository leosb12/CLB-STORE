import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'package:clb_store/datos/recursos_prendas.dart';
import 'package:clb_store/datos/almacen_sqlite.dart';
import 'package:clb_store/dominio/recurso_probador.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/pose.dart';

void main() {
  test('recursos generativos conservan categoría y no requieren anclas de ajuste local', () {
    for (final tipo in ['superior', 'inferior', 'completo']) {
      final recurso = RecursoProbador.validar({'esquema': 2, 'version': 1, 'tipo': tipo, 'vista': 'frontal',
        'mime': 'image/png', 'sha256': 'a' * 64, 'ruta': '/api/v1/recursos-probador/${'a' * 64}.png',
        'color': 'Azul', 'bytes': 1024, 'ancho': 768, 'alto': 1024});
      expect(recurso.soloGenerativo, isTrue);
      expect(recurso.anclas, isEmpty);
    }
  });
  final f =
      jsonDecode(File('../../compartido/prendas/fixtures/ajuste-fotografico.json').readAsStringSync())
          as Map<String, dynamic>;
  final r = RecursoProbador.validar(Map<String, dynamic>.from(f['recurso'] as Map));
  final datos = base64Decode(f['png_base64'] as String);
  final producto = Producto(
    identificador: 'a' * 32,
    sku: 'CLB-PRUEBA',
    nombre: 'Polera',
    descripcion: '',
    categoria: 'Poleras',
    precioCentavos: 9900,
    fechaActualizacion: '2026-10-23T00:00:00Z',
    recursoProbador: r,
  );

  test('archivos verificados sobreviven al reinicio y se leen sin HTTP', () async {
    final carpeta = await Directory.systemTemp.createTemp('clb_prueba_texturas_');
    try {
      var solicitudes = 0;
      final httpCliente = MockClient((req) async {
        solicitudes++;
        return http.Response.bytes(datos, 200, headers: {'content-type': 'image/png'});
      });
      final recursos = RecursosPrendas(carpeta.path, httpCliente, 'http://localhost');
      await recursos.preparar([producto]);
      await recursos.preparar([producto]);
      expect(solicitudes, 1);
      final sinRed = RecursosPrendas(
        carpeta.path,
        MockClient((_) async => throw const SocketException('offline')),
        'http://localhost',
      );
      expect(await sinRed.leer(r), datos);
      await File('${carpeta.path}/${r.hash}.png').writeAsString('corrupta');
      expect(await sinRed.leer(r), null);
    } finally {
      await carpeta.delete(recursive: true);
    }
  });
  test('hash o espacio insuficientes impiden preparar la generación', () async {
    final carpeta = await Directory.systemTemp.createTemp('clb_prueba_hash_');
    try {
      final corrupto = RecursosPrendas(
        carpeta.path,
        MockClient(
          (_) async => http.Response.bytes(List.filled(datos.length, 0), 200, headers: {'content-type': 'image/png'}),
        ),
        'http://localhost',
      );
      await expectLater(corrupto.preparar([producto]), throwsFormatException);
      final sinEspacio = RecursosPrendas(
        carpeta.path,
        MockClient((_) async => throw StateError('No debe descargar')),
        'http://localhost',
        espacioDisponible: () async => 0,
      );
      await expectLater(sinEspacio.preparar([producto]), throwsA(isA<FileSystemException>()));
    } finally {
      await carpeta.delete(recursive: true);
    }
  });
  test('migración SQLite v1 a v2 conserva carrito y manifiesto reiniciable', () async {
    sqfliteFfiInit();
    final carpeta = await Directory.systemTemp.createTemp('clb_prueba_migracion_');
    final ruta = '${carpeta.path}/clb.db';
    try {
      final viejo = await databaseFactoryFfi.openDatabase(
        ruta,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (db, _) async {
            await db.execute(
              'CREATE TABLE productos (identificador TEXT PRIMARY KEY, sku TEXT, nombre TEXT, descripcion TEXT, categoria TEXT, precio_centavos INTEGER, fecha_actualizacion TEXT)',
            );
            await db.execute(
              'CREATE TABLE variantes (identificador TEXT PRIMARY KEY, identificador_producto TEXT, sku TEXT, talla TEXT, color TEXT, disponible INTEGER)',
            );
            await db.execute('CREATE TABLE metadatos (clave TEXT PRIMARY KEY, valor TEXT)');
            await db.execute(
              'CREATE TABLE carrito (identificador_variante TEXT PRIMARY KEY, orden INTEGER, datos TEXT)',
            );
            await db.execute(
              'CREATE TABLE operaciones (identificador TEXT PRIMARY KEY, fecha_creacion TEXT, datos TEXT)',
            );
            await db.insert('metadatos', {'clave': 'conservado', 'valor': 'si'});
          },
        ),
      );
      await viejo.close();
      final nuevo = await AlmacenSqlite.abrir(databaseFactoryFfi, ruta, instanciaUnica: false);
      await nuevo.reemplazarCatalogo([producto], [], DateTime(2026));
      await nuevo.cerrar();
      final reabierto = await AlmacenSqlite.abrir(databaseFactoryFfi, ruta, instanciaUnica: false);
      expect((await reabierto.productos()).single.recursoProbador!.hash, r.hash);
      await reabierto.cerrar();
      final comprobar = await databaseFactoryFfi.openDatabase(ruta);
      expect((await comprobar.query('metadatos', where: 'clave = ?', whereArgs: ['conservado'])).single['valor'], 'si');
      await comprobar.close();
    } finally {
      await carpeta.delete(recursive: true);
    }
  });
  test('ajuste de textura coincide con fixture TypeScript', () {
    final pose = [
      for (final p in f['pose'] as List)
        PuntoClave((p['x'] as num).toDouble(), (p['y'] as num).toDouble(), (p['confianza'] as num).toDouble()),
    ];
    final ajuste = calcularAjuste(
      pose,
      TipoPrenda.superior,
      r.ancho.toDouble(),
      r.alto.toDouble(),
      r.anclas,
    ).transformacion!;
    expect(ajuste.escalaX, (f['esperado'] as Map)['escalaX']);
    expect(ajuste.escalaY, closeTo((f['esperado'] as Map)['escalaY'] as num, 1e-9));
    expect(ajuste.origenX, 64);
    expect(ajuste.origenY, 32);
  });
}
