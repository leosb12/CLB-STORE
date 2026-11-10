import 'package:clb_store/datos/notificaciones_locales.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const canal = MethodChannel('dexterous.com/flutter/local_notifications');
  final llamadas = <MethodCall>[];
  var permiso = true;
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    AndroidFlutterLocalNotificationsPlugin.registerWith();
    llamadas.clear();
    permiso = true;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(canal, (metodo) async {
          llamadas.add(metodo);
          return metodo.method == 'requestNotificationsPermission'
              ? permiso
              : true;
        });
  });
  tearDown(
    () {
      debugDefaultTargetPlatformOverride = null;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(canal, null);
    },
  );

  test(
    'inicializa y pide permiso una vez; textos exactos y solo dos ID/tag',
    () async {
      final avisos = NotificacionesLocales();
      await Future.wait([avisos.iniciar(), avisos.iniciar()]);
      await avisos.productoAgregado();
      await avisos.pedidoRegistrado(pendiente: true);
      await avisos.pedidoRegistrado(pendiente: false);
      expect(llamadas.where((m) => m.method == 'initialize').length, 1);
      expect(
        llamadas
            .where((m) => m.method == 'requestNotificationsPermission')
            .length,
        1,
      );
      final mostradas = llamadas
          .where((m) => m.method == 'show')
          .map((m) => m.arguments as Map)
          .toList();
      expect(mostradas.map((m) => m['id']).toList(), [1, 2, 2]);
      expect(mostradas.map((m) => m['title']).toList(), [
        'Producto agregado',
        'Pedido pendiente',
        'Pedido registrado',
      ]);
      expect(mostradas.map((m) => m['body']).toList(), [
        'Tu prenda se agregó correctamente al carrito.',
        'Tu pedido fue guardado y se enviará cuando vuelva la conexión.',
        'Tu pedido fue registrado correctamente.',
      ]);
      expect((mostradas[0]['platformSpecifics'] as Map)['tag'], 'clb_local_1');
      expect((mostradas[1]['platformSpecifics'] as Map)['tag'], 'clb_local_2');
    },
  );

  test(
    'permiso denegado: no muestra notificaciones ni necesita Firebase',
    () async {
      permiso = false;
      final avisos = NotificacionesLocales();
      await avisos.productoAgregado();
      await avisos.pedidoRegistrado(pendiente: true);
      expect(llamadas.where((m) => m.method == 'show'), isEmpty);
    },
  );
}
