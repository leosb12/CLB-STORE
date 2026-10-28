import 'dart:math';

import 'modelos.dart';

/// Operaciones administrativas que viajan por la misma cola que los pedidos (como la web).
const registrarMovimiento = 'REGISTRAR_MOVIMIENTO';
const configurarMinimo = 'CONFIGURAR_MINIMO';
const atenderAlerta = 'ATENDER_ALERTA';
const tiposExistencias = {registrarMovimiento, configurarMinimo};
const tiposAdministracion = {...tiposExistencias, atenderAlerta};

/// Variante vista por administración: saldos y la versión que exige cada cambio (control optimista de Inventario).
class VarianteAdmin {
  const VarianteAdmin(this.json);
  final Map<String, dynamic> json;
  String get identificador => json['identificador'] as String;
  String get identificadorProducto => json['identificador_producto'] as String;
  String get sku => json['sku'] as String;
  String get talla => json['talla'] as String;
  String get color => json['color'] as String;
  int get fisica => json['física'] as int;
  int get reservada => json['reservada'] as int;
  int get disponible => json['disponible'] as int;
  int get minimo => json['mínimo'] as int;
  int get version => json['versión_sincronización'] as int;
  bool get stockBajo => json['stock_bajo'] == true;

  static final _uuid = RegExp(
    r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
  );

  factory VarianteAdmin.validar(Object? valor) {
    if (valor is! Map ||
        valor['identificador'] is! String ||
        !_uuid.hasMatch(valor['identificador'] as String) ||
        valor['identificador_producto'] is! String ||
        !['sku', 'talla', 'color'].every((c) => valor[c] is String) ||
        ![
          'física',
          'reservada',
          'disponible',
          'mínimo',
        ].every((c) => valor[c] is int && (valor[c] as int) >= 0) ||
        valor['versión_sincronización'] is! int ||
        (valor['versión_sincronización'] as int) < 1) {
      throw ContratoInvalido('Variante de administración inválida.');
    }
    return VarianteAdmin(
      Map<String, dynamic>.unmodifiable(valor.cast<String, dynamic>()),
    );
  }
}

/// Nueva operación de existencias. Si ya hay otra pendiente sobre la misma variante, esta no fija versión: la tomará del
/// comprobante de esa antecesora al enviarse (las propuestas offline se encadenan sin conflicto).
Operacion operacionExistencias({
  required String tipo,
  required VarianteAdmin variante,
  required Map<String, dynamic> cuerpo,
  required String titular,
  required DateTime ahora,
  required List<Operacion> cola,
  Random? azar,
}) {
  if (!tiposExistencias.contains(tipo))
    throw ArgumentError('Tipo no admitido: $tipo');
  final id = nuevoUuid(azar);
  final hayAntecesora = cola.any(
    (o) =>
        o.datos?['identificador_variante'] == variante.identificador &&
        o.reemplazadaPor == null &&
        o.estado != EstadoOperacion.confirmada,
  );
  return Operacion(
    identificador: id,
    tipo: tipo,
    claveIdempotencia: id,
    titular: titular,
    fechaCreacion: ahora,
    estado: EstadoOperacion.pendiente,
    intentos: 0,
    proximoIntento: ahora,
    carrito: const [],
    datos: {
      ...cuerpo,
      'identificador_variante': variante.identificador,
      'sku': variante.sku,
      if (!hayAntecesora) 'versión_esperada': variante.version,
    },
  );
}

/// Corrección de una operación en revisión: queda marcada para que sus dependientes no la tomen como la más reciente.
Operacion reemplazo(Operacion nueva, Operacion antigua) => nueva.copiar(
  datos: {...?nueva.datos, 'reemplazo_de': antigua.identificador},
);

/// Versión pendiente de resolver.
sealed class Resolucion {
  const Resolucion();
}

class Lista extends Resolucion {
  const Lista(this.operacion);
  final Operacion operacion;
}

class Esperar extends Resolucion {
  const Esperar();
}

class Bloqueada extends Resolucion {
  const Bloqueada(this.motivo);
  final String motivo;
}

/// Regla pura (misma que la web): una operación sin versión toma la del comprobante confirmado de la operación anterior
/// sobre la misma variante. Una vez resuelta se guarda y se conserva en cada reintento.
Resolucion resolverVersion(Operacion op, List<Operacion> cola) {
  final datos = op.datos ?? const {};
  if (!tiposExistencias.contains(op.tipo) || datos['versión_esperada'] is int)
    return Lista(op);
  final porId = {for (final o in cola) o.identificador: o};
  // La operación anterior sobre la misma variante; si se rehízo, cuenta su reemplazo (una corrección redirige a los
  // dependientes que aún no se enviaron).
  final anteriores = [
    for (final o in cola)
      if (o.identificador != op.identificador &&
          o.datos?['identificador_variante'] ==
              datos['identificador_variante'] &&
          o.fechaCreacion.isBefore(op.fechaCreacion) &&
          o.datos?['reemplazo_de'] == null)
        o,
  ]..sort((a, b) => b.fechaCreacion.compareTo(a.fechaCreacion));
  var antecesora = anteriores.firstOrNull;
  for (
    var saltos = 0;
    antecesora?.reemplazadaPor != null && saltos < 16;
    saltos++
  ) {
    antecesora = porId[antecesora!.reemplazadaPor];
  }
  if (antecesora == null) {
    return const Bloqueada(
      'No se conoce la versión de la variante: vuelve a cargarla y rehaz el cambio.',
    );
  }
  switch (antecesora.estado) {
    case EstadoOperacion.confirmada:
      final version =
          (antecesora.respuesta?['variante']
              as Map?)?['versión_sincronización'];
      if (version is! int)
        return const Bloqueada(
          'El cambio anterior no trae versión confirmada.',
        );
      return Lista(op.copiar(datos: {...datos, 'versión_esperada': version}));
    case EstadoOperacion.requiereRevision:
      // Espera a que el anterior se rehaga: entonces toma la versión de su reemplazo.
      return const Esperar();
    default:
      return const Esperar();
  }
}
