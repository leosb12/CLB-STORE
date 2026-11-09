/// Entidades y reglas de la tienda en el dispositivo. Dart puro: sin Flutter, sin E/S.
library;

import 'dart:math';
import 'recurso_probador.dart';

final _uuidV4 = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  caseSensitive: false,
);
final _identificadorProducto = RegExp(r'^[a-f0-9]{32}$');
final _precio = RegExp(r'^(0|[1-9]\d{0,8})\.\d{2}$');

bool esUuidV4(Object? valor) => valor is String && _uuidV4.hasMatch(valor);

/// UUID v4 con el generador criptográfico del sistema: identifica pedidos y claves de idempotencia del dispositivo.
String nuevoUuid([Random? azar]) {
  final r = azar ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

/// Precio decimal BOB en texto ("219.00") a centavos enteros: el dinero nunca pasa por double.
int centavos(String texto) {
  if (!_precio.hasMatch(texto))
    throw FormatException('Precio decimal inválido: $texto');
  final partes = texto.split('.');
  return int.parse(partes[0]) * 100 + int.parse(partes[1]);
}

String importe(int centavos) =>
    '${centavos ~/ 100},${(centavos % 100).toString().padLeft(2, '0')} Bs';

class ContratoInvalido implements Exception {
  ContratoInvalido(this.mensaje);
  final String mensaje;
  @override
  String toString() => mensaje;
}

/// Error HTTP de un servicio: el estado decide si la cola reintenta con la misma clave.
class ErrorRemoto implements Exception {
  ErrorRemoto(this.estado, this.mensaje);
  final int estado;
  final String mensaje;
  @override
  String toString() => mensaje;
}

/// Keycloak rechazó la renovación y la sesión local se borró: hay que volver a iniciar sesión. No es un fallo de red.
class SesionVencida implements Exception {
  const SesionVencida();
  @override
  String toString() => 'La sesión venció.';
}

/// Sin red, plazo vencido o respuesta ilegible: siempre reintentable.
class SinConexion implements Exception {
  SinConexion([this.mensaje = 'Sin conexión con la tienda.']);
  final String mensaje;
  @override
  String toString() => mensaje;
}

class Producto {
  const Producto({
    required this.identificador,
    required this.sku,
    required this.nombre,
    required this.descripcion,
    required this.categoria,
    required this.precioCentavos,
    required this.fechaActualizacion,
    this.recursoProbador,
  });

  final String identificador;
  final String sku;
  final String nombre;
  final String descripcion;
  final String categoria;
  final int precioCentavos;
  final String fechaActualizacion;
  final RecursoProbador? recursoProbador;

  /// Representación pública de Inventario (fase 3). Solo se aceptan productos activos en BOB.
  factory Producto.desdeJson(Map<String, dynamic> j) {
    if (!_identificadorProducto.hasMatch('${j['identificador']}') ||
        j['moneda'] != 'BOB' ||
        j['activo'] != true ||
        j['nombre'] is! String ||
        j['sku'] is! String ||
        j['categoría'] is! String ||
        j['precio'] is! String) {
      throw ContratoInvalido(
        'La respuesta de Inventario no cumple el contrato del catálogo.',
      );
    }
    return Producto(
      identificador: j['identificador'],
      sku: j['sku'],
      nombre: j['nombre'],
      descripcion: j['descripción'] is String ? j['descripción'] : '',
      categoria: j['categoría'],
      precioCentavos: centavos(j['precio']),
      fechaActualizacion: '${j['fecha_actualización']}',
      recursoProbador: j['recurso_probador'] == null
          ? null
          : RecursoProbador.validar(
              Map<String, dynamic>.from(j['recurso_probador'] as Map),
            ),
    );
  }
}

class Variante {
  const Variante({
    required this.identificador,
    required this.identificadorProducto,
    required this.sku,
    required this.talla,
    required this.color,
    required this.disponible,
  });

  final String identificador;
  final String identificadorProducto;
  final String sku;
  final String talla;
  final String color;

  /// Copia del último catálogo descargado: orientativa sin red; el stock real lo decide la SAGA.
  final int disponible;

  factory Variante.desdeJson(Map<String, dynamic> j) {
    final disponible = j['disponible'];
    if (!esUuidV4(j['identificador']) ||
        j['identificador_producto'] is! String ||
        j['sku'] is! String ||
        j['talla'] is! String ||
        j['color'] is! String ||
        disponible is! int ||
        disponible < 0) {
      throw ContratoInvalido(
        'La respuesta de Inventario no cumple el contrato de variantes.',
      );
    }
    return Variante(
      identificador: j['identificador'],
      identificadorProducto: j['identificador_producto'],
      sku: j['sku'],
      talla: j['talla'],
      color: j['color'],
      disponible: disponible,
    );
  }
}

const _ordenTallas = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

/// Orden de tienda (XS, S, M, L, XL; luego tallas numéricas o desconocidas por texto), y por color dentro de cada talla.
int compararVariantes(Variante a, Variante b) {
  int rango(String t) {
    final i = _ordenTallas.indexOf(t.toUpperCase());
    return i < 0 ? _ordenTallas.length : i;
  }

  final porTalla = rango(a.talla).compareTo(rango(b.talla));
  if (porTalla != 0) return porTalla;
  final porTexto = a.talla.compareTo(b.talla);
  return porTexto != 0 ? porTexto : a.color.compareTo(b.color);
}

class LineaCarrito {
  const LineaCarrito({
    required this.identificadorVariante,
    required this.identificadorProducto,
    required this.sku,
    required this.nombre,
    required this.talla,
    required this.color,
    required this.precioCentavos,
    required this.cantidad,
  });

  final String identificadorVariante;
  final String identificadorProducto;
  final String sku;
  final String nombre;
  final String talla;
  final String color;

  /// Precio de referencia al agregar; el precio cobrado lo fija Ventas con su copia de Inventario.
  final int precioCentavos;
  final int cantidad;

  int get subtotalCentavos => precioCentavos * cantidad;

  LineaCarrito conCantidad(int nueva) => LineaCarrito(
    identificadorVariante: identificadorVariante,
    identificadorProducto: identificadorProducto,
    sku: sku,
    nombre: nombre,
    talla: talla,
    color: color,
    precioCentavos: precioCentavos,
    cantidad: nueva,
  );

  Map<String, Object> aJson() => {
    'identificador_variante': identificadorVariante,
    'identificador_producto': identificadorProducto,
    'sku': sku,
    'nombre': nombre,
    'talla': talla,
    'color': color,
    'precio_centavos': precioCentavos,
    'cantidad': cantidad,
  };

  factory LineaCarrito.desdeJson(Map<String, dynamic> j) => LineaCarrito(
    identificadorVariante: j['identificador_variante'],
    identificadorProducto: j['identificador_producto'],
    sku: j['sku'],
    nombre: j['nombre'],
    talla: j['talla'],
    color: j['color'],
    precioCentavos: j['precio_centavos'],
    cantidad: j['cantidad'],
  );
}

const cantidadMaxima = 1000000000;
const lineasMaximasPorPedido = 50;

void validarCantidad(int cantidad) {
  if (cantidad < 1 || cantidad > cantidadMaxima) {
    throw ArgumentError(
      'La cantidad debe ser un entero positivo de hasta $cantidadMaxima.',
    );
  }
}

int totalCarrito(Iterable<LineaCarrito> lineas) =>
    lineas.fold(0, (t, l) => t + l.subtotalCentavos);

enum EstadoPedido { pendiente, confirmado, cancelado, enRevision }

const _estadosPedido = {
  'PENDIENTE': EstadoPedido.pendiente,
  'CONFIRMADO': EstadoPedido.confirmado,
  'CANCELADO': EstadoPedido.cancelado,
  'EN_REVISION': EstadoPedido.enRevision,
};

/// Pedido según Ventas: el precio, el total y el estado los decide el servidor, nunca el carrito.
/// Instantánea de consulta por cuenta; nunca forma parte de la cola de envío.
class HistorialPedidos {
  const HistorialPedidos(this.pedidos, this.fecha);
  final List<PedidoVenta> pedidos;
  final DateTime fecha;
}

class PedidoVenta {
  const PedidoVenta({
    required this.identificador,
    required this.estado,
    required this.total,
    required this.motivo,
    required this.comprobanteDisponible,
    required this.json,
  });

  final String identificador;
  final EstadoPedido estado;
  final String total;
  final String? motivo;
  final bool comprobanteDisponible;

  /// Respuesta original, para guardarla tal cual en el dispositivo.
  final Map<String, dynamic> json;

  bool get definitivo =>
      estado == EstadoPedido.confirmado || estado == EstadoPedido.cancelado;

  factory PedidoVenta.desdeJson(Map<String, dynamic> j) {
    final estado = _estadosPedido[j['estado']];
    final lineas = j['líneas'];
    if (!esUuidV4(j['identificador']) ||
        estado == null ||
        j['total'] is! String ||
        lineas is! List ||
        lineas.isEmpty) {
      throw ContratoInvalido('Ventas no devolvió un pedido válido.');
    }
    return PedidoVenta(
      identificador: '${j['identificador']}'.toLowerCase(),
      estado: estado,
      total: j['total'],
      motivo: j['motivo'] is String ? j['motivo'] : null,
      comprobanteDisponible: j['comprobante_disponible'] == true,
      json: j,
    );
  }
}

enum EstadoOperacion { pendiente, enviando, confirmada, requiereRevision }

const confirmarPedido = 'CONFIRMAR_PEDIDO';

/// Operación de la cola de sincronización. Para un pedido, su UUID es también el UUID del pedido y la clave de
/// idempotencia es fija: cada reintento envía exactamente la misma solicitud y Ventas devuelve el pedido existente.
class Operacion {
  const Operacion({
    required this.identificador,
    required this.tipo,
    required this.claveIdempotencia,
    required this.titular,
    required this.fechaCreacion,
    required this.estado,
    required this.intentos,
    required this.proximoIntento,
    required this.carrito,
    this.resultado,
    this.error,
    this.datos,
    this.respuesta,
    this.reemplazadaPor,
  });

  final String identificador;
  final String tipo;
  final String claveIdempotencia;

  /// `sub` de Keycloak de quien confirmó: el pedido nunca se envía con otra sesión.
  final String titular;
  final DateTime fechaCreacion;
  final EstadoOperacion estado;
  final int intentos;
  final DateTime proximoIntento;

  /// Copia local del carrito confirmado: se muestra mientras el pedido está pendiente. No se envía completa.
  final List<LineaCarrito> carrito;
  final PedidoVenta? resultado;
  final String? error;

  /// Operaciones de administración (una sola cola con los pedidos): cuerpo propuesto, sin `versión_esperada` mientras
  /// dependa de otra operación sobre la misma variante.
  final Map<String, dynamic>? datos;

  /// Comprobante del servidor (p. ej. la variante confirmada con su nueva versión).
  final Map<String, dynamic>? respuesta;

  /// Corrección explícita de una operación en revisión: la antigua conserva el antecedente y apunta a la nueva.
  final String? reemplazadaPor;
  bool get esPedido => tipo == confirmarPedido;

  /// Cuerpo exacto de `POST /api/v1/pedidos`: siempre el mismo para la misma operación.
  Map<String, Object> get solicitud => {
    'identificador': identificador,
    'líneas': [
      for (final l in carrito)
        {
          'identificador_variante': l.identificadorVariante,
          'cantidad': l.cantidad,
        },
    ],
  };

  int get totalReferenciaCentavos => totalCarrito(carrito);

  Operacion copiar({
    EstadoOperacion? estado,
    int? intentos,
    DateTime? proximoIntento,
    PedidoVenta? resultado,
    String? error,
    bool borrarError = false,
    Map<String, dynamic>? datos,
    Map<String, dynamic>? respuesta,
    String? reemplazadaPor,
  }) => Operacion(
    identificador: identificador,
    tipo: tipo,
    claveIdempotencia: claveIdempotencia,
    titular: titular,
    fechaCreacion: fechaCreacion,
    estado: estado ?? this.estado,
    intentos: intentos ?? this.intentos,
    proximoIntento: proximoIntento ?? this.proximoIntento,
    carrito: carrito,
    resultado: resultado ?? this.resultado,
    error: borrarError ? null : (error ?? this.error),
    datos: datos ?? this.datos,
    respuesta: respuesta ?? this.respuesta,
    reemplazadaPor: reemplazadaPor ?? this.reemplazadaPor,
  );

  /// Nuevo pedido: el dispositivo asigna el UUID para que los reintentos no dupliquen.
  factory Operacion.pedido(
    List<LineaCarrito> lineas,
    String titular,
    DateTime ahora, [
    Random? azar,
  ]) {
    if (lineas.isEmpty) throw ArgumentError('El carrito está vacío.');
    if (lineas.length > lineasMaximasPorPedido) {
      throw ArgumentError(
        'Un pedido admite hasta $lineasMaximasPorPedido variantes.',
      );
    }
    for (final l in lineas) {
      validarCantidad(l.cantidad);
    }
    final id = nuevoUuid(azar);
    return Operacion(
      identificador: id,
      tipo: confirmarPedido,
      claveIdempotencia: nuevoUuid(azar),
      titular: titular,
      fechaCreacion: ahora,
      estado: EstadoOperacion.pendiente,
      intentos: 0,
      proximoIntento: ahora,
      carrito: List.unmodifiable(lineas),
    );
  }
}

/// Red, 5xx, sesión vencida (401), límites (408/425/429) y respuestas ilegibles se reintentan con la misma clave
/// (el resultado es incierto y repetir es seguro); 403 y los demás 4xx son definitivos.
bool esReintentable(Object error) {
  if (error is SinConexion || error is ContratoInvalido) return true;
  if (error is ErrorRemoto) {
    final e = error.estado;
    return e >= 500 || const {401, 408, 425, 429}.contains(e);
  }
  return false;
}

/// Espera exponencial 5 s, 10 s, 20 s, 40 s y luego 60 s fijos: la cola nunca abandona ni cambia la clave.
Duration esperaTrasIntento(int intentos) =>
    Duration(seconds: min(60, 5 * (1 << min(intentos - 1, 4))));

/// Resultado de un envío aplicado a la operación (máquina de estados pura, probada sin red).
Operacion trasEnvio(
  Operacion op,
  DateTime ahora, {
  PedidoVenta? pedido,
  Map<String, dynamic>? respuesta,
  Object? error,
}) {
  if (pedido != null && pedido.identificador == op.identificador) {
    return op.copiar(
      estado: EstadoOperacion.confirmada,
      resultado: pedido,
      borrarError: true,
    );
  }
  // Operación administrativa: su procesador ya validó el comprobante (identidad y versión).
  if (!op.esPedido && respuesta != null && error == null) {
    return op.copiar(
      estado: EstadoOperacion.confirmada,
      respuesta: respuesta,
      borrarError: true,
    );
  }
  error ??= ContratoInvalido('Ventas respondió con otro pedido.');
  final intentos = op.intentos + 1;
  if (esReintentable(error)) {
    return op.copiar(
      estado: EstadoOperacion.pendiente,
      intentos: intentos,
      proximoIntento: ahora.add(esperaTrasIntento(intentos)),
      error: '$error',
    );
  }
  return op.copiar(
    estado: EstadoOperacion.requiereRevision,
    intentos: intentos,
    error: '$error',
  );
}
