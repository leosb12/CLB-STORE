import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'comunes.dart';
import 'estado_tienda.dart';
import 'pantalla_detalle.dart';

class PantallaCatalogo extends StatelessWidget {
  const PantallaCatalogo(this.estado, {super.key, required this.irAlCarrito});
  final EstadoTienda estado;
  final VoidCallback irAlCarrito;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final productos = estado.productos;
    final Widget cuerpo;
    if (productos.isEmpty) {
      cuerpo = estado.sincronizandoCatalogo
          ? const Center(child: CircularProgressIndicator())
          : Aviso(
              icono: Icons.cloud_off_outlined,
              titulo: estado.errorCatalogo == null
                  ? 'Aún no hay prendas'
                  : 'El catálogo no está en el teléfono',
              texto:
                  estado.errorCatalogo ??
                  'La tienda no tiene prendas publicadas todavía. Desliza hacia abajo para volver a consultar.',
              accion: OutlinedButton.icon(
                onPressed: estado.actualizarCatalogo,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            );
    } else {
      // Agrupado por categoría, en el orden del catálogo (nombre).
      final categorias = <String, List<Producto>>{};
      for (final p in productos) {
        categorias.putIfAbsent(p.categoria, () => []).add(p);
      }
      final nombres = categorias.keys.toList()..sort();
      cuerpo = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          for (final c in nombres) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 28, 16, 8),
              child: Text(c, style: t.textTheme.headlineSmall),
            ),
            for (final p in categorias[c]!)
              _FilaProducto(p, estado: estado, irAlCarrito: irAlCarrito),
          ],
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('CLB Store')),
      body: RefreshIndicator(
        onRefresh: estado.actualizarCatalogo,
        child: cuerpo,
      ),
    );
  }
}

class _FilaProducto extends StatelessWidget {
  const _FilaProducto(
    this.producto, {
    required this.estado,
    required this.irAlCarrito,
  });
  final Producto producto;
  final EstadoTienda estado;
  final VoidCallback irAlCarrito;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PantallaDetalle(
            producto,
            estado: estado,
            irAlCarrito: irAlCarrito,
          ),
        ),
      ),
      child: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: t.colorScheme.outlineVariant)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            SizedBox(
              width: 76,
              height: 84,
              child: ImagenProducto(producto, estado),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(producto.nombre, style: t.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    producto.descripcion,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: t.textTheme.bodySmall?.copyWith(
                      color: t.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Text(
              importe(producto.precioCentavos),
              style: t.textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}
