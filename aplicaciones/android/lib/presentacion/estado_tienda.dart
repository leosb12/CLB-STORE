import 'dart:async';

import 'package:flutter/foundation.dart';

import '../dominio/casos_de_uso.dart';
import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import '../dominio/tallas.dart';
import '../dominio/probador_fotografico.dart';
import '../dominio/cola_generaciones.dart';

/// Toma una foto con la cámara del sistema (true) o la galería (false); null si se canceló.
typedef ElegirFoto = Future<Uint8List?> Function(bool camara);

/// Estado de la app para las pantallas. Solo conoce el dominio: los adaptadores llegan inyectados desde `main.dart`.
class EstadoTienda extends ChangeNotifier {
  EstadoTienda({
    required AlmacenLocal almacen,
    required SincronizarCatalogo sincronizarCatalogo,
    required this.carrito,
    required ConfirmarPedido confirmarPedido,
    required SincronizarPedidos sincronizarPedidos,
    required this.tallas,
    required Sesion sesion,
    required Stream<bool> conectividad,
    required this.probador,
    required this.elegirFoto,
    this.recursosPrendas,
    this.crearCompositor,
    this.probadorFotografico,
    this.colaFotografica,
    this.probadorRA,
    this.gestion,
    this.existencias,
    this.ingesta,
  }) : _almacen = almacen,
       _catalogo = sincronizarCatalogo,
       _confirmar = confirmarPedido,
       _pedidos = sincronizarPedidos,
       _sesion = sesion,
       _conectividad = conectividad;

  final AlmacenLocal _almacen;
  final SincronizarCatalogo _catalogo;
  final Carrito carrito;
  final ConfirmarPedido _confirmar;
  final SincronizarPedidos _pedidos;
  final RecomendarTalla tallas;
  final Sesion _sesion;
  final Stream<bool> _conectividad;

  /// El intérprete TFLite se carga la primera vez que se abre el probador.
  final Future<ProbarPrenda> Function() probador;
  final ElegirFoto elegirFoto;
  final FuenteRecursosPrendas? recursosPrendas;
  final CompositorCamiseta Function()? crearCompositor;
  final ProbadorFotografico? probadorFotografico;
  final ColaGeneraciones? colaFotografica;

  /// Microfrontend de realidad aumentada servido dentro de la app; null si no está empaquetado.
  final AnfitrionProbadorRA? probadorRA;

  /// Administración y gestión en el móvil (solo rol admin; el servidor vuelve a validar el JWT).
  final FuenteGestion? gestion;
  final FuenteExistencias? existencias;
  final FuenteIngesta? ingesta;
  bool get esAdmin => titular?.roles.contains('admin') ?? false;

  /// Token vigente de la cuenta admin actual; null sin sesión, sin rol o sin red para renovarlo.
  Future<String?> tokenAdmin() async {
    if (!esAdmin) return null;
    try {
      return await _sesion.tokenVigente();
    } on Object {
      return null;
    }
  }

  int get pendientesAdministracion => operacionesAdministracion
      .where(
        (o) =>
            o.reemplazadaPor == null &&
            (o.estado == EstadoOperacion.pendiente ||
                o.estado == EstadoOperacion.enviando),
      )
      .length;

  /// Un cambio de administración entra a la misma cola que los pedidos y se envía apenas haya conexión.
  Future<void> encolarAdministracion(Operacion op) async {
    await _almacen.encolarOperacion(op);
    await _recargar();
    unawaited(enviarPedidos(forzar: true));
  }

  /// Resultado incierto (red, 5xx): se reintenta ya, con la misma clave, UUID y datos.
  Future<void> reintentar(Operacion op) async {
    await _almacen.guardarOperacion(op.copiar(proximoIntento: DateTime.now()));
    await enviarPedidos(forzar: true);
  }

  /// Conflicto definitivo: una operación nueva reemplaza a la antigua, que conserva el antecedente.
  Future<void> rehacer(Operacion antigua, Operacion nueva) async {
    await _almacen.reemplazarOperacion(antigua, nueva);
    await _recargar();
    unawaited(enviarPedidos(forzar: true));
  }

  List<Operacion> get colaCompleta => [
    ...operaciones,
    ...operacionesAdministracion,
  ];
  Future<String?> preferencia(String clave) => _almacen.preferencia(clave);
  Future<void> guardarPreferencia(String clave, String valor) =>
      _almacen.guardarPreferencia(clave, valor);
  Future<Uint8List?> textura(Producto p) async => p.recursoProbador == null
      ? null
      : await recursosPrendas?.leer(p.recursoProbador!);

  List<Producto> productos = const [];
  List<LineaCarrito> lineas = const [];

  /// Pedidos de la cola (la pestaña Pedidos y su contador solo cuentan estos).
  List<Operacion> operaciones = const [];

  /// Cambios de stock, mínimos y alertas atendidas que esperan en la misma cola.
  List<Operacion> operacionesAdministracion = const [];
  List<PedidoVenta> historial = const [];
  DateTime? fechaHistorial;
  bool historialGuardado = true;
  ModeloTallas? modeloTallas;
  Titular? titular;
  DateTime? fechaCatalogo;
  bool enLinea = true;
  bool sincronizandoCatalogo = false;
  bool enviandoPedidos = false;
  String? errorCatalogo;

  StreamSubscription<bool>? _suscripcion;
  Timer? _reloj;
  int _ticks = 0;
  bool _recuperandoConexion = false;

  int get pendientes => operaciones
      .where(
        (o) =>
            o.estado == EstadoOperacion.pendiente ||
            o.estado == EstadoOperacion.enviando,
      )
      .length;
  int get unidadesEnCarrito => lineas.fold(0, (t, l) => t + l.cantidad);

  Future<void> iniciar() async {
    if (_cerrado) return;
    await _almacen.recuperarEnviando();
    titular = await _sesion.titular();
    await _recargar();
    if (_cerrado) return;
    _suscripcion = _conectividad.listen((_) {
      // Wi-Fi o datos no demuestran acceso a la tienda; USB puede funcionar sin ambos.
      // Solo una petición real confirma disponibilidad, también al cambiar de interfaz.
      unawaited(_alRecuperarRed());
    });
    // Mientras haya pendientes, cada 5 s se revisa la cola (la espera exponencial la decide el dominio).
    _reloj = Timer.periodic(const Duration(seconds: 5), (_) => _tic());
    unawaited(_alRecuperarRed());
  }

  Future<void> _alRecuperarRed({bool forzar = false}) async {
    if (_cerrado || _recuperandoConexion) return;
    _recuperandoConexion = true;
    try {
      unawaited(colaFotografica?.sincronizar(forzar: true));
      await enviarPedidos(forzar: forzar);
      if (_cerrado) return;
      await _refrescarPedidos();
      if (_cerrado) return;
      await actualizarCatalogo();
    } finally {
      _recuperandoConexion = false;
    }
  }

  void _tic() {
    _ticks++;
    unawaited(colaFotografica?.sincronizar());
    if (pendientes > 0 || pendientesAdministracion > 0)
      unawaited(enviarPedidos());
    if (_ticks % 6 == 0) {
      if (enLinea) {
        unawaited(_refrescarPedidos());
      } else {
        // adb reverse puede volver sin emitir un evento de conectividad Android.
        unawaited(_alRecuperarRed());
      }
    }
  }

  /// Al volver la app al primer plano.
  void alVolver() => unawaited(_alRecuperarRed());

  Future<void> _recargar() async {
    final cuenta = titular?.sub;
    productos = await _almacen.productos();
    lineas = await carrito.lineas();
    // En un teléfono compartido cada cuenta ve solo sus pedidos (como la web); sin sesión no se muestra ninguno.
    final propias = [
      for (final o in await _almacen.operaciones())
        if (o.titular == titular?.sub) o,
    ];
    operaciones = [
      for (final o in propias)
        if (o.esPedido) o,
    ];
    operacionesAdministracion = [
      for (final o in propias)
        if (!o.esPedido) o,
    ];
    fechaCatalogo = await _almacen.fechaCatalogo();
    modeloTallas = await tallas.modelo();
    final copia = cuenta == null ? null : await _almacen.historial(cuenta);
    if (cuenta != titular?.sub) return;
    historial = copia?.pedidos ?? const [];
    fechaHistorial = copia?.fecha;
    notifyListeners();
  }

  Future<void> actualizarCatalogo() async {
    if (sincronizandoCatalogo) return;
    sincronizandoCatalogo = true;
    errorCatalogo = null;
    notifyListeners();
    try {
      await _catalogo.ejecutar();
      enLinea = true;
    } on SinConexion {
      enLinea = false;
      errorCatalogo = productos.isEmpty
          ? 'Sin conexión. El catálogo se descargará cuando vuelva la red.'
          : null;
    } on Object catch (e) {
      errorCatalogo = '$e';
    } finally {
      sincronizandoCatalogo = false;
      await _recargar();
    }
  }

  List<Variante> _cacheVariantes = const [];
  String? _cacheProducto;
  Future<List<Variante>> variantes(String identificadorProducto) async {
    if (_cacheProducto != identificadorProducto) {
      _cacheVariantes = await _almacen.variantes(identificadorProducto);
      _cacheProducto = identificadorProducto;
    }
    return _cacheVariantes;
  }

  Future<void> agregar(Producto producto, Variante variante) async {
    await carrito.agregar(producto, variante);
    await _recargar();
  }

  Future<void> cambiarCantidad(LineaCarrito linea, int cantidad) async {
    await carrito.cambiar(linea, cantidad);
    await _recargar();
  }

  /// Deja el pedido en la cola del teléfono e intenta enviarlo enseguida.
  Future<Operacion> confirmar() async {
    final op = await _confirmar.ejecutar();
    await _recargar();
    unawaited(enviarPedidos(forzar: true));
    return op;
  }

  Future<void> enviarPedidos({bool forzar = false}) async {
    if (enviandoPedidos) return;
    enviandoPedidos = true;
    notifyListeners();
    try {
      await _pedidos.ejecutar(forzar: forzar);
    } finally {
      enviandoPedidos = false;
      await _recargar();
    }
  }

  Future<void> _refrescarPedidos() async {
    await _pedidos.actualizarEstados();
    try {
      await _pedidos.actualizarHistorial();
      historialGuardado = false;
    } on Object {
      historialGuardado = true;
    }
    await _recargar();
  }

  Future<void> refrescarPedidos() => _refrescarPedidos();

  Future<PedidoVenta> reenviar(Operacion op) async {
    try {
      return await _pedidos.reenviar(op);
    } finally {
      await _recargar();
    }
  }

  Future<void> iniciarSesion() async {
    titular = await _sesion.iniciar();
    _limpiarPedidos();
    await _recargar();
    unawaited(_alRecuperarRed(forzar: true));
  }

  /// Copias locales de la gestión empresarial: no sobreviven a la sesión (como en la web).
  static const cacheAdministrativa = ['gestion', 'existencias:', 'ingesta:'];

  Future<void> cerrarSesion() async {
    // Teléfono compartido: las fotos corporales, los resultados y los datos del negocio no sobreviven a la sesión.
    await colaFotografica?.borrarDatosLocales();
    await _almacen.borrarPreferencias(cacheAdministrativa);
    await _sesion.cerrar();
    titular = null;
    _limpiarPedidos();
    await _recargar();
  }

  bool _cerrado = false;

  void _limpiarPedidos() {
    operaciones = const [];
    operacionesAdministracion = const [];
    historial = const [];
    fechaHistorial = null;
    historialGuardado = true;
    notifyListeners();
  }

  // Una sincronización en curso puede terminar después de cerrar el estado: entonces ya no avisa a nadie.
  @override
  void notifyListeners() {
    if (!_cerrado) super.notifyListeners();
  }

  @override
  void dispose() {
    _cerrado = true;
    _suscripcion?.cancel();
    _reloj?.cancel();
    super.dispose();
  }
}
