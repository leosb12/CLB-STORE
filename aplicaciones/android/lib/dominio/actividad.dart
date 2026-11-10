/// Registro de actividad del teléfono: qué funcionalidad se usó, cuándo y con qué resultado. Solo texto redactado
/// por la app; nunca contraseñas, tokens, datos personales ni coordenadas.
enum Severidad { info, success, warning, error }

abstract final class CategoriaActividad {
  static const sesion = 'Sesión';
  static const catalogo = 'Catálogo';
  static const carrito = 'Carrito';
  static const pedidos = 'Pedidos';
  static const sincronizacion = 'Sincronización';
  static const conectividad = 'Conectividad';
  static const notificaciones = 'Notificaciones';
  static const ia = 'IA';
  static const mcp = 'Misiones MCP';
  static const microfono = 'Micrófono';
  static const sucursales = 'Sucursales';
  static const ubicacion = 'Ubicación y rutas';
  static const errores = 'Errores';
}

class EventoActividad {
  const EventoActividad({
    required this.fecha,
    required this.categoria,
    required this.funcionalidad,
    required this.descripcion,
    required this.severidad,
  });
  final DateTime fecha;
  final String categoria, funcionalidad, descripcion;
  final Severidad severidad;
}

abstract class RegistroActividad {
  /// Nunca lanza: un fallo al registrar no puede afectar la operación registrada.
  Future<void> registrar(
    String titular,
    String categoria,
    String funcionalidad,
    String descripcion,
    Severidad severidad,
  );

  /// Eventos de esa cuenta, del más reciente al más antiguo.
  Future<List<EventoActividad>> leer(String titular);
}

/// Máximo de eventos guardados por cuenta; los más antiguos se descartan.
const limiteActividad = 1000;

final _jwt = RegExp(r'eyJ[\w-]+\.[\w-]+\.[\w-]*');
final _bearer = RegExp(r'Bearer\s+\S+', caseSensitive: false);
// Dos decimales con 4+ cifras seguidos (lat, long): se ocultan aunque un mensaje de error los arrastre.
final _coordenadas = RegExp(r'-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}');
final _decimalLargo = RegExp(r'-?\d{1,3}\.\d{5,}');
final _correo = RegExp(r'[\w.+-]+@[\w-]+\.[\w.]+');

/// Defensa en profundidad: aunque los textos los arma la app, se quitan tokens, correos y coordenadas.
String sanear(String texto) {
  final limpio = texto
      .replaceAll(_jwt, '[token]')
      .replaceAll(_bearer, '[token]')
      .replaceAll(_coordenadas, '[ubicación]')
      .replaceAll(_decimalLargo, '[ubicación]')
      .replaceAll(_correo, '[correo]')
      .trim();
  return limpio.length <= 300 ? limpio : '${limpio.substring(0, 297)}…';
}
