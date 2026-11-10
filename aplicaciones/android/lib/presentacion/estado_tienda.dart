import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../dominio/avisos.dart';
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
    this.avisos,
    this.fuenteAvisos,
    this.instalacion,
    this.crearCompositor,
    this.probadorFotografico,
    this.colaFotografica,
    this.probadorRA,
    this.gestion,
    this.existencias,
    this.ingesta,
    this.avisosLocales,
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

  /// Avisos de pedido (push FCM + preferencias en Clientes); opcionales: sin ellos la app funciona igual.
  final AvisosDispositivo? avisos;
  final FuenteAvisos? fuenteAvisos;
  final IdentidadInstalacion? instalacion;
  final AvisosLocales? avisosLocales;
  Future<Operacion>? _confirmacionEnCurso;
  Future<void>? _envioEnCurso;

  /// Preferencias del titular (copia local por cuenta); `pendientes` mientras un cambio espera en la cola.
  PreferenciasAvisos preferenciasAvisos = PreferenciasAvisos.porDefecto;
  PermisoAvisos permisoAvisos = PermisoAvisos.noDisponible;
  List<Operacion> operacionesPreferencias = const [];
  bool get preferenciasPendientes => operacionesPreferencias.any(
    (o) =>
        o.estado == EstadoOperacion.pendiente ||
        o.estado == EstadoOperacion.enviando,
  );
  Operacion? get preferenciasEnRevision => operacionesPreferencias
      .where(
        (o) =>
            o.estado == EstadoOperacion.requiereRevision &&
            o.reemplazadaPor == null,
      )
      .firstOrNull;

  /// Aviso recibido con la app abierta (se muestra sin interrumpir) y pestaña pedida al tocar una notificación.
  final avisoEnPrimerPlano = ValueNotifier<AvisoPedido?>(null);
  final pestanaSolicitada = ValueNotifier<int?>(null);
  final List<StreamSubscription<Object>> _suscripcionesAvisos = [];
  bool _sincronizandoDispositivo = false;
  bool _sincronizarOtraVez = false;

  /// Token vigente de la cuenta admin actual; null sin sesión, sin rol o sin red para renovarlo.
  /// Token admin o el motivo preciso de su ausencia: [SesionVencida] si la sesión guardada ya no existe (Keycloak
  /// rechazó la renovación) o [SinConexion] si no se pudo renovar por la red.
  Future<String> exigirTokenAdmin() async {
    final token = await tokenAdmin();
    if (token != null) return token;
    if (titular != null && await _sesion.titular() == null)
      throw const SesionVencida();
    throw SinConexion();
  }

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
    _escucharAvisos();
    unawaited(_alRecuperarRed());
  }

  void _escucharAvisos() {
    final avisos = this.avisos;
    if (avisos == null) return;
    _suscripcionesAvisos.addAll([
      avisos.recibidos.listen((a) => avisoEnPrimerPlano.value = a),
      avisos.tocados.listen((a) {
        if (a.abrePedidos) pestanaSolicitada.value = 2;
      }),
      // Token renovado: el vínculo confirmado ya no vale; se vuelve a registrar.
      avisos.renovaciones.listen((_) async {
        await _almacen.borrarPreferencias(['avisos:vinculo_confirmado']);
        await sincronizarDispositivo();
      }),
    ]);
    unawaited(
      avisos.permiso().then((p) {
        permisoAvisos = p;
        if (!_cerrado) notifyListeners();
      }),
    );
  }

  /// Converge el vínculo push del teléfono con la sesión actual: con sesión → registrado para esa cuenta; sin sesión →
  /// desvinculado (con el secreto de la instalación, no hace falta la sesión anterior). Idempotente y en serie; sin red
  /// queda pendiente y se reintenta al reconectar. Un fallo nunca bloquea la sesión ni la tienda.
  /// Una llamada durante otra en curso no se pierde: deja pedida otra pasada, que relee el titular al terminar la actual
  /// (cambio de cuenta o cierre de sesión mientras una petición estaba en vuelo).
  Future<void> sincronizarDispositivo() async {
    final avisos = this.avisos, fuente = fuenteAvisos, identidad = instalacion;
    if (avisos == null || fuente == null || identidad == null) return;
    if (_sincronizandoDispositivo) {
      _sincronizarOtraVez = true;
      return;
    }
    _sincronizandoDispositivo = true;
    try {
      do {
        _sincronizarOtraVez = false;
        await _sincronizarDispositivoUnaVez(avisos, fuente, identidad);
      } while (_sincronizarOtraVez && !_cerrado);
    } finally {
      _sincronizandoDispositivo = false;
    }
  }

  Future<void> _sincronizarDispositivoUnaVez(
    AvisosDispositivo avisos,
    FuenteAvisos fuente,
    IdentidadInstalacion identidad,
  ) async {
    try {
      final deseado = titular?.sub ?? '';
      if (await _almacen.preferencia('avisos:vinculo_confirmado') == deseado)
        return;
      final id = await identidad.obtener();
      if (deseado.isEmpty) {
        await fuente.desvincular(id.id, id.secreto);
        await avisos.olvidarToken();
      } else {
        final tokenPush = await avisos.token();
        final jwt = await _sesion.tokenVigente();
        if (tokenPush == null || jwt == null) return;
        if (titular?.sub != deseado) {
          _sincronizarOtraVez = true;
          return;
        }
        await fuente.vincular(id.id, tokenPush, id.secreto, jwt);
      }
      // Lo confirmado es lo que el servidor tiene ahora; si el titular cambió durante la petición, otra pasada converge.
      await _almacen.guardarPreferencia('avisos:vinculo_confirmado', deseado);
      if ((titular?.sub ?? '') != deseado) _sincronizarOtraVez = true;
    } on Object {
      // Sin red o sin Firebase: queda pendiente; se reintenta al reconectar o al volver a la app.
    }
  }

  /// Pide el permiso del sistema (Android 13+) sin tocar la preferencia: Push viene activado por defecto y la persona
  /// puede concederlo desde Cuenta sin apagar y encender el interruptor. Si quedó bloqueado, la pantalla remite a Ajustes.
  Future<void> solicitarPermisoAvisos() async {
    final avisos = this.avisos;
    if (avisos == null) return;
    permisoAvisos = await avisos.solicitarPermiso();
    notifyListeners();
  }

  /// Relee las preferencias del servidor (si hay red y nada pendiente) y el permiso del sistema.
  Future<void> cargarPreferenciasAvisos() async {
    final cuenta = titular?.sub, fuente = fuenteAvisos;
    if (avisos != null) permisoAvisos = await avisos!.permiso();
    if (cuenta != null && fuente != null && !preferenciasPendientes) {
      try {
        final jwt = await _sesion.tokenVigente();
        if (jwt != null) {
          final remotas = await fuente.preferencias(jwt);
          if (titular?.sub == cuenta) {
            preferenciasAvisos = remotas;
            await _almacen.guardarPreferencia(
              'avisos:$cuenta',
              jsonEncode(remotas.json),
            );
          }
        }
      } on Object {
        // Sin red: se muestra la última copia guardada.
      }
    }
    if (!_cerrado) notifyListeners();
  }

  /// Guarda la elección en el teléfono y la encola (con versión) para Clientes; funciona sin red. Activar Push pide el
  /// permiso del sistema en ese momento: si se deniega, la preferencia se guarda igual y la pantalla lo explica.
  Future<void> cambiarPreferenciasAvisos({
    required bool push,
    required bool correo,
  }) async {
    final cuenta = titular?.sub;
    if (cuenta == null) return;
    if (push &&
        !preferenciasAvisos.push &&
        permisoAvisos != PermisoAvisos.concedido &&
        avisos != null)
      permisoAvisos = await avisos!.solicitarPermiso();
    // El más reciente sin confirmar ni reemplazar (la lista viene de la más nueva a la más antigua).
    final ultima = operacionesPreferencias
        .where(
          (o) =>
              o.reemplazadaPor == null &&
              (o.estado == EstadoOperacion.pendiente ||
                  o.estado == EstadoOperacion.enviando),
        )
        .firstOrNull;
    if (ultima != null &&
        ultima.estado == EstadoOperacion.pendiente &&
        ultima.intentos == 0 &&
        !enviandoPedidos) {
      // Nunca salió: su clave no se usó, así que se edita en el lugar (misma clave, misma versión o antecesor).
      await _almacen.guardarOperacion(
        ultima.copiar(
          datos: {...?ultima.datos, 'push': push, 'correo': correo},
        ),
      );
    } else {
      // Si el anterior ya salió (resultado incierto o en vuelo), su clave y cuerpo no se tocan: este va tras él.
      await _almacen.encolarOperacion(
        operacionPreferencias(
          push: push,
          correo: correo,
          versionEsperada: ultima == null ? preferenciasAvisos.version : null,
          tras: ultima?.identificador,
          titular: cuenta,
          ahora: DateTime.now(),
        ),
      );
    }
    await _recargar();
    unawaited(enviarPedidos());
  }

  /// Conflicto (otro dispositivo cambió antes): «mis cambios» se reenvían sobre la versión vigente; «las del servidor»
  /// descartan el cambio local. En ambos casos el antecedente queda registrado.
  Future<void> resolverPreferencias({required bool usarMias}) async {
    final revision = preferenciasEnRevision, cuenta = titular?.sub;
    if (revision == null || cuenta == null) return;
    await cargarPreferenciasAvisosDelServidor();
    final nueva = operacionPreferencias(
      push: usarMias
          ? revision.datos!['push'] as bool
          : preferenciasAvisos.push,
      correo: usarMias
          ? revision.datos!['correo'] as bool
          : preferenciasAvisos.correo,
      versionEsperada: preferenciasAvisos.version,
      titular: cuenta,
      ahora: DateTime.now(),
    );
    // «Las del servidor» deja el reemplazo confirmado con la versión vigente: un cambio posterior que iba tras el
    // revisado la toma de ahí.
    await _almacen.reemplazarOperacion(
      revision,
      usarMias
          ? nueva
          : nueva.copiar(
              estado: EstadoOperacion.confirmada,
              respuesta: {'preferencias': preferenciasAvisos.json},
            ),
    );
    await _recargar();
    if (usarMias) unawaited(enviarPedidos());
  }

  Future<void> cargarPreferenciasAvisosDelServidor() async {
    final cuenta = titular?.sub, fuente = fuenteAvisos;
    if (cuenta == null || fuente == null) return;
    final jwt = await _sesion.tokenVigente();
    if (jwt == null) throw SinConexion();
    preferenciasAvisos = await fuente.preferencias(jwt);
    await _almacen.guardarPreferencia(
      'avisos:$cuenta',
      jsonEncode(preferenciasAvisos.json),
    );
  }

  Future<void> _alRecuperarRed({bool forzar = false}) async {
    if (_cerrado || _recuperandoConexion) return;
    _recuperandoConexion = true;
    try {
      unawaited(colaFotografica?.sincronizar(forzar: true));
      await enviarPedidos(forzar: forzar);
      if (_cerrado) return;
      unawaited(sincronizarDispositivo());
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
    if (pendientes > 0 ||
        pendientesAdministracion > 0 ||
        preferenciasPendientes)
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
        if (!o.esPedido && o.tipo != guardarPreferenciasAvisos) o,
    ];
    operacionesPreferencias = [
      for (final o in propias)
        if (o.tipo == guardarPreferenciasAvisos) o,
    ];
    if (cuenta != null) {
      final copia = await _almacen.preferencia('avisos:$cuenta');
      preferenciasAvisos = copia == null
          ? PreferenciasAvisos.porDefecto
          : PreferenciasAvisos.desdeJson(jsonDecode(copia));
      // Un cambio ya confirmado trae la versión vigente del servidor: la copia local la adopta si es más nueva.
      for (final o in operacionesPreferencias) {
        final r = o.respuesta?['preferencias'];
        if (o.estado == EstadoOperacion.confirmada && r != null) {
          final confirmadas = PreferenciasAvisos.desdeJson(r);
          if (confirmadas.version > preferenciasAvisos.version) {
            preferenciasAvisos = confirmadas;
            await _almacen.guardarPreferencia(
              'avisos:$cuenta',
              jsonEncode(confirmadas.json),
            );
          }
        }
      }
      // Lo que la persona eligió y aún no llegó al servidor manda en pantalla.
      final pendiente = operacionesPreferencias
          .where(
            (o) =>
                o.estado != EstadoOperacion.confirmada &&
                o.reemplazadaPor == null,
          )
          .firstOrNull;
      if (pendiente != null) {
        preferenciasAvisos = PreferenciasAvisos(
          push: pendiente.datos!['push'] as bool,
          correo: pendiente.datos!['correo'] as bool,
          version: preferenciasAvisos.version,
          correoDisponible: preferenciasAvisos.correoDisponible,
        );
      }
    }
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
    await _avisarLocal(() => avisosLocales?.productoAgregado());
  }

  Future<void> cambiarCantidad(LineaCarrito linea, int cantidad) async {
    await carrito.cambiar(linea, cantidad);
    await _recargar();
  }

  /// Deja el pedido en la cola del teléfono e intenta enviarlo enseguida.
  Future<Operacion> confirmar() => _confirmacionEnCurso ??=
      _confirmarYNotificar().whenComplete(() => _confirmacionEnCurso = null);

  Future<Operacion> _confirmarYNotificar() async {
    final op = await _confirmar.ejecutar();
    await _recargar();
    if (!enLinea) {
      await _avisarLocal(
        () => avisosLocales?.pedidoRegistrado(pendiente: true),
      );
      unawaited(enviarPedidos(forzar: true));
    } else {
      unawaited(_enviarYNotificar(op));
    }
    return op;
  }

  Future<void> _enviarYNotificar(Operacion op) async {
    try {
      await enviarPedidos(forzar: true);
      if (_cerrado || (await _sesion.titular())?.sub != op.titular) return;
      final actual = (await _almacen.operaciones())
          .where((o) => o.identificador == op.identificador)
          .firstOrNull;
      if (actual == null) return;
      if (actual.estado == EstadoOperacion.pendiente ||
          actual.estado == EstadoOperacion.enviando) {
        await _avisarLocal(
          () => avisosLocales?.pedidoRegistrado(pendiente: true),
        );
      } else if (actual.estado == EstadoOperacion.confirmada &&
          actual.resultado != null &&
          actual.resultado!.estado != EstadoPedido.cancelado &&
          actual.resultado!.estado != EstadoPedido.enRevision) {
        await _avisarLocal(
          () => avisosLocales?.pedidoRegistrado(pendiente: false),
        );
      }
    } catch (_) {
      // Un fallo de envío/lectura no es un registro exitoso.
    }
  }

  Future<void> _avisarLocal(Future<void>? Function() emitir) async {
    try {
      await emitir();
    } catch (_) {
      // El permiso denegado o un fallo del sistema no invalidan una operación ya guardada.
    }
  }

  Future<void> enviarPedidos({bool forzar = false}) => _envioEnCurso ??=
      _enviarPedidos(forzar: forzar).whenComplete(() => _envioEnCurso = null);

  Future<void> _enviarPedidos({bool forzar = false}) async {
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
    unawaited(sincronizarDispositivo().then((_) => cargarPreferenciasAvisos()));
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
    // Sin bloquear el cierre: el push deja de llegar a esta cuenta en cuanto haya red (o al iniciar otra sesión).
    unawaited(sincronizarDispositivo());
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
    for (final s in _suscripcionesAvisos) {
      s.cancel();
    }
    avisoEnPrimerPlano.dispose();
    pestanaSolicitada.dispose();
    super.dispose();
  }
}
