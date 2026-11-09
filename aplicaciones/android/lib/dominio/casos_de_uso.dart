/// Casos de uso del dispositivo: CU02 (catálogo y carrito offline), CU03 (compra con cola idempotente) y probador.
library;

import 'dart:async';
import 'dart:typed_data';

import 'administracion.dart';
import 'avisos.dart';
import 'contratos.dart';
import 'modelos.dart';
import 'pose.dart';
import 'tallas.dart';
import 'recurso_probador.dart';

typedef Reloj = DateTime Function();

/// Descarga catálogo, variantes y modelo de tallas; solo reemplaza la copia local si todo llegó completo.
class SincronizarCatalogo {
  SincronizarCatalogo(
    this._fuente,
    this._almacen, [
    Reloj? reloj,
    this.recursos,
  ]) : _reloj = reloj ?? DateTime.now;
  final FuenteCatalogo _fuente;
  final AlmacenLocal _almacen;
  final Reloj _reloj;
  final FuenteRecursosPrendas? recursos;

  Future<DateTime> ejecutar() async {
    final productos = await _fuente.productos();
    final variantes = <Variante>[];
    // De a 4 productos en paralelo: rápido con buena red sin saturar una conexión inestable.
    for (var i = 0; i < productos.length; i += 4) {
      final lote = productos
          .skip(i)
          .take(4)
          .map((p) => _fuente.variantes(p.identificador));
      for (final vs in await Future.wait(lote)) {
        variantes.addAll(vs);
      }
    }
    if (productos.any((p) => p.recursoProbador != null) && recursos == null) {
      throw ContratoInvalido(
        'Falta el almacenamiento de texturas. Se conserva el catálogo anterior.',
      );
    }
    await recursos?.preparar(productos);
    final fecha = _reloj();
    await _almacen.reemplazarCatalogo(productos, variantes, fecha);
    try {
      final modelo = ModeloTallas.validar(await _fuente.modeloTallas());
      await _almacen.guardarModeloTallas(modelo.json);
    } on Object {
      // Sin modelo nuevo (IA apagada o modelo inválido) se conserva el guardado: el catálogo no depende de IA.
    }
    return fecha;
  }
}

class Carrito {
  Carrito(this._almacen);
  final AlmacenLocal _almacen;

  Future<List<LineaCarrito>> lineas() => _almacen.carrito();

  Future<void> agregar(
    Producto producto,
    Variante variante, [
    int cantidad = 1,
  ]) async {
    final actual = (await _almacen.carrito()).where(
      (l) => l.identificadorVariante == variante.identificador,
    );
    final nueva = (actual.isEmpty ? 0 : actual.first.cantidad) + cantidad;
    validarCantidad(nueva);
    if (actual.isEmpty &&
        (await _almacen.carrito()).length >= lineasMaximasPorPedido) {
      throw ArgumentError(
        'Un pedido admite hasta $lineasMaximasPorPedido variantes.',
      );
    }
    await _almacen.guardarLinea(
      LineaCarrito(
        identificadorVariante: variante.identificador,
        identificadorProducto: producto.identificador,
        sku: variante.sku,
        nombre: producto.nombre,
        talla: variante.talla,
        color: variante.color,
        precioCentavos: producto.precioCentavos,
        cantidad: nueva,
      ),
    );
  }

  Future<void> cambiar(LineaCarrito linea, int cantidad) async {
    if (cantidad <= 0) return _almacen.quitarLinea(linea.identificadorVariante);
    validarCantidad(cantidad);
    await _almacen.guardarLinea(linea.conCantidad(cantidad));
  }
}

class SinSesion implements Exception {
  @override
  String toString() => 'Inicia sesión para confirmar tu pedido.';
}

/// Confirmar no es comprar: deja el pedido en la cola del dispositivo (con o sin red) y la sincronización lo envía.
class ConfirmarPedido {
  ConfirmarPedido(this._almacen, this._sesion, [Reloj? reloj])
    : _reloj = reloj ?? DateTime.now;
  final AlmacenLocal _almacen;
  final Sesion _sesion;
  final Reloj _reloj;
  Future<Operacion>? _enCurso;

  Future<Operacion> ejecutar() =>
      _enCurso ??= _ejecutar().whenComplete(() => _enCurso = null);

  Future<Operacion> _ejecutar() async {
    final titular = await _sesion.titular();
    if (titular == null) throw SinSesion();
    final operacion = Operacion.pedido(
      await _almacen.carrito(),
      titular.sub,
      _reloj(),
    );
    await _almacen.encolarPedido(operacion);
    return operacion;
  }
}

/// Envía la cola única del dispositivo: pedidos a Ventas y, con rol admin, operaciones de administración a su procesador.
/// Un envío a la vez y en orden de creación; cada reintento repite UUID, clave y cuerpo, así nunca se duplica un pedido,
/// una reserva ni un movimiento de stock (el servidor devuelve el resultado original para la misma clave).
class SincronizarPedidos {
  SincronizarPedidos(
    this._almacen,
    this._ventas,
    this._sesion, [
    Reloj? reloj,
    this._procesadores = const {},
  ]) : _reloj = reloj ?? DateTime.now;
  final AlmacenLocal _almacen;
  final FuenteVentas _ventas;
  final Sesion _sesion;
  final Reloj _reloj;
  final Map<String, ProcesadorOperacion> _procesadores;
  Future<int>? _enCurso;
  Future<void>? _historialEnCurso;

  Future<void> actualizarHistorial() => _historialEnCurso ??=
      _descargarHistorial().whenComplete(() => _historialEnCurso = null);

  Future<void> _descargarHistorial() async {
    final titular = (await _sesion.titular())?.sub;
    if (titular == null) return;
    final token = await _tokenDelTitular(titular);
    if (token == null) throw SinSesion();
    final pedidos = await _ventas.historial(token);
    if (pedidos.any((p) => p.json['identificador_cliente'] != titular)) {
      throw ContratoInvalido('El historial no pertenece a esta cuenta.');
    }
    if ((await _sesion.titular())?.sub != titular) return;
    await _almacen.guardarHistorial(
      titular,
      HistorialPedidos(pedidos, _reloj()),
    );
  }

  /// Envía las operaciones vencidas; devuelve cuántas quedaron confirmadas en este ciclo.
  Future<int> ejecutar({bool forzar = false}) =>
      _enCurso ??= _ciclo(forzar).whenComplete(() => _enCurso = null);

  Future<int> _ciclo(bool forzar) async {
    var confirmadas = 0;
    // La más antigua primero: una operación sobre una variante depende de la anterior sobre la misma.
    for (final op in (await _almacen.operaciones()).reversed) {
      if (op.estado != EstadoOperacion.pendiente || op.reemplazadaPor != null)
        continue;
      if (!forzar && op.proximoIntento.isAfter(_reloj())) continue;
      // En un teléfono compartido, la operación de A nunca se envía con la sesión de B: espera a que A vuelva.
      final token = await _tokenDelTitular(op.titular);
      if (token == null) continue;
      if (op.esPedido) {
        if ((await _enviar(op, token)).estado == EstadoOperacion.confirmada) {
          confirmadas++;
        }
        continue;
      }
      final procesador = _procesadores[op.tipo];
      // Sin rol admin una operación administrativa espera (el servidor también lo exige); las del propio titular
      // (p. ej. sus preferencias de avisos) no requieren rol.
      if (procesador == null ||
          (tiposAdministracion.contains(op.tipo) &&
              !((await _sesion.titular())?.roles.contains('admin') ?? false)))
        continue;
      final cola = await _almacen.operaciones();
      switch (op.tipo == guardarPreferenciasAvisos
          ? resolverPreferencias(op, cola)
          : resolverVersion(op, cola)) {
        case Esperar():
          continue;
        case Bloqueada(:final motivo):
          await _almacen.guardarOperacion(
            op.copiar(estado: EstadoOperacion.requiereRevision, error: motivo),
          );
        case Lista(operacion: final lista):
          // La versión resuelta se guarda antes del primer envío y se conserva en cada reintento.
          if (!identical(lista, op)) await _almacen.guardarOperacion(lista);
          await _enviarAdministracion(lista, token, procesador);
      }
    }
    return confirmadas;
  }

  Future<void> _enviarAdministracion(
    Operacion op,
    String token,
    ProcesadorOperacion procesador,
  ) async {
    await _almacen.guardarOperacion(
      op.copiar(estado: EstadoOperacion.enviando),
    );
    Operacion siguiente;
    try {
      siguiente = trasEnvio(
        op,
        _reloj(),
        respuesta: await procesador.enviar(op, token),
      );
    } on Object catch (error) {
      siguiente = trasEnvio(op, _reloj(), error: error);
    }
    await _almacen.guardarOperacion(siguiente);
  }

  Future<String?> _tokenDelTitular(String titular) async {
    if ((await _sesion.titular())?.sub != titular) return null;
    final token = await _sesion.tokenVigente();
    // La renovación abre una espera: durante ella se puede cerrar sesión o cambiar de cuenta.
    if ((await _sesion.titular())?.sub != titular) return null;
    return token;
  }

  Future<Operacion> _enviar(Operacion op, String token) async {
    await _almacen.guardarOperacion(
      op.copiar(estado: EstadoOperacion.enviando),
    );
    Operacion siguiente;
    try {
      siguiente = trasEnvio(
        op,
        _reloj(),
        pedido: await _ventas.confirmar(op, token),
      );
    } on Object catch (error) {
      siguiente = trasEnvio(op, _reloj(), error: error);
    }
    await _almacen.guardarOperacion(siguiente);
    return siguiente;
  }

  /// Demostración de idempotencia: reenvía una operación ya confirmada con su misma clave; Ventas devuelve el mismo pedido.
  /// Si falla, la operación queda como estaba.
  Future<PedidoVenta> reenviar(Operacion op) async {
    final token = await _tokenDelTitular(op.titular);
    if (token == null) throw SinSesion();
    final pedido = await _ventas.confirmar(op, token);
    await _almacen.guardarOperacion(trasEnvio(op, _reloj(), pedido: pedido));
    return pedido;
  }

  /// Refresca el estado de los pedidos ya entregados que aún pueden cambiar (SAGA en curso o comprobante pendiente).
  Future<void> actualizarEstados() async {
    for (final op in await _almacen.operaciones()) {
      final pedido = op.resultado;
      if (op.estado != EstadoOperacion.confirmada || pedido == null) continue;
      if (pedido.estado == EstadoPedido.cancelado ||
          (pedido.definitivo && pedido.comprobanteDisponible))
        continue;
      final token = await _tokenDelTitular(op.titular);
      if (token == null) continue;
      try {
        await _almacen.guardarOperacion(
          op.copiar(
            resultado: await _ventas.consultar(op.identificador, token),
          ),
        );
      } on Object {
        // Sin red se muestra el último estado conocido.
      }
    }
  }
}

class RecomendarTalla {
  RecomendarTalla(this._almacen);
  final AlmacenLocal _almacen;

  /// Modelo guardado en el dispositivo, o null si nunca hubo red (entonces solo se ofrece la tabla de referencia).
  Future<ModeloTallas?> modelo() async {
    final json = await _almacen.modeloTallas();
    if (json == null) return null;
    try {
      return ModeloTallas.validar(json);
    } on ModeloTallasInvalido {
      return null;
    }
  }
}

class ResultadoPrueba {
  const ResultadoPrueba(this.pose, this.imagen, this.ajuste);
  final Pose pose;

  /// Imagen ya orientada sobre la que se midió la pose (para dibujarla con las mismas coordenadas).
  final Uint8List imagen;
  final Ajuste ajuste;
}

/// Probador: la pose se estima en el teléfono y la prenda se ajusta en 2D. Este caso de uso no tiene ningún puerto de red.
class ProbarPrenda {
  ProbarPrenda(this._detector);
  final DetectorPose _detector;

  String get modelo => _detector.modelo;

  Future<ResultadoPrueba> ejecutar(
    Uint8List imagen,
    String categoria, [
    RecursoProbador? recurso,
  ]) async {
    final (pose, orientada) = await _detector.detectar(imagen);
    return ResultadoPrueba(
      pose,
      orientada,
      calcularAjuste(
        pose.puntos,
        tipoDePrenda(categoria),
        recurso?.ancho.toDouble() ?? anchoIlustracion,
        recurso?.alto.toDouble() ?? altoIlustracion,
        recurso?.anclas,
      ),
    );
  }
}
