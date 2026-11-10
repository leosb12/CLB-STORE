import 'package:flutter/material.dart';

import '../dominio/casos_de_uso.dart';
import '../dominio/modelos.dart';
import 'comunes.dart';
import 'estado_tienda.dart';
import 'pantalla_entrega.dart';

class PantallaCarrito extends StatefulWidget {
  const PantallaCarrito(
    this.estado, {
    super.key,
    required this.irAPedidos,
    required this.irACuenta,
  });
  final EstadoTienda estado;
  final VoidCallback irAPedidos;
  final VoidCallback irACuenta;

  @override
  State<PantallaCarrito> createState() => _PantallaCarritoState();
}

class _PantallaCarritoState extends State<PantallaCarrito> {
  bool _confirmando = false;

  Future<void> _confirmar() async {
    // Paso visual de entrega: solo orienta; el pedido y su JSON no cambian.
    final seguir = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => PantallaEntrega(widget.estado)),
    );
    if (seguir != true || !mounted) return;
    setState(() => _confirmando = true);
    try {
      await widget.estado.confirmar();
      if (!mounted) return;
      avisar(
        context,
        widget.estado.enLinea
            ? 'Pedido guardado en el teléfono. Enviándolo a la tienda…'
            : 'Pedido guardado en el teléfono. Se enviará solo cuando vuelva la conexión.',
      );
      widget.irAPedidos();
    } on SinSesion {
      if (mounted) widget.irACuenta();
    } on ArgumentError catch (e) {
      if (mounted) avisar(context, '${e.message}');
    } finally {
      if (mounted) setState(() => _confirmando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final lineas = widget.estado.lineas;
    final conSesion = widget.estado.titular != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Carrito')),
      body: lineas.isEmpty
          ? const Aviso(
              icono: Icons.shopping_bag_outlined,
              titulo: 'Tu carrito está vacío',
              texto:
                  'Elige una prenda del catálogo. El carrito se guarda en el teléfono, también sin conexión.',
            )
          : Column(
              children: [
                Expanded(
                  child: ListView.separated(
                    itemCount: lineas.length,
                    separatorBuilder: (_, _) => const Divider(),
                    itemBuilder: (_, i) =>
                        _Linea(lineas[i], estado: widget.estado),
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
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Total de referencia',
                                  style: t.textTheme.titleSmall,
                                ),
                              ),
                              Text(
                                importe(totalCarrito(lineas)),
                                style: t.textTheme.titleLarge,
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'La tienda fija el precio y confirma el stock al recibir el pedido.',
                            style: t.textTheme.bodySmall?.copyWith(
                              color: t.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 14),
                          if (conSesion)
                            FilledButton(
                              onPressed: _confirmando ? null : _confirmar,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                              ),
                              child: Text(
                                _confirmando
                                    ? 'Guardando…'
                                    : 'Confirmar pedido',
                              ),
                            )
                          else
                            FilledButton.tonal(
                              onPressed: widget.irACuenta,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                              ),
                              child: const Text('Inicia sesión para confirmar'),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _Linea extends StatelessWidget {
  const _Linea(this.linea, {required this.estado});
  final LineaCarrito linea;
  final EstadoTienda estado;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(linea.nombre, style: t.textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(
                  'Talla ${linea.talla} · ${linea.color}',
                  style: t.textTheme.bodyMedium,
                ),
                Text(
                  '${importe(linea.precioCentavos)} c/u',
                  style: t.textTheme.bodySmall?.copyWith(
                    color: t.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: linea.cantidad == 1 ? 'Quitar del carrito' : 'Una menos',
            onPressed: () => estado.cambiarCantidad(linea, linea.cantidad - 1),
            icon: Icon(
              linea.cantidad == 1 ? Icons.delete_outline : Icons.remove,
            ),
          ),
          SizedBox(
            width: 28,
            child: Text(
              '${linea.cantidad}',
              textAlign: TextAlign.center,
              style: t.textTheme.titleMedium,
            ),
          ),
          IconButton(
            tooltip: 'Una más',
            onPressed: () => estado.cambiarCantidad(linea, linea.cantidad + 1),
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}
