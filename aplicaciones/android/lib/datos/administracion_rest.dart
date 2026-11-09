import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../dominio/administracion.dart';
import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import 'rest.dart';

/// Resumen de la gestión por GraphQL: solo los campos que muestra el móvil (menos datos por la red celular).
const consultaResumen =
    '''{ resumenVentas(periodo: HOY) { pedidos unidades monto datosAl }
  stockBajo { sku nombre talla color disponible minimo } }''';

// Alias: el móvil recibe los mismos nombres que ya usa (p. ej. datos_al), así el dominio no cambia con el transporte.
const _camposReporte =
    'identificador peticion salida_modelo: salidaModelo especificacion generativa observacion datos datos_al: datosAl fecha '
    'interpretacion procedencia';
const _camposPropuesta =
    'identificador variante sku cantidad motivo fecha estado disponible minimo';
const _camposNotificacion =
    'evento producto sku talla color disponible minimo mensaje origen estado fecha_evento: fechaEvento fecha '
    'atendida_por: atendidaPor fecha_atencion: fechaAtencion';

/// Consulta o acción de gestión por GraphQL (R5). Un error de negocio trae `estado_http`: se lanza el mismo
/// [ErrorRemoto] que con REST, así la cola decide igual (reintentar con la misma clave o pedir revisión).
Future<Map<String, dynamic>> consultarGestion(
  ClienteJson cliente,
  String token,
  String consulta, {
  Map<String, Object?> variables = const {},
  Duration plazo = const Duration(seconds: 15),
}) async {
  final r = await cliente.pedir(
    'POST',
    '/graphql',
    cabeceras: {'Authorization': 'Bearer $token'},
    cuerpo: {'query': consulta, 'variables': variables},
    plazo: plazo,
  );
  final errores = r['errors'];
  if (errores is List && errores.isNotEmpty) {
    final error = errores.first is Map ? (errores.first as Map) : const {};
    final mensaje = error['message'] is String
        ? error['message'] as String
        : 'La gestión rechazó la solicitud.';
    final extensiones = error['extensions'];
    final estado = extensiones is Map ? extensiones['estado_http'] : null;
    if (estado is int) throw ErrorRemoto(estado, mensaje);
    // Sin estado: error interno enmascarado (transitorio) o consulta inválida (definitivo).
    throw ErrorRemoto(
      mensaje == 'Error interno de la consulta.' ? 500 : 422,
      mensaje,
    );
  }
  final datos = r['data'];
  if (datos is! Map)
    throw ContratoInvalido('La consulta de gestión no devolvió datos.');
  return datos.cast<String, dynamic>();
}

Map<String, dynamic> _mapa(Map<String, dynamic> datos, String clave) {
  final valor = datos[clave];
  if (valor is! Map) throw ContratoInvalido('Respuesta de $clave inválida.');
  return valor.cast<String, dynamic>();
}

/// Administración y gestión en el móvil, con el token del titular (rol admin). Consultas y acciones de gestión por
/// GraphQL; REST solo para transferir archivos (audio, fotos, Excel y previsualización) y para Inventario (F1b-II).
class AdministracionRest
    implements FuenteGestion, FuenteExistencias, FuenteIngesta {
  AdministracionRest(this._cliente);
  final ClienteJson _cliente;

  Map<String, String> _con(String token, [String? clave]) => {
    'Authorization': 'Bearer $token',
    'Idempotency-Key': ?clave,
  };

  List<Map<String, dynamic>> _lista(Map<String, dynamic> r, String clave) {
    final valor = r[clave];
    if (valor is! List || !valor.every((e) => e is Map))
      throw ContratoInvalido('Respuesta de $clave inválida.');
    return [for (final e in valor) (e as Map).cast<String, dynamic>()];
  }

  // ---- Gestión con agentes (IA), por GraphQL ----------------------------------------------------------------------
  @override
  Future<Map<String, dynamic>> resumen(String token) =>
      consultarGestion(_cliente, token, consultaResumen);

  @override
  Future<Map<String, dynamic>> mision(
    String texto,
    String token,
  ) async => _mapa(
    await consultarGestion(
      _cliente,
      token,
      r'mutation($m: String!) { ejecutarMision(mision: $m) { mision agentes generativa fecha } }',
      variables: {'m': texto},
      plazo: const Duration(seconds: 210),
    ),
    'ejecutarMision',
  );

  @override
  Future<List<Map<String, dynamic>>> notificaciones(String token) async =>
      _lista(
        await consultarGestion(
          _cliente,
          token,
          '{ notificaciones(estado: NUEVA) { $_camposNotificacion } }',
        ),
        'notificaciones',
      );

  @override
  Future<List<Map<String, dynamic>>> propuestas(String token) async {
    final todas = _lista(
      await consultarGestion(
        _cliente,
        token,
        '{ propuestas { $_camposPropuesta } }',
      ),
      'propuestas',
    );
    return [
      for (final p in todas)
        if (const {
          'PENDIENTE',
          'CONFIRMANDO',
          'REQUIERE_REVISION',
        }.contains(p['estado']))
          p,
    ];
  }

  @override
  Future<Map<String, dynamic>> resolverPropuesta(
    String identificador,
    bool confirmar,
    String token,
  ) async => _mapa(
    await consultarGestion(
      _cliente,
      token,
      'mutation(\$i: UUID!, \$c: Boolean!) { resolverPropuesta(identificador: \$i, confirmar: \$c) { $_camposPropuesta } }',
      variables: {'i': identificador, 'c': confirmar},
      plazo: const Duration(seconds: 30),
    ),
    'resolverPropuesta',
  );

  @override
  Future<Map<String, dynamic>> reporte(
    String peticion,
    String token, {
    List<String>? formatos,
  }) async => _mapa(
    await consultarGestion(
      _cliente,
      token,
      'mutation(\$p: String, \$f: [FormatoReporte!]) { generarReporte(peticion: \$p, formatos: \$f) { $_camposReporte } }',
      variables: {'p': peticion, 'f': formatos},
      plazo: const Duration(seconds: 210),
    ),
    'generarReporte',
  );

  @override
  Future<Uint8List> archivo(
    String identificador,
    String formato,
    String token,
  ) => _cliente.bytes(
    '/reportes/${Uri.encodeComponent(identificador)}/${formato == 'pdf' ? 'pdf' : 'excel'}',
    cabeceras: _con(token),
  );

  @override
  Future<String> transcribir(Uint8List audio, String token) async {
    final r = await _cliente.multipart(
      '/voz',
      campos: const {},
      archivo: http.MultipartFile.fromBytes(
        'audio',
        audio,
        filename: 'voz.m4a',
      ),
      cabeceras: _con(token),
      plazo: const Duration(seconds: 120),
    );
    final texto = r['texto'];
    if (texto is! String)
      throw ContratoInvalido('La transcripción no trae texto.');
    return texto;
  }

  // ---- Existencias (Inventario) ------------------------------------------------------------------------------------
  @override
  Future<List<Map<String, dynamic>>> productosAdmin(String token) async =>
      _lista(
        _mapa(
          await consultarGestion(
            _cliente,
            token,
            '{ productosAdmin(pagina: 1, limite: 100) }',
          ),
          'productosAdmin',
        ),
        'productos',
      );

  @override
  Future<List<VarianteAdmin>> variantesAdmin(
    String producto,
    String token,
  ) async => [
    for (final v in _lista(
      _mapa(
        await consultarGestion(
          _cliente,
          token,
          r'query($p: String!) { variantesAdmin(producto: $p) }',
          variables: {'p': producto},
        ),
        'variantesAdmin',
      ),
      'variantes',
    ))
      VarianteAdmin.validar(v),
  ];

  // ---- Ingesta de fotos de prenda (Inventario + worker IA) ----------------------------------------------------------
  @override
  Future<Map<String, dynamic>> cargar(
    String producto,
    String clave,
    int version,
    String color,
    Uint8List foto,
    String token,
  ) => _cliente.multipart(
    '/productos/${Uri.encodeComponent(producto)}/recursos-probador',
    campos: {'color': color, 'versión_esperada': '$version'},
    archivo: http.MultipartFile.fromBytes(
      'imagen',
      foto,
      filename: 'prenda.jpg',
    ),
    cabeceras: _con(token, clave),
  );

  @override
  Future<Map<String, dynamic>> trabajo(
    String producto,
    String trabajo,
    String token,
  ) async => _mapa(
    await consultarGestion(
      _cliente,
      token,
      r'query($p: String!, $t: String!) { trabajoIngesta(producto: $p, trabajo: $t) }',
      variables: {'p': producto, 't': trabajo},
    ),
    'trabajoIngesta',
  );

  @override
  Future<Uint8List> previsualizacion(
    String producto,
    String trabajo,
    String token,
  ) => _cliente.bytes(
    '/productos/${Uri.encodeComponent(producto)}/recursos-probador/${Uri.encodeComponent(trabajo)}/previsualizacion',
    cabeceras: _con(token),
  );

  @override
  Future<Map<String, dynamic>> publicar(
    String producto,
    String trabajo,
    String clave,
    int version,
    bool aceptarAvisos,
    String token,
  ) async => _mapa(
    await consultarGestion(
      _cliente,
      token,
      r'mutation($p: String!, $t: String!, $c: String!, $d: JSON!) { publicarRecurso(producto: $p, trabajo: $t, clave: $c, datos: $d) }',
      variables: {
        'p': producto,
        't': trabajo,
        'c': clave,
        'd': {
          'versión_esperada': version,
          if (aceptarAvisos) 'aceptar_avisos': true,
        },
      },
    ),
    'publicarRecurso',
  );
}

/// Procesadores de la cola, por GraphQL de gestión: Idempotency-Key fija (`clave`), versión esperada (en `datos`) y
/// comprobante validado (como la web). Un comprobante
/// que no corresponde a la operación se reintenta con la misma clave en vez de darse por bueno.
class ProcesadorExistencias implements ProcesadorOperacion {
  ProcesadorExistencias(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    final datos = {...?op.datos}
      ..remove('sku')
      ..remove('reemplazo_de');
    final variante = datos.remove('identificador_variante') as String;
    final version = datos['versión_esperada'] as int;
    final mutacion = op.tipo == registrarMovimiento
        ? 'registrarMovimiento'
        : 'fijarMinimo';
    final r = _mapa(
      await consultarGestion(
        _cliente,
        token,
        'mutation(\$v: String!, \$c: String!, \$d: JSON!) { $mutacion(variante: \$v, clave: \$c, datos: \$d) }',
        variables: {'v': variante, 'c': op.claveIdempotencia, 'd': datos},
      ),
      mutacion,
    );
    final confirmada = VarianteAdmin.validar(r['variante']);
    if (confirmada.identificador != variante ||
        confirmada.version != version + 1) {
      throw ContratoInvalido(
        'El comprobante no corresponde a este cambio; se reintentará el mismo.',
      );
    }
    return {'variante': confirmada.json};
  }
}

/// «Atender» una alerta de n8n por GraphQL: idempotente en IA (NUEVA → ATENDIDA; repetirla devuelve la misma), por eso
/// puede esperar en la cola sin red.
class ProcesadorAtenderAlerta implements ProcesadorOperacion {
  ProcesadorAtenderAlerta(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    final evento = op.datos!['evento'] as String;
    final r = await consultarGestion(
      _cliente,
      token,
      'mutation(\$e: UUID!) { atenderNotificacion(evento: \$e) { $_camposNotificacion } }',
      variables: {'e': evento},
    );
    final n = r['atenderNotificacion'];
    if (n is! Map || n['evento'] != evento || n['estado'] != 'ATENDIDA') {
      throw ContratoInvalido('La alerta no quedó atendida; se reintentará.');
    }
    return {'notificacion': n};
  }
}
