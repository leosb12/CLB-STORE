import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../dominio/avisos.dart';
import '../dominio/contratos.dart';

/// Mensajes con la app en segundo plano o cerrada: los muestra el sistema. Función de nivel superior exigida por FCM.
@pragma('vm:entry-point')
Future<void> manejadorSegundoPlanoFCM(RemoteMessage mensaje) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Sin configuración de Firebase no hay nada que procesar.
  }
}

/// Adaptador de Firebase Cloud Messaging. Nunca bloquea el arranque ni el uso offline: [iniciar] se lanza sin esperar,
/// y si Firebase no está configurado (sin `google-services.json`), sin Play Services o sin red, la app sigue sin push.
/// No se toca `FirebaseMessaging` hasta que [listo] confirma que Firebase quedó inicializado. El token no se registra
/// en logs. El permiso de notificaciones se pide en contexto (al activar Push), no al abrir la app.
class ServicioNotificaciones implements AvisosDispositivo {
  ServicioNotificaciones({
    Future<void> Function()? inicializarFirebase,
    this.limite = const Duration(seconds: 10),
  }) : _inicializarFirebase = inicializarFirebase ?? _firebasePorDefecto;

  static final ServicioNotificaciones instancia = ServicioNotificaciones();

  static Future<void> _firebasePorDefecto() async {
    await Firebase.initializeApp();
  }

  final Future<void> Function() _inicializarFirebase;
  final Duration limite;
  final _listo = Completer<bool>();
  final _mensajes = StreamController<RemoteMessage>.broadcast();
  final _abiertas = StreamController<RemoteMessage>.broadcast();
  final _renovaciones = StreamController<String>.broadcast();
  bool _iniciado = false;
  bool _disponible = false;
  String? _token;

  /// Notificación que abrió la app en frío: llega antes de que el estado se suscriba (abre SQLite primero) y un stream
  /// broadcast la descartaría. Se guarda y se entrega una sola vez al primero que escuche [tocados].
  RemoteMessage? _inicialPendiente;

  /// Se completa una sola vez: `true` si Firebase quedó listo, `false` si no está disponible en esta instalación.
  @override
  Future<bool> get listo => _listo.future;
  bool get disponible => _disponible;

  /// Mensajes recibidos con la app en primer plano.
  Stream<RemoteMessage> get alRecibirMensaje => _mensajes.stream;

  /// Notificaciones tocadas por el usuario (app en segundo plano o cerrada).
  Stream<RemoteMessage> get alAbrirNotificacion => _abiertas.stream;

  /// Inicializa Firebase en segundo plano. Idempotente; los errores se capturan y dejan el servicio no disponible.
  Future<bool> iniciar() {
    if (_iniciado) return listo;
    _iniciado = true;
    unawaited(_iniciar());
    return listo;
  }

  Future<void> _iniciar() async {
    try {
      await _inicializarFirebase().timeout(limite);
      FirebaseMessaging.onBackgroundMessage(manejadorSegundoPlanoFCM);
      final mensajeria = FirebaseMessaging.instance;
      // ponytail: token FCM clásico (deprecado en firebase_messaging 17, no retirado) porque el envío HTTP v1 usa
      // `message.token`; migrar a register()/onRegistered (FID) cuando F3 verifique el envío directo por FID.
      // ignore: deprecated_member_use
      mensajeria.onTokenRefresh.listen((t) {
        _token = t;
        _renovaciones.add(t);
      }, onError: (_) {});
      FirebaseMessaging.onMessage.listen(_mensajes.add, onError: (_) {});
      FirebaseMessaging.onMessageOpenedApp.listen(
        _abiertas.add,
        onError: (_) {},
      );
      final inicial = await mensajeria.getInitialMessage().timeout(
        limite,
        onTimeout: () => null,
      );
      if (inicial != null) {
        if (_abiertas.hasListener) {
          _abiertas.add(inicial);
        } else {
          _inicialPendiente = inicial;
        }
      }
      _disponible = true;
    } catch (e) {
      // Sin datos sensibles: solo el tipo de fallo.
      debugPrint(
        'Notificaciones push no disponibles (${e.runtimeType}); la app sigue sin push.',
      );
      _disponible = false;
    }
    if (!_listo.isCompleted) _listo.complete(_disponible);
  }

  static AvisoPedido _aviso(RemoteMessage m) => AvisoPedido(
    titulo: m.notification?.title ?? 'CLB Store',
    cuerpo: m.notification?.body ?? '',
    datos: {for (final e in m.data.entries) e.key: '${e.value}'},
  );

  @override
  Stream<AvisoPedido> get recibidos => _mensajes.stream.map(_aviso);
  @override
  Stream<AvisoPedido> get tocados async* {
    final inicial = _inicialPendiente;
    _inicialPendiente = null;
    if (inicial != null) yield _aviso(inicial);
    yield* _abiertas.stream.map(_aviso);
  }
  @override
  Stream<String> get renovaciones => _renovaciones.stream;

  @override
  Future<String?> token() => obtenerToken();

  static PermisoAvisos _permiso(AuthorizationStatus estado) => switch (estado) {
    AuthorizationStatus.authorized ||
    AuthorizationStatus.provisional => PermisoAvisos.concedido,
    AuthorizationStatus.denied ||
    AuthorizationStatus.deniedPermanently => PermisoAvisos.denegado,
    AuthorizationStatus.notDetermined => PermisoAvisos.sinDecidir,
  };

  @override
  Future<PermisoAvisos> permiso() async {
    if (!await listo) return PermisoAvisos.noDisponible;
    try {
      return _permiso(
        (await FirebaseMessaging.instance.getNotificationSettings())
            .authorizationStatus,
      );
    } catch (_) {
      return PermisoAvisos.noDisponible;
    }
  }

  @override
  Future<PermisoAvisos> solicitarPermiso() async {
    if (!await listo) return PermisoAvisos.noDisponible;
    try {
      return _permiso(
        (await FirebaseMessaging.instance.requestPermission())
            .authorizationStatus,
      );
    } catch (_) {
      return PermisoAvisos.noDisponible;
    }
  }

  @override
  Future<void> olvidarToken() async {
    if (!await listo) return;
    // ignore: deprecated_member_use
    await FirebaseMessaging.instance.deleteToken().timeout(limite);
    _token = null;
  }

  /// Token FCM actual o `null` si Firebase no está disponible, no hay red o se agotó el tiempo.
  Future<String?> obtenerToken() async {
    if (!await listo) return null;
    if (_token != null) return _token;
    try {
      // ignore: deprecated_member_use
      _token = await FirebaseMessaging.instance.getToken().timeout(limite);
    } catch (e) {
      debugPrint('Token push no disponible (${e.runtimeType}).');
    }
    return _token;
  }

  void disponer() {
    _mensajes.close();
    _abiertas.close();
    _renovaciones.close();
  }
}
