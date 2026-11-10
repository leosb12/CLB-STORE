import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../dominio/actividad.dart';
import 'comunes.dart';
import 'estado_tienda.dart';
import 'exportar_actividad.dart';
import 'tema.dart';

/// «Registro de actividad» del vendedor: eventos de esta cuenta guardados en el teléfono, del más reciente al más
/// antiguo, con filtro por categoría y exportación a TXT, PDF o Excel.
class PantallaActividad extends StatefulWidget {
  const PantallaActividad(this.tienda, {super.key});
  final EstadoTienda tienda;

  @override
  State<PantallaActividad> createState() => _PantallaActividadState();
}

class _PantallaActividadState extends State<PantallaActividad> {
  List<EventoActividad>? _eventos;
  String? _categoria;

  @override
  void initState() {
    super.initState();
    _leer();
  }

  Future<void> _leer() async {
    final registro = widget.tienda.actividad;
    final eventos = registro == null
        ? const <EventoActividad>[]
        : await registro.leer(widget.tienda.titular?.sub ?? '');
    if (mounted) setState(() => _eventos = eventos);
  }

  List<EventoActividad> get _visibles => [
    for (final e in _eventos ?? const <EventoActividad>[])
      if (_categoria == null || e.categoria == _categoria) e,
  ];

  Future<void> _exportar(String formato) async {
    final eventos = _visibles;
    final (bytes, extension, tipo) = switch (formato) {
      'pdf' => (exportarPdf(eventos), 'pdf', 'application/pdf'),
      'xlsx' => (
        exportarXlsx(eventos),
        'xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
      _ => (exportarTxt(eventos), 'txt', 'text/plain'),
    };
    final nombre = 'actividad-clb.$extension';
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, name: nombre, mimeType: tipo)],
        fileNameOverrides: [nombre],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final eventos = _eventos;
    final categorias = {
      for (final e in eventos ?? const []) e.categoria,
    }.toList()..sort();
    final visibles = _visibles;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Registro de actividad'),
        actions: [
          PopupMenuButton<String>(
            tooltip: 'Exportar',
            icon: const Icon(Icons.ios_share),
            enabled: visibles.isNotEmpty,
            onSelected: _exportar,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'txt', child: Text('Exportar TXT')),
              PopupMenuItem(value: 'pdf', child: Text('Exportar PDF')),
              PopupMenuItem(value: 'xlsx', child: Text('Exportar Excel')),
            ],
          ),
        ],
      ),
      body: eventos == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _leer,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                      child: Text(
                        '${visibles.length} eventos de esta cuenta · se guardan en el teléfono, '
                        'hasta $limiteActividad, sin tokens, datos personales ni ubicación.',
                        style: t.textTheme.bodySmall?.copyWith(
                          color: t.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                  if (categorias.isNotEmpty)
                    SliverToBoxAdapter(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                        child: Row(
                          children: [
                            for (final c in [null, ...categorias])
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: FilterChip(
                                  label: Text(c ?? 'Todas'),
                                  selected: _categoria == c,
                                  showCheckmark: false,
                                  onSelected: (_) =>
                                      setState(() => _categoria = c),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  const SliverToBoxAdapter(child: Divider()),
                  if (visibles.isEmpty)
                    const SliverToBoxAdapter(
                      child: Aviso(
                        icono: Icons.history,
                        titulo: 'Sin actividad registrada',
                        texto:
                            'Al usar el catálogo, el carrito, los pedidos o la gestión, cada evento queda aquí con su fecha y hora.',
                      ),
                    )
                  else
                    SliverList.separated(
                      itemCount: visibles.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) => _Evento(visibles[i]),
                    ),
                ],
              ),
            ),
    );
  }
}

class _Evento extends StatelessWidget {
  const _Evento(this.e);
  final EventoActividad e;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final (icono, color) = switch (e.severidad) {
      Severidad.success => (Icons.check_circle_outline, t.colorScheme.primary),
      Severidad.warning => (Icons.warning_amber_outlined, Clb.cobre),
      Severidad.error => (Icons.error_outline, t.colorScheme.error),
      Severidad.info => (Icons.info_outline, t.colorScheme.onSurfaceVariant),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, color: color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: etiquetaSeveridad(e.severidad),
                        style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      TextSpan(
                        text: ' · ${e.categoria} · ${fechaHora(e.fecha)}',
                      ),
                    ],
                  ),
                  style: t.textTheme.labelSmall?.copyWith(
                    color: t.colorScheme.onSurfaceVariant,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 4),
                Text(e.funcionalidad, style: t.textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(e.descripcion, style: t.textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
