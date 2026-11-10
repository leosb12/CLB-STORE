import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../dominio/actividad.dart';
import '../dominio/sucursales.dart';
import 'estado_tienda.dart';
import 'mapa_sucursales.dart';
import 'pantalla_gestion.dart' show avisoEnLinea;

/// Pestaña «Sucursales»: cinco sucursales de demostración en Santa Cruz y la ubicación propia (solo en memoria).
/// El mapa se crea la primera vez que la pestaña se ve, así el arranque no descarga teselas ni pide permisos.
class PantallaSucursales extends StatefulWidget {
  const PantallaSucursales(this.tienda, {super.key, required this.visible});
  final EstadoTienda tienda;
  final bool visible;

  @override
  State<PantallaSucursales> createState() => _PantallaSucursalesState();
}

class _PantallaSucursalesState extends State<PantallaSucursales> {
  final _mapa = MapController();
  bool _abierta = false, _buscando = false;
  LatLng? _propia;
  String? _motivo;
  Sucursal? _elegida;

  @override
  void initState() {
    super.initState();
    if (widget.visible) _alMostrar();
  }

  @override
  void didUpdateWidget(PantallaSucursales anterior) {
    super.didUpdateWidget(anterior);
    if (widget.visible && !anterior.visible) _alMostrar();
  }

  @override
  void dispose() {
    _mapa.dispose();
    super.dispose();
  }

  void _alMostrar() {
    widget.tienda.registrar(
      CategoriaActividad.sucursales,
      'Abrir sucursales',
      'Mapa de las 5 sucursales de demostración.',
    );
    if (!_abierta) {
      _abierta = true;
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _centrarEnMi(encuadrarTodas: true),
      );
    }
  }

  /// La primera vez encuadra las cinco sucursales y el punto propio; el botón centra solo en el punto propio.
  Future<void> _centrarEnMi({bool encuadrarTodas = false}) async {
    if (_buscando) return;
    setState(() => _buscando = true);
    final (punto, motivo) = await ubicacionActual(widget.tienda);
    if (!mounted) return;
    setState(() {
      _buscando = false;
      _motivo = motivo;
      if (punto != null) _propia = punto;
    });
    if (encuadrarTodas) {
      _mapa.fitCamera(
        CameraFit.coordinates(
          coordinates: [for (final s in sucursalesDemo) s.punto, ?punto],
          padding: const EdgeInsets.fromLTRB(56, 72, 56, 96),
        ),
      );
    } else if (punto != null) {
      _mapa.move(punto, 14);
    }
  }

  void _elegir(Sucursal s) {
    setState(() => _elegida = s);
    _mapa.move(s.punto, 14);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final propia = _propia;
    final cercana = propia == null ? null : masCercana(propia).$1;
    final lista = [...sucursalesDemo];
    if (propia != null) {
      lista.sort(
        (a, b) => metrosEnLineaRecta(
          propia,
          a.punto,
        ).compareTo(metrosEnLineaRecta(propia, b.punto)),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Sucursales')),
      body: !_abierta
          ? const SizedBox.shrink()
          : ListenableBuilder(
              listenable: widget.tienda,
              builder: (context, _) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!widget.tienda.enLinea)
                    avisoEnLinea(
                      context,
                      'Sin conexión: el mapa base y las rutas necesitan internet. Las sucursales y las distancias '
                      'en línea recta se siguen mostrando.',
                      icono: Icons.cloud_off_outlined,
                    ),
                  Expanded(
                    flex: 5,
                    child: Stack(
                      children: [
                        MapaSucursales(
                          controlador: _mapa,
                          propia: propia,
                          resaltada: _elegida ?? cercana,
                          alTocarSucursal: _elegir,
                        ),
                        Positioned(
                          right: 12,
                          bottom: 28,
                          child: FilledButton.tonalIcon(
                            onPressed: _buscando ? null : () => _centrarEnMi(),
                            icon: _buscando
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.my_location),
                            label: const Text('Centrar en mi ubicación'),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_motivo != null)
                    avisoEnLinea(
                      context,
                      _motivo!,
                      icono: Icons.location_off_outlined,
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Text(
                      'Sucursales de demostración: ubicaciones ficticias para la presentación, no locales reales. '
                      'La distancia es en línea recta; la distancia por calle la calcula la app de mapas.',
                      style: t.textTheme.bodySmall?.copyWith(
                        color: t.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Expanded(
                    flex: 4,
                    child: ListView.separated(
                      itemCount: lista.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) {
                        final s = lista[i];
                        final metros = propia == null
                            ? null
                            : metrosEnLineaRecta(propia, s.punto);
                        return ListTile(
                          selected: identical(s, _elegida),
                          leading: const Icon(Icons.storefront_outlined),
                          title: Text(s.nombre),
                          subtitle: Text(
                            [
                              s.zona,
                              if (metros != null)
                                '${textoDistancia(metros)} en línea recta',
                              if (identical(s, cercana)) 'la más cercana',
                            ].join(' · '),
                          ),
                          onTap: () => _elegir(s),
                          trailing: TextButton(
                            onPressed: () => abrirRuta(
                              context,
                              widget.tienda,
                              s.punto,
                              descripcion: 'hasta ${s.nombre}',
                            ),
                            child: const Text('Ver ruta'),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
