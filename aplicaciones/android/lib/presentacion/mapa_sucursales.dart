import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:url_launcher/url_launcher.dart';

import '../dominio/actividad.dart';
import '../dominio/sucursales.dart';
import 'estado_tienda.dart';
import 'tema.dart';

/// Ubicación actual por GPS, solo en memoria: nunca se guarda ni se envía a CLB Store. Devuelve el punto o el motivo
/// por el que no hay (para mostrarlo y permitir elegir a mano). En el registro queda solo el resultado, sin coordenadas.
Future<(LatLng?, String?)> ubicacionActual(EstadoTienda tienda) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      tienda.registrar(
        CategoriaActividad.ubicacion,
        'Consultar ubicación',
        'GPS apagado en el teléfono.',
        Severidad.warning,
      );
      return (
        null,
        'El GPS está apagado. Actívalo o elige el punto tocando el mapa.',
      );
    }
    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) {
      permiso = await Geolocator.requestPermission();
    }
    if (permiso == LocationPermission.denied ||
        permiso == LocationPermission.deniedForever) {
      tienda.registrar(
        CategoriaActividad.ubicacion,
        'Permiso de ubicación',
        'Permiso denegado; se puede elegir el punto a mano.',
        Severidad.warning,
      );
      return (
        null,
        permiso == LocationPermission.deniedForever
            ? 'La ubicación está bloqueada en Ajustes. Puedes elegir el punto tocando el mapa.'
            : 'Sin permiso de ubicación. Puedes elegir el punto tocando el mapa.',
      );
    }
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
    tienda.registrar(
      CategoriaActividad.ubicacion,
      'Consultar ubicación',
      'Ubicación actual obtenida por GPS (no se guarda).',
      Severidad.success,
    );
    return (LatLng(p.latitude, p.longitude), null);
  } on Object {
    tienda.registrar(
      CategoriaActividad.ubicacion,
      'Consultar ubicación',
      'El GPS no respondió a tiempo.',
      Severidad.warning,
    );
    return (
      null,
      'No se obtuvo la ubicación. Puedes elegir el punto tocando el mapa.',
    );
  }
}

/// Ruta vial en Google Maps u otra app de mapas instalada (la calcula esa app, con internet). Sin `origen`, la app usa
/// la ubicación del teléfono.
Future<void> abrirRuta(
  BuildContext context,
  EstadoTienda tienda,
  LatLng destino, {
  LatLng? origen,
  required String descripcion,
}) async {
  final mensajero = ScaffoldMessenger.of(context);
  String p(LatLng x) => '${x.latitude},${x.longitude}';
  final url = Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': p(destino),
    if (origen != null) 'origin': p(origen),
    'travelmode': 'driving',
  });
  var abierta = false;
  try {
    abierta = await launchUrl(url, mode: LaunchMode.externalApplication);
  } on Object {
    abierta = false;
  }
  tienda.registrar(
    CategoriaActividad.ubicacion,
    'Ver ruta',
    abierta
        ? 'Ruta abierta en la app de mapas: $descripcion.'
        : 'No hay app de mapas para abrir la ruta.',
    abierta ? Severidad.success : Severidad.error,
  );
  if (!abierta) {
    mensajero.showSnackBar(
      const SnackBar(
        content: Text('No hay una app de mapas para abrir la ruta.'),
      ),
    );
  }
}

/// Mapa de Santa Cruz con las sucursales de demostración y, si los hay, el punto propio y el de entrega.
class MapaSucursales extends StatelessWidget {
  const MapaSucursales({
    super.key,
    required this.controlador,
    this.propia,
    this.entrega,
    this.resaltada,
    this.alTocar,
    this.alTocarSucursal,
  });
  final MapController controlador;
  final LatLng? propia, entrega;
  final Sucursal? resaltada;
  final void Function(LatLng punto)? alTocar;
  final void Function(Sucursal s)? alTocarSucursal;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return FlutterMap(
      mapController: controlador,
      options: MapOptions(
        initialCenter: centroSantaCruz,
        initialZoom: 12.5,
        minZoom: 10,
        maxZoom: 18,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
        ),
        onTap: alTocar == null ? null : (_, punto) => alTocar!(punto),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'bo.clb.store',
        ),
        MarkerLayer(
          markers: [
            for (final s in sucursalesDemo)
              Marker(
                point: s.punto,
                width: 96,
                height: 36,
                alignment: Alignment.topCenter,
                child: _Pin(
                  etiqueta: s.nombre.replaceFirst('CLB Store ', ''),
                  icono: Icons.storefront,
                  color: identical(s, resaltada) ? Clb.cobre : Clb.verde,
                  semantica: '${s.nombre}, sucursal de demostración',
                  alTocar: alTocarSucursal == null
                      ? null
                      : () => alTocarSucursal!(s),
                ),
              ),
            if (propia != null)
              Marker(
                point: propia!,
                width: 22,
                height: 22,
                child: Semantics(
                  label: 'Mi ubicación',
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFF2F6FB0),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                    ),
                  ),
                ),
              ),
            if (entrega != null)
              Marker(
                point: entrega!,
                width: 96,
                height: 36,
                alignment: Alignment.topCenter,
                child: _Pin(
                  etiqueta: 'Entrega',
                  icono: Icons.place,
                  color: t.colorScheme.error,
                  semantica: 'Punto de entrega elegido',
                ),
              ),
          ],
        ),
        const SimpleAttributionWidget(
          source: Text('colaboradores de OpenStreetMap'),
        ),
      ],
    );
  }
}

class _Pin extends StatelessWidget {
  const _Pin({
    required this.etiqueta,
    required this.icono,
    required this.color,
    required this.semantica,
    this.alTocar,
  });
  final String etiqueta, semantica;
  final IconData icono;
  final Color color;
  final VoidCallback? alTocar;

  @override
  Widget build(BuildContext context) => Semantics(
    label: semantica,
    button: alTocar != null,
    child: GestureDetector(
      onTap: alTocar,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(2),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 4,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icono, size: 14, color: Colors.white),
                const SizedBox(width: 4),
                Text(
                  etiqueta,
                  // Rótulo sobre el mapa: escala acotada para que los marcadores cercanos no se tapen; el nombre
                  // completo y la distancia están en la lista, que sí sigue la escala de fuente del sistema.
                  textScaler: MediaQuery.textScalerOf(
                    context,
                  ).clamp(maxScaleFactor: 1.1),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          // Punta del marcador: el vértice inferior queda sobre la coordenada.
          CustomPaint(size: const Size(12, 8), painter: _Punta(color)),
        ],
      ),
    ),
  );
}

class _Punta extends CustomPainter {
  const _Punta(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size s) => canvas.drawPath(
    Path()
      ..moveTo(0, 0)
      ..lineTo(s.width, 0)
      ..lineTo(s.width / 2, s.height)
      ..close(),
    Paint()..color = color,
  );

  @override
  bool shouldRepaint(_Punta old) => old.color != color;
}
