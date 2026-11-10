import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../dominio/contratos.dart';
import 'rest.dart';

/// SSO con Keycloak (realm `clb`, cliente público `clb-android`, Code + PKCE S256 por AppAuth): la misma cuenta que la web.
/// Los tokens se guardan cifrados con el Keystore de Android. Sin red nunca se inicia sesión; una sesión ya validada
/// permite seguir usando el catálogo y encolar pedidos, que se envían cuando el token se renueva.
class SesionKeycloak implements Sesion {
  SesionKeycloak({
    FlutterAppAuth? appAuth,
    FlutterSecureStorage? almacen,
    DateTime Function()? reloj,
  }) : _appAuth = appAuth ?? const FlutterAppAuth(),
       _almacen = almacen ?? const FlutterSecureStorage(),
       _reloj = reloj ?? DateTime.now;

  static const cliente = 'clb-android';
  static const redireccion = 'bo.clb.store:/oauth2redirect';
  static const emisor = String.fromEnvironment(
    'CLB_IDENTIDAD_EMISOR',
    defaultValue: '$pasarela/identidad/realms/clb',
  );
  // HTTP solo hacia la laptop local (adb reverse); en cloud la pasarela es HTTPS y esto queda en false.
  static final _inseguro = emisor.startsWith('http://');

  final FlutterAppAuth _appAuth;
  final FlutterSecureStorage _almacen;
  final DateTime Function() _reloj;
  Future<String?>? _renovando;
  int _generacion = 0;
  int? _generacionRenovando;
  Future<void> _mutaciones = Future.value();

  // Las tres claves se escriben o borran como una unidad lógica frente a otras operaciones de sesión.
  Future<T> _cambiar<T>(Future<T> Function() accion) {
    final resultado = _mutaciones.then((_) => accion());
    _mutaciones = resultado.then<void>(
      (_) {},
      onError: (Object error, StackTrace pila) {},
    );
    return resultado;
  }

  @override
  Future<Titular?> titular() async {
    final generacion = _generacion;
    await _mutaciones;
    final acceso = await _almacen.read(key: 'acceso');
    return acceso == null || generacion != _generacion
        ? null
        : titularDesdeToken(acceso);
  }

  @override
  Future<String?> tokenVigente() async {
    final generacion = _generacion;
    await _mutaciones;
    final acceso = await _almacen.read(key: 'acceso');
    if (acceso == null || generacion != _generacion) return null;
    // Margen de 30 s, como la web: un token que vence en tránsito daría 401.
    if (vencimientoDe(
      acceso,
    ).isAfter(_reloj().add(const Duration(seconds: 30))))
      return acceso;
    if (_renovando == null || _generacionRenovando != generacion) {
      _generacionRenovando = generacion;
      _renovando = _renovar(generacion).whenComplete(() {
        if (_generacionRenovando == generacion) _renovando = null;
      });
    }
    return _renovando;
  }

  Future<String?> _renovar(int generacion) async {
    final renovacion = await _almacen.read(key: 'renovacion');
    if (renovacion == null || generacion != _generacion) return null;
    try {
      final r = await _appAuth.token(
        TokenRequest(
          cliente,
          redireccion,
          refreshToken: renovacion,
          issuer: emisor,
          allowInsecureConnections: _inseguro,
        ),
      );
      return await _cambiar(() async {
        if (generacion != _generacion) return null;
        await _guardar(r.accessToken, r.refreshToken ?? renovacion, r.idToken);
        return generacion == _generacion ? r.accessToken : null;
      });
    } on FlutterAppAuthPlatformException catch (e) {
      // Keycloak rechazó la renovación (sesión vencida o cerrada en otro lado): hay que volver a iniciar sesión.
      // Cualquier otro error es de red: se conserva la sesión y el pedido espera.
      if (e.platformErrorDetails.error ==
          FlutterAppAuthOAuthError.invalidGrant) {
        await _cambiar(() async {
          if (generacion == _generacion) await _borrar();
        });
      }
      return null;
    }
  }

  @override
  Future<Titular> iniciar() async {
    final generacion = ++_generacion;
    // Tras un cierre sin red la cookie de Keycloak puede seguir viva: se pide la contraseña igual.
    final forzar = await _almacen.read(key: 'pedir_clave') == 'si';
    final r = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        cliente,
        redireccion,
        issuer: emisor,
        scopes: const ['openid', 'profile', 'email'],
        promptValues: forzar ? const [Prompt.login] : null,
        allowInsecureConnections: _inseguro,
      ),
    );
    return _cambiar(() async {
      if (generacion != _generacion)
        throw StateError(
          'La sesión cambió durante el inicio. Inténtalo de nuevo.',
        );
      await _guardar(r.accessToken, r.refreshToken, r.idToken);
      await _almacen.delete(key: 'pedir_clave');
      if (generacion != _generacion)
        throw StateError('La sesión se cerró durante el inicio.');
      return titularDesdeToken(r.accessToken!);
    });
  }

  @override
  Future<void> cerrar() async {
    final generacion = ++_generacion;
    final idToken = await _cambiar(() async {
      if (generacion != _generacion) return null;
      final id = await _almacen.read(key: 'id');
      await _borrar();
      return id;
    });
    if (generacion != _generacion) return;
    try {
      // Endpoints explícitos, sin descubrimiento: AppAuth descarga la configuración del `issuer` con un conector que exige
      // HTTPS e ignora allowInsecureConnections, y su excepción en un hilo nativo cerraba la app (pasarela HTTP local).
      await _appAuth.endSession(
        EndSessionRequest(
          idTokenHint: idToken,
          postLogoutRedirectUrl: redireccion,
          serviceConfiguration: const AuthorizationServiceConfiguration(
            authorizationEndpoint: '$emisor/protocol/openid-connect/auth',
            tokenEndpoint: '$emisor/protocol/openid-connect/token',
            endSessionEndpoint: '$emisor/protocol/openid-connect/logout',
          ),
          allowInsecureConnections: _inseguro,
        ),
      );
    } on Object {
      await _cambiar(() async {
        if (generacion == _generacion)
          await _almacen.write(key: 'pedir_clave', value: 'si');
      });
    }
  }

  Future<void> _guardar(String? acceso, String? renovacion, String? id) async {
    if (acceso == null)
      throw StateError('Keycloak no devolvió un token de acceso.');
    await _almacen.write(key: 'acceso', value: acceso);
    await _almacen.write(key: 'renovacion', value: renovacion);
    await _almacen.write(key: 'id', value: id);
  }

  Future<void> _borrar() async {
    for (final clave in ['acceso', 'renovacion', 'id']) {
      await _almacen.delete(key: clave);
    }
  }
}

Map<String, dynamic> _carga(String jwt) {
  final partes = jwt.split('.');
  if (partes.length != 3) throw const FormatException('Token mal formado.');
  return jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(partes[1]))),
      )
      as Map<String, dynamic>;
}

/// Lectura de los claims para mostrar quién es y ligar el pedido a su `sub`. La firma la validan los servicios.
Titular titularDesdeToken(String jwt) {
  final c = _carga(jwt);
  final roles = (c['realm_access'] as Map?)?['roles'];
  return Titular(
    sub: c['sub'] as String,
    usuario: (c['preferred_username'] ?? '') as String,
    nombre: (c['name'] ?? c['preferred_username'] ?? '') as String,
    roles: roles is List ? roles.cast<String>().toSet() : const {},
  );
}

DateTime vencimientoDe(String jwt) => DateTime.fromMillisecondsSinceEpoch(
  ((_carga(jwt)['exp'] as num) * 1000).toInt(),
  isUtc: true,
);
