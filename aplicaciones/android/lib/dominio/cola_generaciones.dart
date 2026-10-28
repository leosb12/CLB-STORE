import 'dart:async';
import 'dart:math';
import 'dart:typed_data';
import 'contratos.dart';
import 'modelos.dart';
import 'probador_fotografico.dart';

const versionMotorFotografico = 'catvton-7818397-residente-v12-24-2.5-768x1024';

/// Fallos del servidor seguidos antes de pedir «Reintentar»; los cortes de red nunca agotan una solicitud.
const maximoFallosServidor = 5;

/// Espera exponencial con jitter completo, entre 1 y 60 s: varios teléfonos no reintentan a la vez.
int esperaReintentoMs(int intento, [Random? azar]) {
  final tope = min(60000, 5000 * (1 << (min(intento, 8) - 1).clamp(0, 7)));
  return max(1000, ((azar ?? Random()).nextDouble() * tope).round());
}

class ErrorGeneracionFotografica extends StateError {
  ErrorGeneracionFotografica(
    super.message, {
    this.reintentable = false,
    this.red = false,
  });
  final bool reintentable;

  /// Sin conexión con CLB o sesión vencida: se reintenta sin límite. Si es false y reintentable, falló el servidor.
  final bool red;
}

class TrabajoGeneracion {
  const TrabajoGeneracion({
    required this.clave,
    required this.titular,
    required this.producto,
    required this.estado,
    required this.mensaje,
    required this.intentos,
    required this.proximoIntento,
    this.creado = 0,
    this.persona,
    this.prenda,
    this.rutaResultado,
  });
  final String clave, titular, estado, mensaje;
  final Producto producto;
  final int intentos, proximoIntento;
  final int creado;

  /// Originales: solo mientras no hay resultado. El resultado vive en un archivo privado, no en memoria.
  final Uint8List? persona, prenda;
  final String? rutaResultado;
}

abstract interface class AlmacenGeneraciones {
  Future<TrabajoGeneracion> encolar(
    String titular,
    Uint8List persona,
    Uint8List prenda,
    Producto producto,
  );
  Future<List<TrabajoGeneracion>> listar(String titular);
  Future<void> actualizar(
    TrabajoGeneracion trabajo,
    String estado,
    String mensaje, {
    Uint8List? resultado,
    int? intentos,
    int? proximoIntento,
  });
  Future<void> eliminar(String clave, String titular);
  Future<List<String>> borrados(String titular);
  Future<void> confirmarBorrado(String clave, String titular);

  /// Cerrar sesión en un teléfono compartido: filas y archivos de todas las cuentas; no los borrados pendientes.
  Future<void> borrarTodo();
}

/// Cola de fotografías independiente de los pedidos; una sola solicitud remota a la vez.
class ColaGeneraciones {
  ColaGeneraciones(this.almacen, this.motor, this.sesion);
  final AlmacenGeneraciones almacen;
  final ProbadorFotografico motor;
  final Sesion sesion;
  final _cambios = StreamController<void>.broadcast();
  Stream<void> get cambios => _cambios.stream;
  bool _procesando = false;
  String? errorAlmacenamiento;
  final _avances = <String, String>{};
  final _eliminadas = <String>{};
  String? avance(String clave) => _avances[clave];

  Future<List<TrabajoGeneracion>> listar() async {
    final titular = await sesion.titular();
    if (titular == null) return [];
    final trabajos = await almacen.listar(titular.sub);
    return (await sesion.titular())?.sub == titular.sub ? trabajos : [];
  }

  Future<void> encolar(
    Uint8List persona,
    Uint8List prenda,
    Producto producto,
  ) async {
    final titular = await sesion.titular();
    if (titular == null) {
      throw StateError('Inicia sesión antes de guardar una solicitud.');
    }
    if (persona.isEmpty ||
        prenda.isEmpty ||
        persona.length > 8 * 1024 * 1024 ||
        prenda.length > 8 * 1024 * 1024) {
      throw StateError('Usa fotografías de hasta 8 MB.');
    }
    final trabajo = await almacen.encolar(
      titular.sub,
      persona,
      prenda,
      producto,
    );
    if (trabajo.estado == 'ERROR') {
      await reintentar(trabajo);
    }
    _cambios.add(null);
    unawaited(sincronizar(forzar: true));
  }

  Future<void> eliminar(TrabajoGeneracion trabajo) async {
    if ((await sesion.titular())?.sub != trabajo.titular) {
      return;
    }
    _eliminadas.add(trabajo.clave);
    await almacen.eliminar(trabajo.clave, trabajo.titular);
    await motor.eliminarGuardada(trabajo.clave);
    _cambios.add(null);
    unawaited(sincronizar());
  }

  Future<void> reintentar(TrabajoGeneracion trabajo) async {
    if ((await sesion.titular())?.sub != trabajo.titular ||
        trabajo.estado != 'ERROR') {
      return;
    }
    await almacen.actualizar(
      trabajo,
      'PENDIENTE',
      'Solicitud lista para reintentar.',
      proximoIntento: 0,
    );
    _cambios.add(null);
    unawaited(sincronizar());
  }

  /// Al cerrar sesión no quedan fotos corporales ni resultados privados en el teléfono.
  Future<void> borrarDatosLocales() async {
    // Una generación en curso se descarta al terminar en vez de guardar su PNG.
    _eliminadas.addAll((await listar()).map((t) => t.clave));
    await almacen.borrarTodo();
    await motor.borrarGuardadas();
    _cambios.add(null);
  }

  Future<void> borrarResultados() async {
    for (final trabajo in await listar()) {
      await eliminar(trabajo);
    }
  }

  Future<void> sincronizar({bool forzar = false}) async {
    if (_procesando) return;
    _procesando = true;
    try {
      errorAlmacenamiento = null;
      final titular = (await sesion.titular())?.sub;
      if (titular == null) return;
      for (final clave in await almacen.borrados(titular)) {
        if (clave != '*') await motor.eliminarGuardada(clave);
        await motor.invalidarRemota(clave, titular);
        await almacen.confirmarBorrado(clave, titular);
        _eliminadas.remove(clave);
      }
      for (final trabajo in await almacen.listar(titular)) {
        if (_eliminadas.contains(trabajo.clave) ||
            trabajo.estado != 'PENDIENTE' ||
            (!forzar &&
                trabajo.proximoIntento >
                    DateTime.now().millisecondsSinceEpoch)) {
          continue;
        }
        if ((await sesion.titular())?.sub != titular) break;
        final intentos = trabajo.intentos + 1;
        await almacen.actualizar(
          trabajo,
          'ENVIANDO',
          'Conectando con el servidor de imágenes…',
          intentos: intentos,
        );
        _cambios.add(null);
        try {
          final resultado = await motor.generar(
            trabajo.persona!,
            trabajo.prenda!,
            trabajo.producto,
            (mensaje) {
              _avances[trabajo.clave] = mensaje;
              _cambios.add(null);
            },
            () => !_eliminadas.contains(trabajo.clave),
            titularEsperado: titular,
          );
          if (_eliminadas.contains(trabajo.clave)) continue;
          await almacen.actualizar(
            trabajo,
            'LISTO',
            'Imagen generada y guardada en este teléfono.',
            resultado: resultado,
          );
        } catch (error) {
          if (_eliminadas.contains(trabajo.clave)) continue;
          final reintentable =
              error is ErrorGeneracionFotografica && error.reintentable;
          final red = error is ErrorGeneracionFotografica && error.red;
          // ponytail: cuenta todos los intentos; un servidor caído tras un largo corte de red llega antes al tope.
          final agotada =
              reintentable && !red && intentos >= maximoFallosServidor;
          final mensaje = error is StateError
              ? error.message
              : 'No se pudo generar la imagen.';
          await almacen.actualizar(
            trabajo,
            reintentable && !agotada ? 'PENDIENTE' : 'ERROR',
            red
                ? mensaje
                : agotada
                ? '$mensaje Pulsa «Reintentar» cuando quieras volver a intentarlo.'
                : reintentable
                ? '$mensaje Se reintentará automáticamente.'
                : mensaje,
            intentos: intentos,
            proximoIntento:
                DateTime.now().millisecondsSinceEpoch +
                esperaReintentoMs(intentos),
          );
          if (reintentable) break;
        } finally {
          if (_eliminadas.contains(trabajo.clave)) {
            await motor.eliminarGuardada(trabajo.clave);
          }
          _avances.remove(trabajo.clave);
          _cambios.add(null);
        }
      }
    } on ErrorGeneracionFotografica {
      // Los borrados pendientes son durables; se reintentan antes de cualquier nueva subida.
    } catch (_) {
      errorAlmacenamiento =
          'No se pudo actualizar la cola del teléfono. Libera espacio y vuelve a abrir la app.';
      _cambios.add(null);
    } finally {
      _procesando = false;
    }
  }
}
