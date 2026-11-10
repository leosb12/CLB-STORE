import 'package:sqflite/sqflite.dart';

import '../dominio/actividad.dart';

/// Registro de actividad en su propia base (`clb_actividad.db`): no migra ni bloquea la base del carrito y la cola.
class RegistroActividadSqlite implements RegistroActividad {
  RegistroActividadSqlite._(this._db);
  final Database _db;

  static Future<RegistroActividadSqlite> abrir(
    DatabaseFactory fabrica,
    String ruta, {
    bool instanciaUnica = true,
  }) async => RegistroActividadSqlite._(
    await fabrica.openDatabase(
      ruta,
      options: OpenDatabaseOptions(
        version: 1,
        singleInstance: instanciaUnica,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, titular TEXT NOT NULL, fecha TEXT NOT NULL, '
            'categoria TEXT NOT NULL, funcionalidad TEXT NOT NULL, descripcion TEXT NOT NULL, severidad TEXT NOT NULL)',
          );
          await db.execute(
            'CREATE INDEX eventos_por_titular ON eventos (titular, id)',
          );
        },
      ),
    ),
  );

  Future<void> cerrar() => _db.close();

  @override
  Future<void> registrar(
    String titular,
    String categoria,
    String funcionalidad,
    String descripcion,
    Severidad severidad,
  ) async {
    try {
      await _db.transaction((t) async {
        await t.insert('eventos', {
          'titular': titular,
          'fecha': DateTime.now().toUtc().toIso8601String(),
          'categoria': categoria,
          'funcionalidad': sanear(funcionalidad),
          'descripcion': sanear(descripcion),
          'severidad': severidad.name,
        });
        // Límite por cuenta: se conservan los más recientes.
        await t.rawDelete(
          'DELETE FROM eventos WHERE titular = ? AND id NOT IN '
          '(SELECT id FROM eventos WHERE titular = ? ORDER BY id DESC LIMIT ?)',
          [titular, titular, limiteActividad],
        );
      });
    } on Object {
      // Registrar es auxiliar: nunca interrumpe la acción que lo originó.
    }
  }

  @override
  Future<List<EventoActividad>> leer(String titular) async => [
    for (final f in await _db.query(
      'eventos',
      where: 'titular = ?',
      whereArgs: [titular],
      orderBy: 'id DESC',
    ))
      EventoActividad(
        fecha: DateTime.parse(f['fecha'] as String),
        categoria: f['categoria'] as String,
        funcionalidad: f['funcionalidad'] as String,
        descripcion: f['descripcion'] as String,
        severidad:
            Severidad.values.asNameMap()[f['severidad']] ?? Severidad.info,
      ),
  ];
}
