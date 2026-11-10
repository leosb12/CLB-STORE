import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../dominio/contratos.dart';

/// Dos avisos inmediatos: no dependen de FCM, red, tareas ni alarmas.
class NotificacionesLocales implements AvisosLocales {
  NotificacionesLocales({FlutterLocalNotificationsPlugin? plugin})
    : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  Future<bool>? _inicio;

  Future<bool> iniciar() => _inicio ??= _inicializar();

  Future<bool> _inicializar() async {
    try {
      final listo = await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('ic_notificacion_local'),
        ),
      );
      if (listo != true) return false;
      final android = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      // Android 13+: permiso del sistema, sin consultar Firebase ni Internet.
      return await android?.requestNotificationsPermission() ?? false;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<void> productoAgregado() => _mostrar(
    1,
    'Producto agregado',
    'Tu prenda se agregó correctamente al carrito.',
  );

  @override
  Future<void> pedidoRegistrado({required bool pendiente}) => _mostrar(
    2,
    pendiente ? 'Pedido pendiente' : 'Pedido registrado',
    pendiente
        ? 'Tu pedido fue guardado y se enviará cuando vuelva la conexión.'
        : 'Tu pedido fue registrado correctamente.',
  );

  Future<void> _mostrar(int id, String titulo, String mensaje) async {
    if (!await iniciar()) return;
    await _plugin.show(
      id: id,
      title: titulo,
      body: mensaje,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          'clb_operaciones_locales',
          'Carrito y pedidos locales',
          channelDescription: 'Resultados de tus acciones en este teléfono',
          importance: Importance.high,
          priority: Priority.high,
          icon: 'ic_notificacion_local',
          // Los mismos dos ID/tag actualizan cada aviso, sin acumular copias.
          tag: 'clb_local_$id',
        ),
      ),
    );
  }
}
