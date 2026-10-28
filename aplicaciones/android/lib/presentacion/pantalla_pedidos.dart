import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'comunes.dart';
import 'estado_tienda.dart';

/// Cola del teléfono y estado de cada pedido en Ventas. «Pendiente» significa en el teléfono, nunca comprado.
class PantallaPedidos extends StatelessWidget {
  const PantallaPedidos(this.estado, {super.key});
  final EstadoTienda estado;

  @override
  Widget build(BuildContext context) {
    final remotos = {for (final p in estado.historial) p.identificador: p};
    for (final op in estado.operaciones) {
      final previo = remotos[op.identificador], reciente = op.resultado;
      if (previo != null &&
          reciente != null &&
          (DateTime.tryParse('${reciente.json['fecha_actualización']}') ??
                  DateTime(1970))
              .isAfter(
                DateTime.tryParse('${previo.json['fecha_actualización']}') ??
                    DateTime(1970),
              )) {
        remotos[op.identificador] = reciente;
      }
    }
    final entradas = <(DateTime, Widget)>[
      for (final op in estado.operaciones)
        if (!remotos.containsKey(op.identificador))
          (op.fechaCreacion, _Pedido(op, estado: estado)),
      for (final p in remotos.values)
        (
          DateTime.tryParse('${p.json['fecha_creación']}') ??
              DateTime.fromMillisecondsSinceEpoch(0),
          _PedidoRemoto(p),
        ),
    ]..sort((a, b) => b.$1.compareTo(a.$1));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Mis pedidos',
          maxLines: 2,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        actions: [
          IconButton(
            tooltip: 'Sincronizar ahora',
            onPressed: estado.enviandoPedidos
                ? null
                : () async {
                    await estado.enviarPedidos(forzar: true);
                    await estado.refrescarPedidos();
                  },
            icon: const Icon(Icons.sync),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Pedidos de tu cuenta en todos tus dispositivos y pendientes de envío de este teléfono. '
              '${estado.fechaHistorial == null ? 'Aún no hay una copia del historial de la tienda.' : '${estado.historialGuardado || !estado.enLinea ? 'Último historial guardado' : 'Historial actualizado'}: ${fechaCorta(estado.fechaHistorial!)}.'}',
            ),
          ),
          Expanded(
            child: entradas.isEmpty
                ? const SingleChildScrollView(
                    child: Aviso(
                      icono: Icons.receipt_long_outlined,
                      titulo: 'Aún no hay pedidos',
                      texto:
                          'Al confirmar el carrito, el pedido aparece aquí y se envía a la tienda en cuanto haya conexión.',
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: estado.refrescarPedidos,
                    child: ListView.separated(
                      itemCount: entradas.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) => entradas[i].$2,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// Los pedidos descargados son solo lectura: no tienen clave ni acciones de envío locales.
class _PedidoRemoto extends StatelessWidget {
  const _PedidoRemoto(this.pedido);
  final PedidoVenta pedido;

  @override
  Widget build(BuildContext context) => ExpansionTile(
    title: Text(switch (pedido.estado) {
      EstadoPedido.confirmado => 'Confirmado',
      EstadoPedido.cancelado => 'Cancelado por la tienda',
      EstadoPedido.enRevision => 'En revisión en la tienda',
      _ => 'Recibido, en proceso',
    }),
    subtitle: Text(
      '${pedido.json['fecha_creación'] == null ? '' : '${fechaCorta(DateTime.parse(pedido.json['fecha_creación'] as String))} · '}'
      '${pedido.total.replaceAll('.', ',')} Bs · Pedido ${pedido.identificador.substring(0, 8)}',
    ),
    childrenPadding: const EdgeInsets.all(16),
    expandedCrossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final linea in (pedido.json['líneas'] as List).cast<Map>())
        Text(
          '${linea['cantidad']} × ${linea['nombre'] ?? 'Prenda'} · ${linea['talla'] ?? ''} · ${linea['color'] ?? ''}',
        ),
      if (pedido.motivo != null) Text(pedido.motivo!),
      if (pedido.estado == EstadoPedido.confirmado)
        Text(
          pedido.comprobanteDisponible
              ? 'Comprobante de venta disponible.'
              : 'El comprobante se está generando.',
        ),
      if (pedido.json['saga'] is Map) ...[
        const SizedBox(height: 12),
        const Text('Pasos en la tienda'),
        for (final paso
            in ((pedido.json['saga'] as Map)['historial'] as List? ?? const [])
                .cast<Map>())
          Text('${paso['paso']} · ${paso['resultado']}'),
      ],
      SelectableText('Pedido ${pedido.identificador}'),
    ],
  );
}

(String, IconData) _estado(Operacion op) {
  final pedido = op.resultado;
  return switch (op.estado) {
    EstadoOperacion.pendiente => (
      op.intentos == 0
          ? 'En el teléfono, por enviar'
          : 'En el teléfono · reintento ${op.intentos}',
      Icons.schedule,
    ),
    EstadoOperacion.enviando => ('Enviando a la tienda…', Icons.sync),
    EstadoOperacion.requiereRevision => (
      'Requiere revisión',
      Icons.error_outline,
    ),
    EstadoOperacion.confirmada => switch (pedido?.estado) {
      EstadoPedido.confirmado => ('Confirmado', Icons.check_circle_outline),
      EstadoPedido.cancelado => (
        'Cancelado por la tienda',
        Icons.cancel_outlined,
      ),
      EstadoPedido.enRevision => (
        'En revisión en la tienda',
        Icons.hourglass_bottom,
      ),
      _ => ('Recibido, en proceso', Icons.hourglass_top),
    },
  };
}

class _Pedido extends StatelessWidget {
  const _Pedido(this.op, {required this.estado});
  final Operacion op;
  final EstadoTienda estado;

  Future<void> _reenviar(BuildContext context) async {
    try {
      final pedido = await estado.reenviar(op);
      if (context.mounted) {
        avisar(
          context,
          'Reenviado con la misma clave: la tienda devolvió el mismo pedido (${pedido.identificador.substring(0, 8)}…), sin duplicarlo.',
        );
      }
    } on Object catch (e) {
      if (context.mounted) avisar(context, 'No se pudo reenviar: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final (texto, icono) = _estado(op);
    final pedido = op.resultado;
    final cancelado =
        pedido?.estado == EstadoPedido.cancelado ||
        op.estado == EstadoOperacion.requiereRevision;
    final color = cancelado ? t.colorScheme.error : t.colorScheme.primary;
    final unidades = op.carrito.fold(0, (s, l) => s + l.cantidad);
    final historial = (pedido?.json['saga'] as Map?)?['historial'] as List?;
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      expandedCrossAxisAlignment: CrossAxisAlignment.start,
      shape: const Border(),
      leading: Icon(icono, color: color),
      title: Text(texto, style: t.textTheme.titleSmall?.copyWith(color: color)),
      subtitle: Text(
        '${fechaCorta(op.fechaCreacion)} · $unidades ${unidades == 1 ? 'prenda' : 'prendas'} · '
        '${pedido == null ? importe(op.totalReferenciaCentavos) : '${pedido.total.replaceAll('.', ',')} Bs'}',
        style: t.textTheme.bodyMedium,
      ),
      children: [
        for (final l in op.carrito)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              '${l.cantidad} × ${l.nombre} · ${l.talla} · ${l.color}',
              style: t.textTheme.bodyMedium,
            ),
          ),
        if (pedido?.motivo != null) ...[
          const SizedBox(height: 8),
          Text(
            pedido!.motivo!,
            style: t.textTheme.bodyMedium?.copyWith(color: t.colorScheme.error),
          ),
        ],
        if (op.error != null && op.estado != EstadoOperacion.confirmada) ...[
          const SizedBox(height: 8),
          Text('Último intento: ${op.error}', style: t.textTheme.bodySmall),
        ],
        if (pedido != null && pedido.estado == EstadoPedido.confirmado)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              pedido.comprobanteDisponible
                  ? 'Comprobante de venta disponible (lo generó la automatización de la tienda).'
                  : 'El comprobante de venta se generará en unos segundos.',
              style: t.textTheme.bodySmall,
            ),
          ),
        if (historial != null && historial.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('Pasos en la tienda', style: t.textTheme.titleSmall),
          const SizedBox(height: 4),
          for (final paso in historial.cast<Map>())
            Text(
              '${paso['paso']} · ${paso['resultado']}',
              style: t.textTheme.bodySmall,
            ),
        ],
        const SizedBox(height: 12),
        // Evidencia de idempotencia para la demostración: UUID del pedido y clave fija de todos sus envíos.
        SelectableText(
          'Pedido ${op.identificador}\nIdempotency-Key ${op.claveIdempotencia}',
          style: t.textTheme.bodySmall?.copyWith(
            fontFamily: 'monospace',
            color: t.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            if (op.estado == EstadoOperacion.pendiente)
              OutlinedButton(
                onPressed: () => estado.enviarPedidos(forzar: true),
                child: const Text('Enviar ahora'),
              ),
            if (op.estado == EstadoOperacion.confirmada)
              OutlinedButton(
                onPressed: () => _reenviar(context),
                child: const Text('Reenviar con la misma clave'),
              ),
          ],
        ),
      ],
    );
  }
}
