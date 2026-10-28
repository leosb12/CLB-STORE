import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../dominio/contratos.dart';
import 'comunes.dart';
import 'tema.dart';

/// Resultado de talla que emite `<clb-probador>` (contrato v1, `ResultadoProbador`), en lo que la app usa.
class TallaSugerida {
  const TallaSugerida({
    required this.prenda,
    required this.talla,
    required this.disponible,
    this.exactitud,
  });
  final String prenda;
  final String talla;
  final bool? disponible;

  /// Exactitud del modelo de tallas en su prueba (0–1): la única métrica validada; no es la confianza de esta talla.
  final double? exactitud;

  static TallaSugerida? desdeJson(Map<String, dynamic> j) {
    final talla = j['talla'];
    final prenda = (j['prenda'] as Map?)?['identificador'];
    if (j['contrato'] != 1 || talla is! String || prenda is! String) {
      return null;
    }
    final exactitud = ((j['modelos'] as Map?)?['tallas'] as Map?)?['exactitud'];
    return TallaSugerida(
      prenda: prenda,
      talla: talla,
      disponible: j['tallaDisponible'] as bool?,
      exactitud: exactitud is num && exactitud >= 0 && exactitud <= 1
          ? exactitud.toDouble()
          : null,
    );
  }
}

/// Realidad aumentada 3D: el microfrontend React del probador (el mismo de la web) en una WebView servida desde el
/// teléfono. La app solo aporta los estados de carga y error y recibe la talla; la cámara y la pose quedan en la WebView.
class VistaRA extends StatefulWidget {
  const VistaRA({
    super.key,
    required this.anfitrion,
    required this.prenda,
    required this.catalogo,
    required this.alTalla,
    required this.alRendimiento,
    required this.usarVistaRapida,
  });
  final AnfitrionProbadorRA anfitrion;
  final Map<String, dynamic> prenda;
  final List<Map<String, dynamic>> catalogo;
  final ValueChanged<TallaSugerida> alTalla;
  final ValueChanged<double> alRendimiento;

  /// null si la prenda no admite la vista rápida.
  final VoidCallback? usarVistaRapida;

  @override
  State<VistaRA> createState() => _VistaRAState();
}

enum _Fase { preparando, lista, sinMotor, error, camaraBloqueada }

class _VistaRAState extends State<VistaRA> {
  WebViewController? _web;
  _Fase _fase = _Fase.preparando;
  late final AppLifecycleListener _ciclo;
  String _origen = '';

  @override
  void initState() {
    super.initState();
    // En segundo plano se desmonta el probador: apaga la cámara y detiene el análisis de pose.
    _ciclo = AppLifecycleListener(
      onHide: () => _ejecutar('window.clbPausar?.()'),
      onShow: () => _ejecutar('window.clbReanudar?.()'),
    );
    _abrir();
  }

  Future<void> _abrir() async {
    setState(() => _fase = _Fase.preparando);
    try {
      final url = await widget.anfitrion.iniciar();
      _origen = url.origin;
      final web = WebViewController.fromPlatformCreationParams(
        const PlatformWebViewControllerCreationParams(),
        onPermissionRequest: _permiso,
      );
      if (web.platform case final AndroidWebViewController android) {
        await AndroidWebViewController.enableDebugging(kDebugMode);
        await android.setMediaPlaybackRequiresUserGesture(false);
      }
      await web.setJavaScriptMode(JavaScriptMode.unrestricted);
      await web.setBackgroundColor(Clb.crema);
      await web.addJavaScriptChannel(
        'ClbProbador',
        onMessageReceived: (m) => _mensaje(m.message),
      );
      await web.setNavigationDelegate(
        NavigationDelegate(
          // Solo la página del probador servida por la app: ningún enlace abre la web externa dentro de la WebView.
          onNavigationRequest: (r) => Uri.tryParse(r.url)?.origin == _origen
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
          onWebResourceError: (e) {
            if (e.isForMainFrame ?? true) _cambiar(_Fase.error);
          },
        ),
      );
      await web.loadRequest(url);
      if (mounted) setState(() => _web = web);
    } catch (_) {
      _cambiar(_Fase.error);
    }
  }

  void _cambiar(_Fase fase) {
    if (mounted) setState(() => _fase = fase);
  }

  Future<void> _ejecutar(String js) async {
    try {
      await _web?.runJavaScript(js);
    } catch (_) {
      // La página pudo no estar cargada todavía: no hay cámara que apagar.
    }
  }

  void _mensaje(String texto) {
    final Map<String, dynamic> m;
    try {
      m = jsonDecode(texto) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (m['tipo']) {
      case 'listo':
        if (m['webgl'] != true) return _cambiar(_Fase.sinMotor);
        _ejecutar(
          'window.clbAbrir(${jsonEncode({
            'prenda': widget.prenda,
            'catalogo': widget.catalogo,
            'modos': ['ra'],
          })})',
        );
        _cambiar(_Fase.lista);
      case 'resultado':
        final talla = TallaSugerida.desdeJson(
          Map<String, dynamic>.from(m['detalle'] as Map? ?? const {}),
        );
        if (talla != null) widget.alTalla(talla);
      case 'rendimiento':
        final valor = (m['detalle'] as Map?)?['imagenesPorSegundo'];
        if (valor is num && valor > 0) widget.alRendimiento(valor.toDouble());
    }
  }

  /// La página pide la cámara al pulsar «Usar cámara»: se pide el permiso de Android y solo se concede la cámara.
  Future<void> _permiso(WebViewPermissionRequest solicitud) async {
    if (!solicitud.types.every(
      (t) => t == WebViewPermissionResourceType.camera,
    )) {
      return solicitud.deny();
    }
    final estado = await Permission.camera.request();
    if (estado.isGranted) return solicitud.grant();
    await solicitud.deny();
    if (estado.isPermanentlyDenied) _cambiar(_Fase.camaraBloqueada);
  }

  @override
  void dispose() {
    _ciclo.dispose();
    // Salir o cambiar de modo desmonta el probador antes de destruir la WebView: la cámara se apaga en ese momento.
    _ejecutar('window.clbPausar?.()');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vistaRapida = widget.usarVistaRapida == null
        ? null
        : FilledButton(
            onPressed: widget.usarVistaRapida,
            child: const Text('Usar vista rápida'),
          );
    return switch (_fase) {
      _Fase.sinMotor => Aviso(
        icono: Icons.view_in_ar_outlined,
        titulo: 'Este teléfono no puede mostrar la RA 3D',
        texto:
            'Su navegador integrado no tiene WebGL. La vista rápida funciona en este teléfono, también sin conexión.',
        accion: vistaRapida,
      ),
      _Fase.error => Aviso(
        icono: Icons.error_outline,
        titulo: 'No se pudo abrir la realidad aumentada',
        texto:
            'El probador 3D no cargó en este teléfono. Puedes reintentarlo o usar la vista rápida.',
        accion: Wrap(
          spacing: 12,
          runSpacing: 12,
          alignment: WrapAlignment.center,
          children: [
            ?vistaRapida,
            OutlinedButton(onPressed: _abrir, child: const Text('Reintentar')),
          ],
        ),
      ),
      _ => Stack(
        children: [
          if (_web != null)
            Positioned.fill(child: WebViewWidget(controller: _web!)),
          if (_fase == _Fase.preparando)
            const Positioned.fill(
              child: ColoredBox(
                color: Clb.crema,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(width: 160, child: LinearProgressIndicator()),
                    SizedBox(height: 16),
                    Text('Preparando el probador en este teléfono…'),
                  ],
                ),
              ),
            ),
          // Encima de la WebView, que sigue montada: al volver, el probador continúa donde estaba.
          if (_fase == _Fase.camaraBloqueada)
            Positioned.fill(
              child: ColoredBox(
                color: Clb.crema,
                child: Aviso(
                  icono: Icons.no_photography_outlined,
                  titulo: 'La cámara está bloqueada para CLB Store',
                  texto:
                      'Actívala en los ajustes del teléfono para probarte en vivo. También puedes elegir una foto dentro del probador.',
                  accion: Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment: WrapAlignment.center,
                    children: [
                      FilledButton(
                        onPressed: openAppSettings,
                        child: const Text('Abrir ajustes'),
                      ),
                      OutlinedButton(
                        onPressed: () => _cambiar(_Fase.lista),
                        child: const Text('Volver al probador'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    };
  }
}
