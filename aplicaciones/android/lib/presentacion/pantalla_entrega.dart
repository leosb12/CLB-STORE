import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../dominio/actividad.dart';
import '../dominio/sucursales.dart';
import 'estado_tienda.dart';
import 'mapa_sucursales.dart';
import 'pantalla_gestion.dart' show avisoEnLinea;

/// Paso visual antes de confirmar: el comprador ubica la entrega y ve la sucursal de demostración más cercana.
/// Solo orienta: las coordenadas viven en este `State`, no se guardan ni viajan con el pedido, y se descartan al
/// salir. Devuelve `true` para seguir con la confirmación existente.
class PantallaEntrega extends StatefulWidget {
  const PantallaEntrega(this.tienda, {super.key});
  final EstadoTienda tienda;

  @override
  State<PantallaEntrega> createState() => _PantallaEntregaState();
}

class _PantallaEntregaState extends State<PantallaEntrega> {
  final _mapa = MapController();
  LatLng? _propia, _entrega;
  String? _motivo;
  bool _buscando = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _usarMiUbicacion());
  }

  @override
  void dispose() {
    _mapa.dispose();
    super.dispose();
  }

  Future<void> _usarMiUbicacion() async {
    if (_buscando) return;
    setState(() => _buscando = true);
    final (punto, motivo) = await ubicacionActual(widget.tienda);
    if (!mounted) return;
    setState(() {
      _buscando = false;
      _motivo = motivo;
      if (punto != null) _propia = _entrega = punto;
    });
    // Encuadra la entrega y su sucursal más cercana, para ver ambos marcadores.
    if (punto != null) {
      _mapa.fitCamera(
        CameraFit.coordinates(
          coordinates: [punto, masCercana(punto).$1.punto],
          // Reserva el aviso superior y el botón inferior que flotan sobre el mapa (más la altura del rótulo).
          padding: const EdgeInsets.fromLTRB(64, 140, 64, 150),
          maxZoom: 15,
        ),
      );
    }
    _anotarCercana();
  }

  void _mover(LatLng punto) {
    setState(() => _entrega = punto);
    _anotarCercana();
  }

  void _anotarCercana() {
    final entrega = _entrega;
    if (entrega == null) return;
    final (s, metros) = masCercana(entrega);
    widget.tienda.registrar(
      CategoriaActividad.ubicacion,
      'Sucursal más cercana',
      '${s.nombre} a ${textoDistancia(metros)} en línea recta del punto de entrega.',
    );
  }

  void _salir(bool continuar) {
    widget.tienda.registrar(
      CategoriaActividad.pedidos,
      'Lugar de entrega',
      continuar
          ? (_entrega == null
                ? 'Se continuó sin elegir un punto.'
                : 'Punto elegido solo como referencia visual; no se envía con el pedido.')
          : 'Se volvió al carrito sin confirmar.',
    );
    Navigator.of(context).pop(continuar);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final entrega = _entrega;
    final cercana = entrega == null ? null : masCercana(entrega);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (salio, _) {
        if (!salio) _salir(false);
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('¿Dónde entregamos?')),
        body: ListenableBuilder(
          listenable: widget.tienda,
          builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!widget.tienda.enLinea)
                avisoEnLinea(
                  context,
                  'Sin conexión: el mapa base y «Ver ruta» necesitan internet. Puedes continuar con el pedido; '
                  'se guardará en el teléfono como siempre.',
                  icono: Icons.cloud_off_outlined,
                ),
              if (_motivo != null)
                avisoEnLinea(
                  context,
                  _motivo!,
                  icono: Icons.location_off_outlined,
                ),
              Expanded(
                child: Stack(
                  children: [
                    MapaSucursales(
                      controlador: _mapa,
                      propia: _propia,
                      entrega: entrega,
                      resaltada: cercana?.$1,
                      alTocar: _mover,
                    ),
                    Positioned(
                      left: 12,
                      top: 12,
                      right: 12,
                      child: Material(
                        color: t.colorScheme.surface.withValues(alpha: 0.94),
                        borderRadius: BorderRadius.circular(2),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                          child: Text(
                            'Toca el mapa para mover el punto de entrega.',
                            style: t.textTheme.bodyMedium,
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      right: 12,
                      bottom: 28,
                      child: FilledButton.tonalIcon(
                        onPressed: _buscando ? null : _usarMiUbicacion,
                        icon: _buscando
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.my_location),
                        label: const Text('Usar mi ubicación'),
                      ),
                    ),
                  ],
                ),
              ),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: t.colorScheme.surfaceContainerLow,
                  border: Border(
                    top: BorderSide(color: t.colorScheme.outlineVariant),
                  ),
                ),
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (entrega == null)
                          Text(
                            'Aún no hay punto de entrega. Toca el mapa o usa tu ubicación.',
                            style: t.textTheme.bodyMedium,
                          )
                        else ...[
                          Text(
                            'Más cercana: ${cercana!.$1.nombre}',
                            style: t.textTheme.titleMedium,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${textoDistancia(cercana.$2)} en línea recta · sucursal de demostración. '
                            'La distancia por calle la calcula la app de mapas.',
                            style: t.textTheme.bodyMedium,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Punto temporal: ${entrega.latitude.toStringAsFixed(5)}, '
                            '${entrega.longitude.toStringAsFixed(5)} · no se guarda ni se envía con el pedido.',
                            style: t.textTheme.bodySmall?.copyWith(
                              color: t.colorScheme.onSurfaceVariant,
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: OutlinedButton.icon(
                              onPressed: () => abrirRuta(
                                context,
                                widget.tienda,
                                entrega,
                                origen: cercana.$1.punto,
                                descripcion:
                                    'desde ${cercana.$1.nombre} hasta la entrega',
                              ),
                              icon: const Icon(Icons.directions_outlined),
                              label: const Text('Ver ruta'),
                            ),
                          ),
                        ],
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: () => _salir(true),
                          style: FilledButton.styleFrom(
                            minimumSize: const Size.fromHeight(52),
                          ),
                          child: const Text('Continuar con el pedido'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
