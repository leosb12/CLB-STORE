import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'comunes.dart';
import 'estado_gestion.dart';
import 'estado_tienda.dart';
import 'pantalla_carrito.dart';
import 'pantalla_catalogo.dart';
import 'pantalla_cuenta.dart';
import 'pantalla_gestion.dart';
import 'pantalla_pedidos.dart';
import 'tema.dart';

class AppClb extends StatelessWidget {
  const AppClb(this.estado, {super.key});
  final EstadoTienda estado;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'CLB Store',
    debugShowCheckedModeBanner: false,
    theme: temaClb(Brightness.light),
    darkTheme: temaClb(Brightness.dark),
    locale: const Locale('es'),
    supportedLocales: const [Locale('es')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    // La franja de estado queda sobre todas las pantallas, también en el detalle y el probador.
    builder: (context, child) => Column(
      children: [
        ListenableBuilder(
          listenable: estado,
          builder: (_, _) => FranjaEstado(estado),
        ),
        Expanded(
          child: MediaQuery.removePadding(
            context: context,
            removeTop: true,
            child: child!,
          ),
        ),
      ],
    ),
    home: _Inicio(estado),
  );
}

class _Inicio extends StatefulWidget {
  const _Inicio(this.estado);
  final EstadoTienda estado;

  @override
  State<_Inicio> createState() => _InicioState();
}

class _InicioState extends State<_Inicio> with WidgetsBindingObserver {
  int _pestana = 0;
  late final _gestion = EstadoGestion(widget.estado);
  static const _canalNotificacionesNativas =
      MethodChannel('bo.clb.store/notificaciones_nativas');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.estado.avisoEnPrimerPlano.addListener(_mostrarAviso);
    widget.estado.pestanaSolicitada.addListener(_abrirPestana);
    WidgetsBinding.instance.addPostFrameCallback((_) => _abrirPestana());
    _canalNotificacionesNativas.setMethodCallHandler((call) async {
      if (call.method == 'abrirPedidos') {
        _ir(2);
      }
    });
    try {
      _canalNotificacionesNativas
          .invokeMethod<bool>('comprobarInicio')
          .then((abrir) {
            if (abrir == true && mounted) _ir(2);
          })
          .catchError((_) {});
    } catch (_) {}
  }

  /// Aviso con la app abierta: notificación nativa arriba en el sistema y SnackBar abajo en pantalla.
  void _mostrarAviso() {
    final aviso = widget.estado.avisoEnPrimerPlano.value;
    if (aviso == null || !mounted) return;
    _dispararNotificacionNativa(aviso);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(aviso.cuerpo.isEmpty ? aviso.titulo : aviso.cuerpo),
        action: aviso.abrePedidos
            ? SnackBarAction(label: 'Ver', onPressed: () => _ir(2))
            : null,
      ),
    );
  }

  void _dispararNotificacionNativa(dynamic aviso) {
    try {
      _canalNotificacionesNativas.invokeMethod('mostrar', {
        'titulo': '${aviso.titulo}',
        'cuerpo': '${aviso.cuerpo}',
      });
    } catch (_) {
      // Ignorado en plataformas sin soporte nativo o en pruebas.
    }
  }

  /// Notificación tocada (app en segundo plano o cerrada): abre «Pedidos».
  void _abrirPestana() {
    final pestana = widget.estado.pestanaSolicitada.value;
    if (pestana == null || !mounted) return;
    widget.estado.pestanaSolicitada.value = null;
    _ir(pestana);
  }

  @override
  void dispose() {
    widget.estado.avisoEnPrimerPlano.removeListener(_mostrarAviso);
    widget.estado.pestanaSolicitada.removeListener(_abrirPestana);
    WidgetsBinding.instance.removeObserver(this);
    _gestion.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (estado == AppLifecycleState.resumed) widget.estado.alVolver();
  }

  void _ir(int pestana) {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    if (pestana == 4) _gestion.cargar();
    setState(() => _pestana = pestana);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.estado,
    builder: (context, _) {
      final e = widget.estado;
      // La pestaña Gestión existe solo para el rol admin; si se cierra la sesión, se vuelve al catálogo.
      final admin = e.esAdmin && e.gestion != null;
      if (!admin && _pestana == 4) _pestana = 0;
      return Scaffold(
        body: IndexedStack(
          index: _pestana,
          children: [
            PantallaCatalogo(e, irAlCarrito: () => _ir(1)),
            PantallaCarrito(
              e,
              irAPedidos: () => _ir(2),
              irACuenta: () => _ir(3),
            ),
            PantallaPedidos(e),
            PantallaCuenta(e),
            if (admin) PantallaGestion(e, _gestion),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _pestana,
          onDestinationSelected: _ir,
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.checkroom_outlined),
              selectedIcon: Icon(Icons.checkroom),
              label: 'Catálogo',
            ),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: e.unidadesEnCarrito > 0,
                label: Text('${e.unidadesEnCarrito}'),
                child: const Icon(Icons.shopping_bag_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: e.unidadesEnCarrito > 0,
                label: Text('${e.unidadesEnCarrito}'),
                child: const Icon(Icons.shopping_bag),
              ),
              label: 'Carrito',
            ),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: e.pendientes > 0,
                label: Text('${e.pendientes}'),
                backgroundColor: Clb.cobre,
                child: const Icon(Icons.receipt_long_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: e.pendientes > 0,
                label: Text('${e.pendientes}'),
                backgroundColor: Clb.cobre,
                child: const Icon(Icons.receipt_long),
              ),
              label: 'Pedidos',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Cuenta',
            ),
            if (admin)
              NavigationDestination(
                icon: Badge(
                  isLabelVisible: e.pendientesAdministracion > 0,
                  label: Text('${e.pendientesAdministracion}'),
                  backgroundColor: Clb.cobre,
                  child: const Icon(Icons.insights_outlined),
                ),
                selectedIcon: const Icon(Icons.insights),
                label: 'Gestión',
              ),
          ],
        ),
      );
    },
  );
}
