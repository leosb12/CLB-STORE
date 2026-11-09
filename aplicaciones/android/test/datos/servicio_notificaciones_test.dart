import 'dart:async';

import 'package:clb_store/datos/servicio_notificaciones.dart';
import 'package:flutter_test/flutter_test.dart';

/// F0: sin Firebase (falta google-services.json, sin Play Services o sin red) la app sigue sin push y nunca toca
/// FirebaseMessaging; un fallo en esos métodos lanzaría MissingPluginException en estas pruebas.
void main() {
  test('sin configuración de Firebase queda no disponible y no consulta el token', () async {
    final servicio = ServicioNotificaciones(inicializarFirebase: () async => throw StateError('sin configuración'));
    expect(await servicio.iniciar(), isFalse);
    expect(servicio.disponible, isFalse);
    expect(await servicio.obtenerToken(), isNull);
  });

  test('una inicialización colgada (sin red) se corta por tiempo y no bloquea', () async {
    final servicio = ServicioNotificaciones(
      inicializarFirebase: () => Completer<void>().future,
      limite: const Duration(milliseconds: 50),
    );
    expect(await servicio.iniciar().timeout(const Duration(seconds: 2)), isFalse);
    expect(await servicio.obtenerToken(), isNull);
  });

  test('iniciar es idempotente: una sola inicialización', () async {
    var llamadas = 0;
    final servicio = ServicioNotificaciones(inicializarFirebase: () async {
      llamadas++;
      throw StateError('sin configuración');
    });
    await Future.wait([servicio.iniciar(), servicio.iniciar()]);
    expect(llamadas, 1);
  });
}
