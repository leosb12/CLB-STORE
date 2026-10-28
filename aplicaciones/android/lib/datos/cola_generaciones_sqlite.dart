import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import '../dominio/cola_generaciones.dart';
import '../dominio/modelos.dart';

/// Metadatos en SQLite y fotos en archivos privados de la app. Android lee las filas con una ventana de cursor de
/// ~2 MB: una foto o un PNG dentro de la fila bloquearía toda la cola. Los archivos se escriben (temporal + rename)
/// antes de confirmar la fila y se retiran después de borrarla; un archivo sin fila se limpia al abrir.
class ColaGeneracionesSqlite implements AlmacenGeneraciones {
  ColaGeneracionesSqlite._(this.db, this.directorio);
  final Database db;
  final String directorio;

  static const _columnas = [
    'clave',
    'titular',
    'producto',
    'estado',
    'mensaje',
    'creado',
    'intentos',
    'proximo',
  ];

  static Future<ColaGeneracionesSqlite> abrir(
    DatabaseFactory fabrica,
    String ruta,
    String directorio, {
    bool instanciaUnica = true,
  }) async {
    await Directory(directorio).create(recursive: true);
    final db = await fabrica.openDatabase(
      ruta,
      options: OpenDatabaseOptions(
        version: 3,
        singleInstance: instanciaUnica,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE generaciones (clave TEXT PRIMARY KEY, titular TEXT NOT NULL, '
            'producto TEXT NOT NULL, estado TEXT NOT NULL, mensaje TEXT NOT NULL, creado INTEGER NOT NULL, '
            'intentos INTEGER NOT NULL, proximo INTEGER NOT NULL, persona BLOB, prenda BLOB, resultado BLOB)',
          );
          await db.execute(
            'CREATE TABLE borrados (clave TEXT NOT NULL, titular TEXT NOT NULL, PRIMARY KEY (clave, titular))',
          );
        },
        onUpgrade: (db, anterior, nueva) async {
          if (anterior < 3) {
            // v1/v2 guardaban BLOB en la fila: se copian por trozos (substr) para no exceder el cursor.
            for (final fila in await db.query(
              'generaciones',
              columns: ['clave'],
            )) {
              final clave = fila['clave'] as String;
              for (final (columna, extension) in [
                ('persona', 'persona'),
                ('prenda', 'prenda'),
                ('resultado', 'png'),
              ]) {
                final largo = Sqflite.firstIntValue(
                  await db.rawQuery(
                    'SELECT length($columna) FROM generaciones WHERE clave = ?',
                    [clave],
                  ),
                );
                if (largo == null || largo == 0) continue;
                final bytes = BytesBuilder(copy: false);
                for (var inicio = 1; inicio <= largo; inicio += 512 * 1024) {
                  final trozo = await db.rawQuery(
                    'SELECT substr($columna, ?, ?) AS t FROM generaciones WHERE clave = ?',
                    [inicio, 512 * 1024, clave],
                  );
                  bytes.add(trozo.single['t'] as Uint8List);
                }
                await _escribir(
                  File(p.join(directorio, '$clave.$extension')),
                  bytes.takeBytes(),
                );
              }
            }
            await db.update('generaciones', {
              'persona': null,
              'prenda': null,
              'resultado': null,
            });
          }
          if (anterior < 2) {
            await db.execute(
              'CREATE TABLE borrados (clave TEXT NOT NULL, titular TEXT NOT NULL, PRIMARY KEY (clave, titular))',
            );
            for (final fila in await db.query(
              'generaciones',
              columns: ['clave', 'titular', 'producto'],
            )) {
              final titular = fila['titular'] as String;
              for (final clave in [fila['clave'] as String, '*']) {
                await db.insert('borrados', {
                  'clave': clave,
                  'titular': titular,
                }, conflictAlgorithm: ConflictAlgorithm.ignore);
              }
              final persona = await _leerArchivo(
                p.join(directorio, '${fila['clave']}.persona'),
              );
              final prenda = await _leerArchivo(
                p.join(directorio, '${fila['clave']}.prenda'),
              );
              if (persona == null || prenda == null) {
                await db.delete(
                  'generaciones',
                  where: 'clave = ?',
                  whereArgs: [fila['clave']],
                );
              } else {
                final producto =
                    jsonDecode(fila['producto'] as String)
                        as Map<String, dynamic>;
                final clave = sha256
                    .convert(
                      utf8.encode(
                        jsonEncode([
                          versionMotorFotografico,
                          titular,
                          sha256.convert(persona).toString(),
                          producto['id'],
                          sha256.convert(prenda).toString(),
                          producto['categoria'],
                        ]),
                      ),
                    )
                    .toString();
                for (final extension in ['persona', 'prenda']) {
                  await File(
                    p.join(directorio, '${fila['clave']}.$extension'),
                  ).rename(p.join(directorio, '$clave.$extension'));
                }
                final viejo = File(p.join(directorio, '${fila['clave']}.png'));
                if (await viejo.exists()) await viejo.delete();
                await db.update(
                  'generaciones',
                  {
                    'clave': clave,
                    'estado': 'PENDIENTE',
                    'proximo': 0,
                    'mensaje':
                        'Solicitud preparada para la nueva versión del motor.',
                  },
                  where: 'clave = ?',
                  whereArgs: [fila['clave']],
                );
              }
            }
          }
        },
      ),
    );
    await db.update(
      'generaciones',
      {
        'estado': 'PENDIENTE',
        'proximo': 0,
        'mensaje': 'Solicitud recuperada. Se reanudará al conectar.',
      },
      where: 'estado = ?',
      whereArgs: ['ENVIANDO'],
    );
    final cola = ColaGeneracionesSqlite._(db, directorio);
    await cola._limpiarHuerfanos();
    return cola;
  }

  static Future<void> _escribir(File archivo, Uint8List datos) async {
    final temporal = File('${archivo.path}.tmp');
    await temporal.writeAsBytes(datos, flush: true);
    await temporal.rename(archivo.path);
  }

  static Future<Uint8List?> _leerArchivo(String ruta) async {
    final archivo = File(ruta);
    return await archivo.exists() ? archivo.readAsBytes() : null;
  }

  String _ruta(String clave, String extension) {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(clave)) {
      throw StateError('Clave inválida.');
    }
    return p.join(directorio, '$clave.$extension');
  }

  Future<void> _borrarOriginales(String clave) async {
    for (final extension in [
      'persona',
      'prenda',
      'persona.tmp',
      'prenda.tmp',
    ]) {
      final archivo = File(_ruta(clave, extension));
      if (await archivo.exists()) await archivo.delete();
    }
  }

  /// Archivos cuya fila no llegó a confirmarse o ya se borró (cierre a mitad de escritura) y temporales cortados.
  Future<void> _limpiarHuerfanos() async {
    final claves = (await db.query(
      'generaciones',
      columns: ['clave'],
    )).map((f) => f['clave']).toSet();
    await for (final archivo in Directory(directorio).list()) {
      final nombre = p.basename(archivo.path);
      final original =
          nombre.endsWith('.persona') ||
          nombre.endsWith('.prenda') ||
          nombre.endsWith('.png');
      if (nombre.endsWith('.tmp') ||
          (original && !claves.contains(nombre.split('.').first))) {
        await archivo.delete();
      }
    }
  }

  Future<TrabajoGeneracion> _leer(Map<String, Object?> fila) async {
    final p = jsonDecode(fila['producto'] as String) as Map<String, dynamic>;
    final clave = fila['clave'] as String;
    final pendiente = fila['estado'] != 'LISTO';
    final png = File(_ruta(clave, 'png'));
    return TrabajoGeneracion(
      clave: fila['clave'] as String,
      titular: fila['titular'] as String,
      producto: Producto(
        identificador: p['id'],
        sku: p['sku'],
        nombre: p['nombre'],
        descripcion: '',
        categoria: p['categoria'],
        precioCentavos: 0,
        fechaActualizacion: '',
      ),
      estado: fila['estado'] as String,
      mensaje: fila['mensaje'] as String,
      intentos: fila['intentos'] as int,
      proximoIntento: fila['proximo'] as int,
      creado: fila['creado'] as int,
      persona: pendiente ? await _leerArchivo(_ruta(clave, 'persona')) : null,
      prenda: pendiente ? await _leerArchivo(_ruta(clave, 'prenda')) : null,
      rutaResultado: !pendiente && await png.exists() ? png.path : null,
    );
  }

  @override
  Future<TrabajoGeneracion> encolar(
    String titular,
    Uint8List persona,
    Uint8List prenda,
    Producto producto,
  ) => db.transaction((t) async {
    final clave = sha256
        .convert(
          utf8.encode(
            jsonEncode([
              versionMotorFotografico,
              titular,
              sha256.convert(persona).toString(),
              producto.identificador,
              sha256.convert(prenda).toString(),
              producto.categoria,
            ]),
          ),
        )
        .toString();
    final anterior = await t.query(
      'generaciones',
      columns: _columnas,
      where: 'clave = ?',
      whereArgs: [clave],
    );
    if (anterior.isNotEmpty) return _leer(anterior.single);
    final cantidad = Sqflite.firstIntValue(
      await t.rawQuery(
        "SELECT count(*) FROM generaciones WHERE titular = ? AND estado != 'LISTO'",
        [titular],
      ),
    )!;
    if (cantidad >= 4) {
      throw StateError(
        'Ya tienes cuatro solicitudes pendientes. Espera o elimina una antes de agregar otra.',
      );
    }
    // Archivos antes que la fila: si la app se cierra entre ambos, `_limpiarHuerfanos` los retira.
    await _escribir(File(_ruta(clave, 'persona')), persona);
    await _escribir(File(_ruta(clave, 'prenda')), prenda);
    await t.insert('generaciones', {
      'clave': clave,
      'titular': titular,
      'producto': jsonEncode({
        'id': producto.identificador,
        'sku': producto.sku,
        'nombre': producto.nombre,
        'categoria': producto.categoria,
      }),
      'estado': 'PENDIENTE',
      'mensaje':
          'Guardada en el teléfono. Se enviará automáticamente cuando haya conexión.',
      'creado': DateTime.now().millisecondsSinceEpoch,
      'intentos': 0,
      'proximo': 0,
    });
    return _leer(
      (await t.query(
        'generaciones',
        columns: _columnas,
        where: 'clave = ?',
        whereArgs: [clave],
      )).single,
    );
  });

  @override
  Future<List<TrabajoGeneracion>> listar(String titular) async => [
    for (final fila in await db.query(
      'generaciones',
      columns: _columnas,
      where: 'titular = ?',
      whereArgs: [titular],
      orderBy: 'creado ASC, clave ASC',
    ))
      await _leer(fila),
  ];

  @override
  Future<void> actualizar(
    TrabajoGeneracion trabajo,
    String estado,
    String mensaje, {
    Uint8List? resultado,
    int? intentos,
    int? proximoIntento,
  }) async {
    final png = File(_ruta(trabajo.clave, 'png'));
    // El adaptador REST ya pudo guardarlo; si no, se intenta aquí y un disco lleno llega a la cola como error.
    if (resultado != null && !await png.exists()) {
      await _escribir(png, resultado);
    }
    final retiradas = <String>[];
    await db.transaction((t) async {
      await t.update(
        'generaciones',
        {
          'estado': estado,
          'mensaje': mensaje,
          'intentos': ?intentos,
          'proximo': ?proximoIntento,
        },
        where: 'clave = ? AND titular = ? AND creado = ?',
        whereArgs: [trabajo.clave, trabajo.titular, trabajo.creado],
      );
      final anteriores = await t.query(
        'generaciones',
        columns: ['clave'],
        where: 'titular = ? AND estado = ?',
        whereArgs: [trabajo.titular, 'LISTO'],
        orderBy: 'creado DESC, clave DESC',
        offset: 20,
        limit: 100,
      );
      for (final fila in anteriores) {
        // Más de 20 resultados: el más antiguo sale del teléfono y también se invalida en CLB.
        await t.delete(
          'generaciones',
          where: 'clave = ?',
          whereArgs: [fila['clave']],
        );
        await t.insert('borrados', {
          'clave': fila['clave'],
          'titular': trabajo.titular,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
        retiradas.add(fila['clave'] as String);
      }
    });
    for (final clave in retiradas) {
      await _borrarOriginales(clave);
      final viejo = File(_ruta(clave, 'png'));
      if (await viejo.exists()) await viejo.delete();
    }
    if (estado == 'LISTO') await _borrarOriginales(trabajo.clave);
  }

  @override
  Future<void> eliminar(String clave, String titular) async {
    var eliminada = false;
    await db.transaction((t) async {
      final eliminadas = await t.delete(
        'generaciones',
        where: 'clave = ? AND titular = ?',
        whereArgs: [clave, titular],
      );
      eliminada = eliminadas > 0;
      if (eliminadas > 0) {
        await t.insert('borrados', {
          'clave': clave,
          'titular': titular,
        }, conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    });
    if (eliminada) await _borrarOriginales(clave);
  }

  @override
  Future<List<String>> borrados(String titular) async => (await db.query(
    'borrados',
    where: 'titular = ?',
    whereArgs: [titular],
  )).map((f) => f['clave'] as String).toList();

  @override
  Future<void> confirmarBorrado(String clave, String titular) async {
    await db.delete(
      'borrados',
      where: 'clave = ? AND titular = ?',
      whereArgs: [clave, titular],
    );
  }

  /// Los borrados pendientes (solo claves) se conservan: se envían cuando esa cuenta vuelva a iniciar sesión.
  @override
  Future<void> borrarTodo() async {
    await db.delete('generaciones');
    await for (final archivo in Directory(directorio).list()) {
      if (RegExp(
        r'^[a-f0-9]{64}\.(persona|prenda|png)(\.tmp)?$',
      ).hasMatch(p.basename(archivo.path))) {
        await archivo.delete();
      }
    }
  }
}
