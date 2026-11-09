import 'dart:math';

import 'administracion.dart' show Resolucion, Lista, Esperar, Bloqueada;
import 'modelos.dart';

/// Preferencias de avisos de pedido (push y correo) guardadas por Clientes, con versión para detectar ediciones paralelas.
const guardarPreferenciasAvisos = 'PREFERENCIAS_AVISOS';

class PreferenciasAvisos {
  const PreferenciasAvisos({
    required this.push,
    required this.correo,
    required this.version,
    this.correoDisponible = false,
  });

  /// Transaccionales: sin elección previa, ambos canales activos (el push además depende del permiso del sistema).
  static const porDefecto = PreferenciasAvisos(
    push: true,
    correo: true,
    version: 0,
  );

  final bool push;
  final bool correo;
  final int version;

  /// Clientes conoce un correo del titular (claim del token); sin él solo puede llegar el push.
  final bool correoDisponible;

  factory PreferenciasAvisos.desdeJson(Object? valor) {
    if (valor is! Map ||
        valor['push'] is! bool ||
        valor['correo'] is! bool ||
        valor['versión'] is! int) {
      throw ContratoInvalido('Preferencias de avisos inválidas.');
    }
    return PreferenciasAvisos(
      push: valor['push'] as bool,
      correo: valor['correo'] as bool,
      version: valor['versión'] as int,
      correoDisponible: valor['correo_disponible'] == true,
    );
  }

  Map<String, Object> get json => {
    'push': push,
    'correo': correo,
    'versión': version,
    'correo_disponible': correoDisponible,
  };
}

/// Permiso del sistema para mostrar notificaciones: distinto de la preferencia guardada.
enum PermisoAvisos { concedido, denegado, sinDecidir, noDisponible }

/// Aviso recibido o tocado: solo datos de navegación (destino y pedido), nunca montos.
class AvisoPedido {
  const AvisoPedido({
    required this.titulo,
    required this.cuerpo,
    required this.datos,
  });
  final String titulo;
  final String cuerpo;
  final Map<String, String> datos;
  bool get abrePedidos => datos['destino'] == 'pedidos';
}

/// Cambio de preferencias en la cola: viaja con la versión que vio la persona y una clave estable. Si un cambio anterior
/// ya salió con resultado incierto, el nuevo no reutiliza su clave: va [tras] él y toma la versión que ese confirme.
Operacion operacionPreferencias({
  required bool push,
  required bool correo,
  int? versionEsperada,
  String? tras,
  required String titular,
  required DateTime ahora,
  Random? azar,
}) {
  assert((versionEsperada == null) != (tras == null));
  final id = nuevoUuid(azar);
  return Operacion(
    identificador: id,
    tipo: guardarPreferenciasAvisos,
    claveIdempotencia: id,
    titular: titular,
    fechaCreacion: ahora,
    estado: EstadoOperacion.pendiente,
    intentos: 0,
    proximoIntento: ahora,
    carrito: const [],
    datos: {
      'push': push,
      'correo': correo,
      if (versionEsperada != null) 'versión': versionEsperada,
      if (tras != null) 'tras': tras,
    },
  );
}

/// Regla pura: un cambio que va [tras] otro espera a que ese (o su reemplazo) se confirme y adopta la versión confirmada.
/// Una vez resuelta, la versión se guarda y se conserva en cada reintento (misma clave, mismo cuerpo).
Resolucion resolverPreferencias(Operacion op, List<Operacion> cola) {
  final datos = op.datos ?? const {};
  if (datos['versión'] is int) return Lista(op);
  final porId = {for (final o in cola) o.identificador: o};
  var anterior = porId[datos['tras']];
  for (var saltos = 0; anterior?.reemplazadaPor != null && saltos < 16; saltos++) {
    anterior = porId[anterior!.reemplazadaPor];
  }
  if (anterior == null) {
    return const Bloqueada(
      'No se conoce la versión de tus preferencias: vuelve a elegirlas.',
    );
  }
  if (anterior.estado != EstadoOperacion.confirmada) return const Esperar();
  final version = (anterior.respuesta?['preferencias'] as Map?)?['versión'];
  if (version is! int) {
    return const Bloqueada('El cambio anterior no trae versión confirmada.');
  }
  return Lista(op.copiar(datos: {...datos, 'versión': version}));
}
