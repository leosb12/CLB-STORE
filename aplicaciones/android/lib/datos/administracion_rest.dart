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

/// Administración y gestión en el móvil, con el token del titular (rol admin). Mismas rutas que la web por la pasarela.
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

  // ---- Gestión con agentes (IA) ----------------------------------------------------------------------------------
  @override
  Future<Map<String, dynamic>> resumen(String token) async {
    final r = await _cliente.pedir(
      'POST',
      '/graphql',
      cabeceras: _con(token),
      cuerpo: {'query': consultaResumen},
    );
    final datos = r['data'];
    if (datos is! Map || r['errors'] != null)
      throw ContratoInvalido('La consulta de gestión no devolvió datos.');
    return datos.cast<String, dynamic>();
  }

  @override
  Future<Map<String, dynamic>> mision(String texto, String token) =>
      _cliente.pedir(
        'POST',
        '/agentes/misiones',
        cabeceras: _con(token),
        cuerpo: {'mision': texto},
        plazo: const Duration(seconds: 210),
      );

  @override
  Future<List<Map<String, dynamic>>> notificaciones(String token) async =>
      _lista(
        await _cliente.pedir(
          'GET',
          '/notificaciones',
          consulta: {'estado': 'NUEVA'},
          cabeceras: _con(token),
        ),
        'notificaciones',
      );

  @override
  Future<List<Map<String, dynamic>>> propuestas(String token) async {
    final todas = _lista(
      await _cliente.pedir(
        'GET',
        '/agentes/propuestas',
        cabeceras: _con(token),
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
  ) => _cliente.pedir(
    'POST',
    '/agentes/propuestas/${Uri.encodeComponent(identificador)}/${confirmar ? 'confirmar' : 'rechazar'}',
    cabeceras: _con(token),
    plazo: const Duration(seconds: 30),
  );

  @override
  Future<Map<String, dynamic>> reporte(String peticion, String token) =>
      _cliente.pedir(
        'POST',
        '/reportes',
        cabeceras: _con(token),
        cuerpo: {'peticion': peticion},
        plazo: const Duration(seconds: 210),
      );

  @override
  Future<Uint8List> excel(String identificador, String token) => _cliente.bytes(
    '/reportes/${Uri.encodeComponent(identificador)}/excel',
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
        await _cliente.pedir(
          'GET',
          '/productos/administracion',
          consulta: {'límite': '100'},
          cabeceras: _con(token),
        ),
        'productos',
      );

  @override
  Future<List<VarianteAdmin>> variantesAdmin(
    String producto,
    String token,
  ) async => [
    for (final v in _lista(
      await _cliente.pedir(
        'GET',
        '/administracion/productos/${Uri.encodeComponent(producto)}/variantes',
        cabeceras: _con(token),
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
  ) => _cliente.pedir(
    'GET',
    '/productos/${Uri.encodeComponent(producto)}/recursos-probador/${Uri.encodeComponent(trabajo)}',
    cabeceras: _con(token),
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
  ) => _cliente.pedir(
    'POST',
    '/productos/${Uri.encodeComponent(producto)}/recursos-probador/${Uri.encodeComponent(trabajo)}/publicar',
    cabeceras: _con(token, clave),
    cuerpo: {
      'versión_esperada': version,
      if (aceptarAvisos) 'aceptar_avisos': true,
    },
  );
}

/// Procesadores de la cola: Idempotency-Key fija, versión esperada y comprobante validado (como la web). Un comprobante
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
    final r = await _cliente.pedir(
      op.tipo == registrarMovimiento ? 'POST' : 'PUT',
      '/variantes/${Uri.encodeComponent(variante)}/${op.tipo == registrarMovimiento ? 'movimientos' : 'minimo'}',
      cabeceras: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': op.claveIdempotencia,
      },
      cuerpo: datos,
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

/// «Atender» una alerta de n8n: idempotente en IA (NUEVA → ATENDIDA), por eso puede esperar en la cola sin red.
class ProcesadorAtenderAlerta implements ProcesadorOperacion {
  ProcesadorAtenderAlerta(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    final evento = op.datos!['evento'] as String;
    final r = await _cliente.pedir(
      'POST',
      '/notificaciones/${Uri.encodeComponent(evento)}/atender',
      cabeceras: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': op.claveIdempotencia,
      },
    );
    final n = r['notificacion'];
    if (n is! Map || n['evento'] != evento || n['estado'] != 'ATENDIDA') {
      throw ContratoInvalido('La alerta no quedó atendida; se reintentará.');
    }
    return {'notificacion': n};
  }
}
