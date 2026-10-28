import 'dart:async';
import 'dart:convert';

import 'package:clb_store/datos/sesion_keycloak.dart';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

String tokenDe(String sub, int exp) =>
    'e30.${base64Url.encode(utf8.encode(jsonEncode({'sub': sub, 'exp': exp})))}.firma';

class AppAuthEnEspera extends FlutterAppAuth {
  final renovacion = Completer<TokenResponse>();
  final solicitada = Completer<void>();
  int llamadas = 0;
  @override
  Future<TokenResponse> token(TokenRequest request) {
    llamadas++;
    if (!solicitada.isCompleted) solicitada.complete();
    return renovacion.future;
  }

  @override
  Future<EndSessionResponse> endSession(EndSessionRequest request) async => EndSessionResponse(null);

  @override
  Future<AuthorizationTokenResponse> authorizeAndExchangeCode(AuthorizationTokenRequest request) async =>
      AuthorizationTokenResponse(tokenDe('B', 4102444800), 'renovacion-B', null, 'id-B', 'Bearer', null, null, null);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(
    () => FlutterSecureStorage.setMockInitialValues({
      'acceso': tokenDe('A', 1),
      'renovacion': 'renovacion-A',
      'id': 'id-A',
    }),
  );

  test('una renovación tardía no restaura credenciales después de cerrar sesión', () async {
    final auth = AppAuthEnEspera();
    final sesion = SesionKeycloak(appAuth: auth);
    final token = sesion.tokenVigente();
    await auth.solicitada.future;
    await sesion.cerrar();
    auth.renovacion.complete(TokenResponse(tokenDe('A', 4102444800), 'nueva-A', null, 'id-A', 'Bearer', null, null));
    expect(await token, isNull);
    expect(await sesion.titular(), isNull);
    expect(await const FlutterSecureStorage().readAll(), isEmpty);
  });

  test('la respuesta de A no sobrescribe la sesión de B y renovaciones concurrentes se agrupan', () async {
    final auth = AppAuthEnEspera();
    final sesion = SesionKeycloak(appAuth: auth);
    final primero = sesion.tokenVigente();
    await auth.solicitada.future;
    final segundo = sesion.tokenVigente();
    await sesion.cerrar();
    await sesion.iniciar();
    auth.renovacion.complete(TokenResponse(tokenDe('A', 4102444800), 'nueva-A', null, 'id-A', 'Bearer', null, null));
    expect(await primero, isNull);
    expect(await segundo, isNull);
    expect(auth.llamadas, 1);
    expect((await sesion.titular())!.sub, 'B');
    expect(await sesion.tokenVigente(), tokenDe('B', 4102444800));
    expect(await const FlutterSecureStorage().read(key: 'renovacion'), 'renovacion-B');
  });

  test('un invalid_grant tardío de A no borra las credenciales nuevas de B', () async {
    final auth = AppAuthEnEspera();
    final sesion = SesionKeycloak(appAuth: auth);
    final renovacion = sesion.tokenVigente();
    await auth.solicitada.future;
    await sesion.cerrar();
    await sesion.iniciar();
    auth.renovacion.completeError(
      FlutterAppAuthPlatformException(
        code: 'token_error',
        platformErrorDetails: FlutterAppAuthPlatformErrorDetails(error: FlutterAppAuthOAuthError.invalidGrant),
      ),
    );
    expect(await renovacion, isNull);
    expect((await sesion.titular())!.sub, 'B');
    expect(await const FlutterSecureStorage().read(key: 'renovacion'), 'renovacion-B');
  });
}
