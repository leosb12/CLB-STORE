import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import '../dominio/pose.dart';
import 'comunes.dart';
import 'estado_tienda.dart';
import 'pantalla_probador.dart';
import 'tema.dart';

class PantallaDetalle extends StatefulWidget {
  const PantallaDetalle(
    this.producto, {
    super.key,
    required this.estado,
    required this.irAlCarrito,
  });
  final Producto producto;
  final EstadoTienda estado;
  final VoidCallback irAlCarrito;

  @override
  State<PantallaDetalle> createState() => _PantallaDetalleState();
}

class _PantallaDetalleState extends State<PantallaDetalle> {
  List<Variante>? _variantes;
  String? _talla;
  Variante? _elegida;

  @override
  void initState() {
    super.initState();
    widget.estado.variantes(widget.producto.identificador).then((v) {
      if (!mounted) return;
      setState(() => _variantes = v);
      final conStock = v.where((x) => x.disponible > 0);
      if (conStock.isNotEmpty) _elegirTalla(conStock.first.talla);
    });
  }

  List<String> get _tallas =>
      {for (final v in _variantes ?? const <Variante>[]) v.talla}.toList();

  void _elegirTalla(String talla) {
    final deTalla = (_variantes ?? const <Variante>[])
        .where((v) => v.talla == talla)
        .toList();
    setState(() {
      _talla = talla;
      _elegida =
          deTalla.where((v) => v.disponible > 0).firstOrNull ??
          deTalla.firstOrNull;
    });
  }

  Future<void> _probar() async {
    final talla = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        // El probador es siempre claro, como en la web: su componente web y las fotos de prenda se diseñaron sobre
        // fondo claro, y así la pantalla no queda partida entre el tema oscuro de la app y la WebView.
        builder: (_) => Theme(
          data: temaClb(Brightness.light),
          child: PantallaProbador(
            widget.producto,
            _variantes ?? const [],
            estado: widget.estado,
          ),
        ),
      ),
    );
    if (talla != null && mounted && _tallas.contains(talla)) {
      _elegirTalla(talla);
      final recurso = widget.producto.recursoProbador;
      if (recurso != null) {
        setState(
          () => _elegida = (_variantes ?? const <Variante>[])
              .where(
                (v) =>
                    v.talla == talla &&
                    v.color == recurso.color &&
                    v.disponible > 0,
              )
              .firstOrNull,
        );
      }
    }
  }

  Future<void> _agregar() async {
    final v = _elegida!;
    try {
      await widget.estado.agregar(widget.producto, v);
      if (!mounted) return;
      avisar(
        context,
        '${widget.producto.nombre} · ${v.talla} · ${v.color} en el carrito',
        accion: SnackBarAction(
          label: 'Ver carrito',
          onPressed: () {
            Navigator.of(context).popUntil((r) => r.isFirst);
            widget.irAlCarrito();
          },
        ),
      );
    } on ArgumentError catch (e) {
      if (mounted) avisar(context, '${e.message}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final p = widget.producto;
    final variantes = _variantes;
    final fecha = widget.estado.fechaCatalogo;
    final elegida = _elegida;
    return Scaffold(
      appBar: AppBar(title: Text(p.categoria)),
      body: ListView(
        padding: EdgeInsets.only(
          bottom: 32 + MediaQuery.paddingOf(context).bottom,
        ),
        children: [
          AspectRatio(
            aspectRatio: 4 / 3.4,
            child: ImagenProducto(p, widget.estado, color: _elegida?.color),
          ),
          if (p.recursoProbador != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'Fotografía disponible en color ${p.recursoProbador!.color}.${_elegida != null && _elegida!.color != p.recursoProbador!.color ? ' La variante seleccionada usa una ilustración de referencia.' : ''}',
              ),
            ),
          if (p.recursoProbador == null && fotografiaPrenda(p.sku) != null)
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text(
                'Fotografía: PNGimg.com · CC BY-NC 4.0. Colección de demostración.',
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.nombre, style: t.textTheme.headlineMedium),
                const SizedBox(height: 6),
                Text(importe(p.precioCentavos), style: t.textTheme.titleLarge),
                const SizedBox(height: 12),
                Text(p.descripcion, style: t.textTheme.bodyLarge),
                const SizedBox(height: 4),
                Text(
                  'SKU ${p.sku}',
                  style: t.textTheme.bodySmall?.copyWith(
                    color: t.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 28),
                if (variantes == null)
                  const LinearProgressIndicator()
                else if (variantes.isEmpty)
                  Text(
                    'Esta prenda todavía no tiene tallas a la venta.',
                    style: t.textTheme.bodyMedium,
                  )
                else ...[
                  Text('Talla', style: t.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final talla in _tallas)
                        ChoiceChip(
                          label: Text(talla),
                          selected: talla == _talla,
                          onSelected: (_) => _elegirTalla(talla),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text('Color', style: t.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final v in variantes.where((v) => v.talla == _talla))
                        ChoiceChip(
                          label: Text(
                            v.disponible > 0 ? v.color : '${v.color} · agotado',
                          ),
                          selected: v.identificador == elegida?.identificador,
                          onSelected: v.disponible > 0
                              ? (_) => setState(() => _elegida = v)
                              : null,
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (elegida != null)
                    Text(
                      elegida.disponible > 0
                          ? '${elegida.disponible} disponibles${fecha == null ? '' : ' al ${fechaCorta(fecha)}'}. La tienda confirma el stock al enviar el pedido.'
                          : 'Agotado en este color.',
                      style: t.textTheme.bodySmall?.copyWith(
                        color: t.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: elegida != null && elegida.disponible > 0
                        ? _agregar
                        : null,
                    icon: const Icon(Icons.add_shopping_cart),
                    label: const Text('Agregar al carrito'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _probar,
                  icon: const Icon(Icons.accessibility_new),
                  label: const Text('Probar virtualmente'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
