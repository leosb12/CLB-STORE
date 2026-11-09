import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../dominio/contratos.dart';
import '../dominio/modelos.dart';

/// Pasarela de CLB Store. En el teléfono, `adb reverse tcp:18000 tcp:18000` la lleva a la laptop con el mismo emisor de
/// tokens que la web; se cambia con `--dart-define=CLB_PASARELA=https://...` para otro despliegue.
const pasarela = String.fromEnvironment(
  'CLB_PASARELA',
  defaultValue: 'http://127.0.0.1:18000',
);

/// GET/POST JSON con errores traducidos al dominio: sin red → [SinConexion]; estado ≠ 2xx → [ErrorRemoto].
class ClienteJson {
  ClienteJson(this._http, {this.base = '$pasarela/api/v1'});
  final http.Client _http;
  final String base;

  Future<Map<String, dynamic>> pedir(
    String metodo,
    String ruta, {
    Map<String, String>? consulta,
    Map<String, String> cabeceras = const {},
    Object? cuerpo,
    Duration plazo = const Duration(seconds: 15),
  }) async {
    final solicitud = http.Request(metodo, _uri(ruta, consulta))
      ..headers.addAll({'Accept': 'application/json', ...cabeceras});
    if (cuerpo != null) {
      solicitud.headers['Content-Type'] = 'application/json';
      solicitud.body = jsonEncode(cuerpo);
    }
    return _json(await _enviar(solicitud, plazo));
  }

  /// Archivo binario (Excel, vista previa) con los mismos errores de dominio.
  Future<Uint8List> bytes(
    String ruta, {
    Map<String, String> cabeceras = const {},
    Duration plazo = const Duration(seconds: 30),
  }) async {
    final solicitud = http.Request('GET', _uri(ruta, null))
      ..headers.addAll(cabeceras);
    return (await _enviar(solicitud, plazo)).bodyBytes;
  }

  /// Formulario multipart (foto de prenda, audio) y respuesta JSON.
  Future<Map<String, dynamic>> multipart(
    String ruta, {
    required Map<String, String> campos,
    required http.MultipartFile archivo,
    Map<String, String> cabeceras = const {},
    Duration plazo = const Duration(seconds: 60),
  }) async {
    final solicitud = http.MultipartRequest('POST', _uri(ruta, null))
      ..headers.addAll({'Accept': 'application/json', ...cabeceras})
      ..fields.addAll(campos)
      ..files.add(archivo);
    return _json(await _enviar(solicitud, plazo));
  }

  Uri _uri(String ruta, Map<String, String>? consulta) =>
      Uri.parse('$base$ruta').replace(queryParameters: consulta);

  /// Sin red → [SinConexion]; estado ≠ 2xx → [ErrorRemoto] con el mensaje del servicio si lo trae.
  Future<http.Response> _enviar(
    http.BaseRequest solicitud,
    Duration plazo,
  ) async {
    final http.Response respuesta;
    try {
      respuesta = await http.Response.fromStream(
        await _http.send(solicitud).timeout(plazo),
      ).timeout(plazo);
    } on SocketException {
      throw SinConexion();
    } on TimeoutException {
      throw SinConexion('La tienda no respondió a tiempo.');
    } on http.ClientException {
      throw SinConexion();
    }
    if (respuesta.statusCode < 200 || respuesta.statusCode > 299) {
      Object? json;
      try {
        json = jsonDecode(utf8.decode(respuesta.bodyBytes));
      } on FormatException {
        json = null;
      }
      final mensaje = json is Map && json['mensaje'] is String
          ? json['mensaje'] as String
          : null;
      throw ErrorRemoto(
        respuesta.statusCode,
        mensaje ?? 'El servicio respondió ${respuesta.statusCode}.',
      );
    }
    return respuesta;
  }

  Map<String, dynamic> _json(http.Response respuesta) {
    // 204 (vincular, contacto, desvincular): éxito sin cuerpo.
    if (respuesta.statusCode == 204) return {};
    Object? json;
    try {
      json = jsonDecode(utf8.decode(respuesta.bodyBytes));
    } on FormatException {
      json = null;
    }
    if (json is! Map<String, dynamic>) {
      throw ContratoInvalido('La respuesta no es JSON válido.');
    }
    return json;
  }
}

class CatalogoRest implements FuenteCatalogo {
  CatalogoRest(this._cliente);
  final ClienteJson _cliente;

  /// Todas las páginas de 100, comprobando que el total no cambie durante la descarga (igual que la web).
  @override
  Future<List<Producto>> productos() async {
    final productos = <Producto>[];
    int? total;
    for (var numero = 1; numero <= 10000; numero++) {
      final pagina = await _cliente.pedir(
        'GET',
        '/productos',
        consulta: {'página': '$numero', 'límite': '100'},
      );
      final lista = pagina['productos'], paginacion = pagina['paginación'];
      if (lista is! List ||
          paginacion is! Map ||
          paginacion['total'] is! int ||
          paginacion['página'] != numero ||
          (total != null && total != paginacion['total'])) {
        throw ContratoInvalido(
          'El catálogo cambió durante la descarga. Vuelve a sincronizar.',
        );
      }
      total = paginacion['total'] as int;
      productos.addAll(
        lista.map((p) => Producto.desdeJson(p as Map<String, dynamic>)),
      );
      if (productos.length == total) {
        if (productos.map((p) => p.identificador).toSet().length != total) {
          throw ContratoInvalido(
            'El catálogo contiene identificadores repetidos.',
          );
        }
        return productos;
      }
      if (lista.isEmpty || productos.length > total) {
        throw ContratoInvalido('La descarga del catálogo está incompleta.');
      }
    }
    throw ContratoInvalido('El catálogo excede el límite de descarga local.');
  }

  /// Solo las variantes activas se venden; Inventario las publica todas.
  @override
  Future<List<Variante>> variantes(String identificadorProducto) async {
    final r = await _cliente.pedir(
      'GET',
      '/productos/${Uri.encodeComponent(identificadorProducto)}/variantes',
    );
    final lista = r['variantes'];
    if (lista is! List)
      throw ContratoInvalido(
        'La respuesta de Inventario no cumple el contrato de variantes.',
      );
    return [
      for (final v in lista.cast<Map<String, dynamic>>())
        if (v['activo'] == true &&
            v['identificador_producto'] == identificadorProducto)
          Variante.desdeJson(v),
    ];
  }

  @override
  Future<Map<String, dynamic>> modeloTallas() =>
      _cliente.pedir('GET', '/tallas/modelo');
}

class VentasRest implements FuenteVentas {
  VentasRest(this._cliente);
  final ClienteJson _cliente;

  @override
  Future<List<PedidoVenta>> historial(String token) async {
    final pedidos = <String, PedidoVenta>{};
    final cursores = <String>{};
    String? antes;
    for (var pagina = 0; pagina < 10000; pagina++) {
      final r = await _cliente.pedir(
        'GET',
        '/pedidos',
        consulta: {'limite': '100', 'antes': ?antes},
        cabeceras: {'Authorization': 'Bearer $token'},
      );
      if (r['pedidos'] is! List || !r.containsKey('siguiente')) {
        throw ContratoInvalido('Historial de pedidos inválido.');
      }
      for (final dato in r['pedidos'] as List) {
        final pedido = PedidoVenta.desdeJson(dato as Map<String, dynamic>);
        if (pedidos.containsKey(pedido.identificador))
          throw ContratoInvalido('Pedido repetido en el historial.');
        pedidos[pedido.identificador] = pedido;
      }
      if (r['siguiente'] == null) return pedidos.values.toList();
      antes = r['siguiente'] as String;
      if (!esUuidV4(antes) ||
          !cursores.add(antes) ||
          (r['pedidos'] as List).isEmpty ||
          (r['pedidos'] as List).last['identificador'] != antes) {
        throw ContratoInvalido('Paginación del historial inválida.');
      }
    }
    throw ContratoInvalido('El historial excede el límite de descarga.');
  }

  // La SAGA es síncrona en Ventas y puede reintentar participantes: se espera más que una consulta normal (por debajo
  // del plazo de 90 s de la pasarela) para no reenviar un pedido que aún se procesa.
  static const plazoSaga = Duration(seconds: 80);

  @override
  Future<PedidoVenta> confirmar(Operacion operacion, String token) async {
    final r = await _cliente.pedir(
      'POST',
      '/pedidos',
      // La misma clave en cada reintento: Ventas devuelve el pedido existente y nunca crea otro.
      cabeceras: {
        'Authorization': 'Bearer $token',
        'Idempotency-Key': operacion.claveIdempotencia,
      },
      cuerpo: operacion.solicitud,
      plazo: plazoSaga,
    );
    return _pedido(r);
  }

  @override
  Future<PedidoVenta> consultar(String identificador, String token) async =>
      _pedido(
        await _cliente.pedir(
          'GET',
          '/pedidos/${Uri.encodeComponent(identificador)}',
          cabeceras: {'Authorization': 'Bearer $token'},
        ),
      );

  PedidoVenta _pedido(Map<String, dynamic> r) {
    final pedido = r['pedido'];
    if (pedido is! Map<String, dynamic>)
      throw ContratoInvalido('Ventas no devolvió un pedido válido.');
    return PedidoVenta.desdeJson(pedido);
  }
}
