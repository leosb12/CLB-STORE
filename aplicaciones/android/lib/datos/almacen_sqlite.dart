import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import '../dominio/recurso_probador.dart';

/// Copia local del catálogo, carrito y cola de sincronización (SQLite `clb_android.db`).
class AlmacenSqlite implements AlmacenLocal {
  AlmacenSqlite._(this._db);
  final Database _db;

  /// `instanciaUnica: false` solo en pruebas: cada base en memoria queda aislada.
  static Future<AlmacenSqlite> abrir(
    DatabaseFactory fabrica,
    String ruta, {
    bool instanciaUnica = true,
  }) async => AlmacenSqlite._(
    await fabrica.openDatabase(
      ruta,
      options: OpenDatabaseOptions(
        version: 2,
        onCreate: _crear,
        onUpgrade: (db, anterior, nueva) async {
          if (anterior < 2)
            await db.execute(
              'ALTER TABLE productos ADD COLUMN recurso_probador TEXT',
            );
        },
        singleInstance: instanciaUnica,
      ),
    ),
  );

  static Future<void> _crear(Database db, int version) async {
    final lote = db.batch()
      ..execute(
        'CREATE TABLE productos (identificador TEXT PRIMARY KEY, sku TEXT NOT NULL, nombre TEXT NOT NULL, '
        'descripcion TEXT NOT NULL, categoria TEXT NOT NULL, precio_centavos INTEGER NOT NULL, fecha_actualizacion TEXT NOT NULL, recurso_probador TEXT)',
      )
      ..execute(
        'CREATE TABLE variantes (identificador TEXT PRIMARY KEY, identificador_producto TEXT NOT NULL, '
        'sku TEXT NOT NULL, talla TEXT NOT NULL, color TEXT NOT NULL, disponible INTEGER NOT NULL)',
      )
      ..execute(
        'CREATE INDEX variantes_por_producto ON variantes (identificador_producto)',
      )
      ..execute(
        'CREATE TABLE metadatos (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)',
      )
      // `orden` conserva el orden en que se agregaron las líneas aunque cambie la cantidad.
      ..execute(
        'CREATE TABLE carrito (identificador_variante TEXT PRIMARY KEY, orden INTEGER NOT NULL, datos TEXT NOT NULL)',
      )
      ..execute(
        'CREATE TABLE operaciones (identificador TEXT PRIMARY KEY, fecha_creacion TEXT NOT NULL, datos TEXT NOT NULL)',
      );
    await lote.commit(noResult: true);
  }

  Future<void> cerrar() => _db.close();

  @override
  Future<void> guardarHistorial(
    String titular,
    HistorialPedidos historial,
  ) async {
    // Una sola fila y escritura atómica: una descarga fallida nunca reemplaza la copia anterior.
    await _db.insert('metadatos', {
      'clave': 'historial:$titular',
      'valor': jsonEncode({
        'fecha': historial.fecha.toUtc().toIso8601String(),
        'pedidos': historial.pedidos.map((p) => p.json).toList(),
      }),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<HistorialPedidos?> historial(String titular) async {
    final texto = await _metadato('historial:$titular');
    if (texto == null) return null;
    final dato = jsonDecode(texto) as Map<String, dynamic>;
    return HistorialPedidos([
      for (final p in dato['pedidos'] as List)
        PedidoVenta.desdeJson(p as Map<String, dynamic>),
    ], DateTime.parse(dato['fecha'] as String));
  }

  @override
  Future<void> reemplazarCatalogo(
    List<Producto> productos,
    List<Variante> variantes,
    DateTime fecha,
  ) => _db.transaction((t) async {
    final lote = t.batch()
      ..delete('variantes')
      ..delete('productos');
    for (final p in productos) {
      lote.insert('productos', {
        'identificador': p.identificador,
        'sku': p.sku,
        'nombre': p.nombre,
        'descripcion': p.descripcion,
        'categoria': p.categoria,
        'precio_centavos': p.precioCentavos,
        'fecha_actualizacion': p.fechaActualizacion,
        'recurso_probador': p.recursoProbador == null
            ? null
            : jsonEncode(p.recursoProbador!.json),
      });
    }
    for (final v in variantes) {
      lote.insert('variantes', {
        'identificador': v.identificador,
        'identificador_producto': v.identificadorProducto,
        'sku': v.sku,
        'talla': v.talla,
        'color': v.color,
        'disponible': v.disponible,
      });
    }
    lote.insert('metadatos', {
      'clave': 'fecha_catalogo',
      'valor': fecha.toUtc().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    await lote.commit(noResult: true);
  });

  @override
  Future<List<Producto>> productos() async => [
    for (final f in await _db.query(
      'productos',
      orderBy: 'nombre, identificador',
    ))
      Producto(
        identificador: f['identificador'] as String,
        sku: f['sku'] as String,
        nombre: f['nombre'] as String,
        descripcion: f['descripcion'] as String,
        categoria: f['categoria'] as String,
        precioCentavos: f['precio_centavos'] as int,
        fechaActualizacion: f['fecha_actualizacion'] as String,
        recursoProbador: f['recurso_probador'] == null
            ? null
            : RecursoProbador.validar(
                Map<String, dynamic>.from(
                  jsonDecode(f['recurso_probador'] as String) as Map,
                ),
              ),
      ),
  ];

  @override
  Future<List<Variante>> variantes(String identificadorProducto) async => [
    for (final f in await _db.query(
      'variantes',
      where: 'identificador_producto = ?',
      whereArgs: [identificadorProducto],
    ))
      Variante(
        identificador: f['identificador'] as String,
        identificadorProducto: f['identificador_producto'] as String,
        sku: f['sku'] as String,
        talla: f['talla'] as String,
        color: f['color'] as String,
        disponible: f['disponible'] as int,
      ),
  ]..sort(compararVariantes);

  Future<String?> _metadato(String clave) async {
    final filas = await _db.query(
      'metadatos',
      where: 'clave = ?',
      whereArgs: [clave],
    );
    return filas.isEmpty ? null : filas.first['valor'] as String;
  }

  @override
  Future<DateTime?> fechaCatalogo() async =>
      DateTime.tryParse(await _metadato('fecha_catalogo') ?? '');

  @override
  Future<void> guardarModeloTallas(Map<String, dynamic> modelo) => _db.insert(
    'metadatos',
    {'clave': 'modelo_tallas', 'valor': jsonEncode(modelo)},
    conflictAlgorithm: ConflictAlgorithm.replace,
  );

  @override
  Future<String?> preferencia(String clave) => _metadato('preferencia:$clave');

  @override
  Future<void> guardarPreferencia(String clave, String valor) => _db.insert(
    'metadatos',
    {'clave': 'preferencia:$clave', 'valor': valor},
    conflictAlgorithm: ConflictAlgorithm.replace,
  );

  @override
  Future<void> borrarPreferencias(List<String> prefijos) =>
      _db.transaction((t) async {
        for (final prefijo in prefijos) {
          // Comparación exacta del prefijo (sin comodines de LIKE en la clave).
          await t.delete(
            'metadatos',
            where: 'substr(clave, 1, ?) = ?',
            whereArgs: ['preferencia:$prefijo'.length, 'preferencia:$prefijo'],
          );
        }
      });

  @override
  Future<Map<String, dynamic>?> modeloTallas() async {
    final texto = await _metadato('modelo_tallas');
    return texto == null ? null : jsonDecode(texto) as Map<String, dynamic>;
  }

  @override
  Future<List<LineaCarrito>> carrito() async => [
    for (final f in await _db.query('carrito', orderBy: 'orden'))
      LineaCarrito.desdeJson(jsonDecode(f['datos'] as String)),
  ];

  // Sin UPSERT: el SQLite del sistema en Android 8–10 es anterior a 3.24.
  @override
  Future<void> guardarLinea(LineaCarrito linea) => _db.transaction((t) async {
    final datos = jsonEncode(linea.aJson());
    final cambiadas = await t.update(
      'carrito',
      {'datos': datos},
      where: 'identificador_variante = ?',
      whereArgs: [linea.identificadorVariante],
    );
    if (cambiadas == 0) {
      final orden = Sqflite.firstIntValue(
        await t.rawQuery('SELECT COALESCE(MAX(orden), 0) + 1 FROM carrito'),
      );
      await t.insert('carrito', {
        'identificador_variante': linea.identificadorVariante,
        'orden': orden,
        'datos': datos,
      });
    }
  });

  @override
  Future<void> quitarLinea(String identificadorVariante) => _db.delete(
    'carrito',
    where: 'identificador_variante = ?',
    whereArgs: [identificadorVariante],
  );

  @override
  Future<void> encolarPedido(Operacion operacion) => _db.transaction((t) async {
    await t.insert('operaciones', _fila(operacion));
    await t.delete('carrito');
  });

  /// Operación administrativa: se inserta sin tocar el carrito.
  @override
  Future<void> encolarOperacion(Operacion operacion) =>
      _db.insert('operaciones', _fila(operacion));

  /// «Rehacer» una operación en revisión: la antigua conserva el antecedente y apunta a la nueva, en una transacción.
  @override
  Future<void> reemplazarOperacion(Operacion antigua, Operacion nueva) =>
      _db.transaction((t) async {
        await t.update(
          'operaciones',
          _fila(antigua.copiar(reemplazadaPor: nueva.identificador)),
          where: 'identificador = ?',
          whereArgs: [antigua.identificador],
        );
        await t.insert('operaciones', _fila(nueva));
      });

  @override
  Future<List<Operacion>> operaciones() async => [
    for (final f in await _db.query(
      'operaciones',
      orderBy: 'fecha_creacion DESC',
    ))
      operacionDesdeJson(jsonDecode(f['datos'] as String)),
  ];

  @override
  Future<void> guardarOperacion(Operacion operacion) => _db.update(
    'operaciones',
    _fila(operacion),
    where: 'identificador = ?',
    whereArgs: [operacion.identificador],
  );

  @override
  Future<void> recuperarEnviando() async {
    for (final op in await operaciones()) {
      if (op.estado == EstadoOperacion.enviando)
        await guardarOperacion(op.copiar(estado: EstadoOperacion.pendiente));
    }
  }

  Map<String, Object> _fila(Operacion op) => {
    'identificador': op.identificador,
    'fecha_creacion': op.fechaCreacion.toUtc().toIso8601String(),
    'datos': jsonEncode(operacionAJson(op)),
  };
}

Map<String, Object?> operacionAJson(Operacion op) => {
  'identificador': op.identificador,
  'tipo': op.tipo,
  'clave_idempotencia': op.claveIdempotencia,
  'titular': op.titular,
  'fecha_creacion': op.fechaCreacion.toUtc().toIso8601String(),
  'estado': op.estado.name,
  'intentos': op.intentos,
  'proximo_intento': op.proximoIntento.toUtc().toIso8601String(),
  'carrito': [for (final l in op.carrito) l.aJson()],
  'resultado': op.resultado?.json,
  'error': op.error,
  'datos': op.datos,
  'respuesta': op.respuesta,
  'reemplazada_por': op.reemplazadaPor,
};

Operacion operacionDesdeJson(Map<String, dynamic> j) => Operacion(
  identificador: j['identificador'],
  tipo: j['tipo'],
  claveIdempotencia: j['clave_idempotencia'],
  titular: j['titular'],
  fechaCreacion: DateTime.parse(j['fecha_creacion']),
  estado: EstadoOperacion.values.byName(j['estado']),
  intentos: j['intentos'],
  proximoIntento: DateTime.parse(j['proximo_intento']),
  carrito: [for (final l in j['carrito'] as List) LineaCarrito.desdeJson(l)],
  resultado: j['resultado'] == null
      ? null
      : PedidoVenta.desdeJson(j['resultado']),
  error: j['error'],
  // Filas de versiones anteriores (solo pedidos) no tienen estas claves: se leen como null y nada cambia.
  datos: (j['datos'] as Map?)?.cast<String, dynamic>(),
  respuesta: (j['respuesta'] as Map?)?.cast<String, dynamic>(),
  reemplazadaPor: j['reemplazada_por'],
);
