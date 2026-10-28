import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../dominio/pose.dart';
import '../dominio/modelos.dart';
import 'estado_tienda.dart';
import 'tema.dart';

const _meses = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

/// «22 oct, 14:05» en hora local.
String fechaCorta(DateTime fecha) {
  final f = fecha.toLocal();
  return '${f.day} ${_meses[f.month - 1]}, ${f.hour.toString().padLeft(2, '0')}:${f.minute.toString().padLeft(2, '0')}';
}

/// Ilustración de la tienda para la categoría, sobre la superficie de prenda (las mismas SVG que la web).
class IlustracionPrenda extends StatelessWidget {
  const IlustracionPrenda(this.categoria, {super.key, this.alto, this.sku});
  final String categoria;
  final double? alto;
  final String? sku;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Theme.of(context).colorScheme.surfaceContainerHigh,
    child: Padding(
      padding: const EdgeInsets.all(6),
      child: fotografiaPrenda(sku) != null
          ? Image.asset(
              recursoPrenda(categoria, sku: sku),
              height: alto,
              fit: BoxFit.contain,
              semanticLabel: 'Fotografía de la prenda',
            )
          : SvgPicture.asset(
              recursoPrenda(categoria),
              height: alto,
              fit: BoxFit.contain,
              excludeFromSemantics: true,
            ),
    ),
  );
}

/// Fotografía persistente nueva o referencia anterior; no inicia solicitudes de red.
class ImagenProducto extends StatefulWidget {
  const ImagenProducto(this.producto, this.estado, {super.key, this.color});
  final String? color;
  final Producto producto;
  final EstadoTienda estado;
  @override
  State<ImagenProducto> createState() => _ImagenProductoState();
}

class _ImagenProductoState extends State<ImagenProducto> {
  late Future<Uint8List?> textura;
  @override
  void initState() {
    super.initState();
    textura = widget.estado.textura(widget.producto);
  }

  @override
  void didUpdateWidget(covariant ImagenProducto oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.producto.recursoProbador?.hash !=
            widget.producto.recursoProbador?.hash ||
        oldWidget.producto.identificador != widget.producto.identificador) {
      textura = widget.estado.textura(widget.producto);
    }
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List?>(
    future: textura,
    builder: (context, snapshot) =>
        snapshot.data != null &&
            (widget.color == null ||
                widget.color == widget.producto.recursoProbador?.color)
        ? Image.memory(
            snapshot.data!,
            fit: BoxFit.contain,
            semanticLabel:
                'Fotografía en color ${widget.producto.recursoProbador?.color}',
          )
        : IlustracionPrenda(
            widget.producto.categoria,
            sku: widget.producto.sku,
          ),
  );
}

/// Franja verde superior de la tienda web, convertida en el estado real de la tienda en el teléfono:
/// conexión, fecha del catálogo guardado y pedidos que esperan en la cola.
class FranjaEstado extends StatelessWidget {
  const FranjaEstado(this.estado, {super.key});
  final EstadoTienda estado;

  @override
  Widget build(BuildContext context) {
    final (icono, texto) = _contenido();
    const tinta = Color(0xFFF0F4EC);
    // Íconos claros en la barra del sistema: la franja verde queda debajo de ella.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Material(
        color: Clb.verde,
        child: SafeArea(
          bottom: false,
          child: Semantics(
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 9),
              child: Row(
                children: [
                  Icon(icono, size: 16, color: tinta),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      texto,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: tinta,
                        letterSpacing: 0.4,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  (IconData, String) _contenido() {
    final p = estado.pendientes;
    final cola = p == 0
        ? null
        : (p == 1 ? '1 pedido por enviar' : '$p pedidos por enviar');
    final fecha = estado.fechaCatalogo;
    if (estado.enviandoPedidos && p > 0)
      return (Icons.sync, 'Enviando pedidos a la tienda…');
    if (estado.sincronizandoCatalogo)
      return (Icons.sync, 'Actualizando el catálogo…');
    if (!estado.enLinea) {
      final base = fecha == null
          ? 'Sin conexión'
          : 'Sin conexión · catálogo del ${fechaCorta(fecha)}';
      return (Icons.cloud_off_outlined, cola == null ? base : '$base · $cola');
    }
    if (cola != null) return (Icons.schedule, cola);
    return (
      Icons.check,
      fecha == null
          ? 'Conectado'
          : 'Catálogo actualizado · ${fechaCorta(fecha)}',
    );
  }
}

/// Estado vacío o de error de una pantalla: qué pasa y qué hacer.
class Aviso extends StatelessWidget {
  const Aviso({
    super.key,
    required this.icono,
    required this.titulo,
    required this.texto,
    this.accion,
  });
  final IconData icono;
  final String titulo;
  final String texto;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icono, size: 40, color: t.colorScheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(
              titulo,
              style: t.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              texto,
              style: t.textTheme.bodyMedium?.copyWith(
                color: t.colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            if (accion != null) ...[const SizedBox(height: 20), accion!],
          ],
        ),
      ),
    );
  }
}

void avisar(
  BuildContext context,
  String mensaje, {
  SnackBarAction? accion,
}) => ScaffoldMessenger.of(context)
  ..hideCurrentSnackBar()
  // Aviso pasajero aunque tenga acción (Material 3 lo dejaría fijo y taparía el botón principal del carrito).
  ..showSnackBar(
    SnackBar(content: Text(mensaje), action: accion, persist: false),
  );
