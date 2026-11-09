import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import 'comunes.dart';
import 'estado_gestion.dart';
import 'estado_tienda.dart';
import 'microfono.dart';
import 'pantalla_existencias.dart';
import 'tema.dart';
import 'reporte_v2.dart';

String _bs(Object? monto) => '${'$monto'.replaceAll('.', ',')} Bs';

AppBar _barra(BuildContext context, String titulo) => AppBar(
  title: Text(
    titulo,
    maxLines: 2,
    style: Theme.of(context).textTheme.titleMedium,
  ),
);

/// Aviso en línea (sin red, sin permiso, servicio caído): explica el motivo, sin tapar lo guardado.
Widget avisoEnLinea(
  BuildContext context,
  String texto, {
  IconData icono = Icons.info_outline,
}) {
  final t = Theme.of(context);
  return Container(
    color: t.colorScheme.surfaceContainerLow,
    padding: const EdgeInsets.all(12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icono, size: 20, color: t.colorScheme.onSurfaceVariant),
        const SizedBox(width: 12),
        Expanded(child: Text(texto, style: t.textTheme.bodyMedium)),
      ],
    ),
  );
}

/// Pestaña «Gestión» (solo rol admin): un resumen en texto y las secciones de la gestión con agentes.
class PantallaGestion extends StatefulWidget {
  const PantallaGestion(this.tienda, this.gestion, {super.key});
  final EstadoTienda tienda;
  final EstadoGestion gestion;

  @override
  State<PantallaGestion> createState() => _PantallaGestionState();
}

class _PantallaGestionState extends State<PantallaGestion> {
  @override
  void initState() {
    super.initState();
    widget.gestion.cargar();
  }

  void _abrir(Widget pantalla) =>
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => pantalla));

  @override
  Widget build(BuildContext context) {
    final g = widget.gestion;
    final t = Theme.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([g, widget.tienda]),
      builder: (context, _) {
        final ventas = (g.resumen?['resumenVentas'] as Map?) ?? const {};
        final stockBajo = (g.resumen?['stockBajo'] as List?)?.length;
        final alertas = g.alertas
            .where((a) => !g.alertasEnCola.contains(a['evento']))
            .length;
        return Scaffold(
          appBar: _barra(context, 'Gestión'),
          body: RefreshIndicator(
            onRefresh: g.cargar,
            child: ListView(
              children: [
                if (g.aviso != null)
                  avisoEnLinea(
                    context,
                    g.aviso!,
                    icono: Icons.cloud_off_outlined,
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Hoy', style: t.textTheme.headlineSmall),
                      const SizedBox(height: 8),
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          g.resumen == null
                              ? (g.cargando
                                    ? 'Leyendo la gestión…'
                                    : 'Sin datos guardados todavía.')
                              : '${ventas['unidades'] ?? 0} unidades · ${_bs(ventas['monto'] ?? '0.00')} en ${ventas['pedidos'] ?? 0} pedidos',
                          style: t.textTheme.titleMedium,
                        ),
                      ),
                      if (stockBajo != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          '$stockBajo variantes con stock bajo · $alertas alertas nuevas',
                        ),
                      ],
                      if (g.datosAl != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Datos al ${fechaCorta(g.datosAl!)}${g.conectada ? '' : ' (copia guardada)'}',
                          style: t.textTheme.bodySmall?.copyWith(
                            color: t.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const Divider(height: 24),
                _Seccion(
                  Icons.insights_outlined,
                  'Monitorea mi negocio',
                  'Los agentes revisan ventas, stock, clientes y reportes.',
                  () => _abrir(PantallaMision(g)),
                ),
                _Seccion(
                  Icons.notifications_none,
                  'Alertas',
                  'Stock bajo detectado por la automatización.',
                  () => _abrir(PantallaAlertas(g)),
                  contador: alertas,
                ),
                _Seccion(
                  Icons.inventory_outlined,
                  'Propuestas de reposición',
                  'Entradas sugeridas por el agente de inventario.',
                  () => _abrir(PantallaPropuestas(g)),
                  contador: g.propuestas.length,
                ),
                _Seccion(
                  Icons.bar_chart,
                  'Reportes',
                  'Pide un reporte en tus palabras y compártelo en Excel.',
                  () async {
                    // El micrófono aparece solo si este teléfono graba AAC y hay conexión para transcribir.
                    final voz = await vozDisponible(g);
                    _abrir(
                      PantallaReportes(
                        g,
                        microfono: voz
                            ? (alTexto) => BotonMicrofono(g, alTexto)
                            : null,
                      ),
                    );
                  },
                ),
                _Seccion(
                  Icons.straighten,
                  'Existencias y fotos',
                  'Entradas, salidas, mínimos y fotos de prendas, también sin red.',
                  () => _abrir(PantallaProductosAdmin(widget.tienda)),
                  contador: widget.tienda.pendientesAdministracion,
                  colorContador: Clb.cobre,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Seccion extends StatelessWidget {
  const _Seccion(
    this.icono,
    this.titulo,
    this.texto,
    this.alTocar, {
    this.contador = 0,
    this.colorContador,
  });
  final IconData icono;
  final String titulo, texto;
  final VoidCallback alTocar;
  final int contador;
  final Color? colorContador;

  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: 64,
    leading: Icon(icono),
    title: Text(titulo),
    subtitle: Text(texto),
    trailing: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (contador > 0)
          Badge(label: Text('$contador'), backgroundColor: colorContador),
        const Icon(Icons.chevron_right),
      ],
    ),
    onTap: alTocar,
  );
}

/// «Monitorea mi negocio»: primero lo que concluye cada agente; las herramientas usadas, en «Ver detalles».
class PantallaMision extends StatelessWidget {
  const PantallaMision(this.g, {super.key});
  final EstadoGestion g;

  static const _nombres = {
    'monitoreo': 'Monitoreo',
    'reportes': 'Reportes',
    'inventario': 'Inventario',
    'clientes': 'Clientes',
  };

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return ListenableBuilder(
      listenable: g,
      builder: (context, _) {
        final agentes = (g.mision?['agentes'] as List?) ?? const [];
        return Scaffold(
          appBar: _barra(context, 'Monitorea mi negocio'),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'El orquestador reparte la misión entre los agentes de Monitoreo, Reportes, Inventario y Clientes. '
                'Cada uno solo usa sus herramientas autorizadas y las cifras salen de los datos reales.',
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: g.ocupado || !g.conectada ? null : g.monitorear,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Monitorear ahora'),
              ),
              if (!g.conectada) ...[
                const SizedBox(height: 8),
                const Text(
                  'Necesita conexión con el servidor de gestión. Abajo queda la última misión guardada.',
                ),
              ],
              if (g.ocupado) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(
                  semanticsLabel: 'Los agentes están trabajando',
                ),
                const SizedBox(height: 8),
                const Text(
                  'Los agentes están revisando el negocio; suele tardar menos de un minuto.',
                ),
              ],
              if (g.aviso != null) ...[
                const SizedBox(height: 12),
                avisoEnLinea(context, g.aviso!),
              ],
              if (g.mision != null) ...[
                const SizedBox(height: 24),
                Text(
                  'Resultado · ${fechaCorta(DateTime.tryParse('${g.mision!['fecha']}') ?? DateTime.now())}',
                  style: t.textTheme.titleLarge,
                ),
                for (final a in agentes.cast<Map>()) ...[
                  const SizedBox(height: 16),
                  Text(
                    _nombres[a['agente']] ?? '${a['agente']}',
                    style: t.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Text('${a['respuesta']}'),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('Ver detalles'),
                    children: [
                      for (final f
                          in ((a['fuentes'] as List?) ?? const []).cast<Map>())
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.build_outlined, size: 18),
                          title: Text('${f['herramienta']}'),
                        ),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          a['generativa'] == true
                              ? 'Redactado por el modelo local y verificado contra las cifras.'
                              : 'Plantilla no generativa (sin modelo de lenguaje disponible).',
                          style: t.textTheme.bodySmall,
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ],
              ],
            ],
          ),
        );
      },
    );
  }
}

class PantallaAlertas extends StatelessWidget {
  const PantallaAlertas(this.g, {super.key});
  final EstadoGestion g;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([g, g.tienda]),
    builder: (context, _) => Scaffold(
      appBar: _barra(context, 'Alertas de stock'),
      body: g.alertas.isEmpty
          ? const SingleChildScrollView(
              child: Aviso(
                icono: Icons.notifications_none,
                titulo: 'Sin alertas nuevas',
                texto:
                    'Cuando una variante baja a su mínimo, la automatización deja aquí una alerta.',
              ),
            )
          : ListView(
              children: [
                for (final a in g.alertas)
                  ListTile(
                    title: Text('${a['mensaje']}'),
                    subtitle: Text(
                      '${a['sku']} · ${fechaCorta(DateTime.tryParse('${a['fecha_evento']}') ?? DateTime.now())}',
                    ),
                    isThreeLine: true,
                    trailing: g.alertasEnCola.contains(a['evento'])
                        ? const Tooltip(
                            message: 'Atendida; se enviará al reconectar',
                            child: Icon(Icons.schedule, color: Clb.cobre),
                          )
                        : TextButton(
                            onPressed: () => g.atender('${a['evento']}'),
                            child: const Text('Atender'),
                          ),
                  ),
              ],
            ),
    ),
  );
}

class PantallaPropuestas extends StatelessWidget {
  const PantallaPropuestas(this.g, {super.key});
  final EstadoGestion g;

  Future<void> _confirmar(BuildContext context, Map<String, dynamic> p) async {
    final si = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('¿Confirmar la reposición?'),
        content: Text(
          'Se registrará una entrada de ${p['cantidad']} unidades en ${p['sku']} en Inventario.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (si == true) await g.resolver('${p['identificador']}', true);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: g,
    builder: (context, _) => Scaffold(
      appBar: _barra(context, 'Propuestas de reposición'),
      body: ListView(
        children: [
          if (!g.conectada)
            avisoEnLinea(
              context,
              'Confirmar escribe en Inventario: necesita conexión para hacerlo con datos actuales.',
            ),
          if (g.aviso != null) avisoEnLinea(context, g.aviso!),
          if (g.propuestas.isEmpty)
            const Aviso(
              icono: Icons.inventory_outlined,
              titulo: 'Sin propuestas abiertas',
              texto:
                  'Pide «monitorea mi negocio» o revisa el inventario para que el agente proponga reposiciones.',
            ),
          for (final p in g.propuestas)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${p['sku']}: reponer ${p['cantidad']} unidades',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text('${p['motivo']}'),
                  if (p['disponible'] != null)
                    Text(
                      'Disponible ${p['disponible']} · mínimo ${p['minimo']}',
                    ),
                  if (p['estado'] == 'REQUIERE_REVISION')
                    const Text(
                      'Requiere revisión: el stock cambió desde la propuesta.',
                    ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 12,
                    children: [
                      FilledButton(
                        onPressed: g.ocupado || !g.conectada
                            ? null
                            : () => _confirmar(context, p),
                        child: const Text('Confirmar'),
                      ),
                      OutlinedButton(
                        onPressed: g.ocupado || !g.conectada
                            ? null
                            : () => g.resolver('${p['identificador']}', false),
                        child: const Text('Rechazar'),
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                ],
              ),
            ),
        ],
      ),
    ),
  );
}

/// Reporte generativo: la petición se traduce a una especificación validada y las cifras salen de GraphQL.
class PantallaReportes extends StatefulWidget {
  const PantallaReportes(this.g, {super.key, this.microfono});
  final EstadoGestion g;

  /// Botón de voz: solo se muestra si grabar y transcribir funcionan en este teléfono.
  final Widget Function(void Function(String texto) alTexto)? microfono;

  @override
  State<PantallaReportes> createState() => _PantallaReportesState();
}

class _PantallaReportesState extends State<PantallaReportes> {
  final _peticion = TextEditingController(
    text: 'Ventas de esta semana por producto',
  );

  /// Salida elegida en la pantalla (índice de `salidasReporte`); la última elección explícita prevalece sobre el texto.
  int _salida = 0;

  @override
  void dispose() {
    _peticion.dispose();
    super.dispose();
  }

  Future<void> _compartir(String formato) async {
    final pdf = formato.toLowerCase() == 'pdf';
    final datos = await widget.g.archivo(pdf ? 'pdf' : 'excel');
    if (datos == null || !mounted) return;
    final nombre = pdf ? 'reporte-clb.pdf' : 'reporte-clb.xlsx';
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(
            datos,
            name: nombre,
            mimeType: pdf
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ),
        ],
        fileNameOverrides: [nombre],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    final t = Theme.of(context);
    return ListenableBuilder(
      listenable: g,
      builder: (context, _) {
        final datos = (g.reporte?['datos'] as Map?) ?? const {};
        // Filas v1 (mapas clave/valor); un reporte v2 trae listas y lo dibuja ResultadoReporteV2.
        final filas = esReporteV2(g.reporte)
            ? const <Map>[]
            : ((datos['filas'] as List?) ?? const []).cast<Map>();
        final maximo = filas.fold<num>(
          0,
          (m, f) => (f['valor'] as num) > m ? f['valor'] as num : m,
        );
        return Scaffold(
          appBar: _barra(context, 'Reportes'),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextField(
                controller: _peticion,
                minLines: 1,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: '¿Qué quieres ver?',
                  helperText:
                      'Ej.: «ventas de esta semana con cliente, producto, cantidad, precio unitario y total, solo PDF».',
                  helperMaxLines: 2,
                  suffixIcon: widget.microfono?.call(
                    (texto) => setState(() => _peticion.text = texto),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<int>(
                initialValue: _salida,
                decoration: const InputDecoration(labelText: 'Salida'),
                items: [
                  for (var i = 0; i < salidasReporte.length; i++)
                    DropdownMenuItem(
                      value: i,
                      child: Text(salidasReporte[i].$1),
                    ),
                ],
                onChanged: (v) => setState(() => _salida = v ?? 0),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed:
                    g.ocupado || !g.conectada || _peticion.text.trim().isEmpty
                    ? null
                    : () => g.generarReporte(
                        _peticion.text.trim(),
                        formatos: salidasReporte[_salida].$2,
                      ),
                child: const Text('Generar reporte'),
              ),
              if (!g.conectada)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'Generar necesita conexión con el servidor de gestión. Abajo queda el último reporte guardado.',
                  ),
                ),
              if (g.ocupado)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const LinearProgressIndicator(
                        semanticsLabel: 'Generando el reporte',
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'El modelo de lenguaje del servidor interpreta la petición (no corre en este teléfono); '
                        'si no responde, se usan reglas limitadas y se indica.',
                        style: t.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              if (g.aviso != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: avisoEnLinea(context, g.aviso!),
                ),
              if (esReporteV2(g.reporte)) ...[
                const SizedBox(height: 24),
                ResultadoReporteV2(
                  reporte: g.reporte!,
                  deCopia: g.reporteDeCopia,
                  conectada: g.conectada,
                  compartir: _compartir,
                ),
              ] else if (g.reporte != null) ...[
                const SizedBox(height: 24),
                Text(
                  '${datos['titulo'] ?? 'Reporte'}',
                  style: t.textTheme.titleLarge,
                ),
                if (g.reporte!['interpretacion'] is String)
                  Text(
                    '${g.reporte!['interpretacion']}',
                    style: t.textTheme.bodyMedium,
                  ),
                Text(
                  'Total: ${datos['total']} ${datos['unidad'] ?? ''} · Datos al '
                  '${fechaCorta(DateTime.tryParse('${datos['datos_al'] ?? g.reporte!['datos_al']}') ?? DateTime.now())}',
                  style: t.textTheme.bodySmall?.copyWith(
                    color: t.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                if (filas.isEmpty) const Text('Sin datos para ese periodo.'),
                for (final f in filas)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        SizedBox(
                          width: 96,
                          child: Text(
                            '${f['clave']}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(2),
                            child: LinearProgressIndicator(
                              value: maximo == 0
                                  ? 0
                                  : (f['valor'] as num) / maximo,
                              minHeight: 14,
                              backgroundColor: t.colorScheme.surfaceContainer,
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 88,
                          child: Text(
                            '${f['valor']}',
                            textAlign: TextAlign.end,
                            style: const TextStyle(
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: g.conectada ? () => _compartir('excel') : null,
                      icon: const Icon(Icons.table_chart_outlined),
                      label: const Text('Compartir Excel'),
                    ),
                    OutlinedButton.icon(
                      onPressed: g.conectada ? () => _compartir('pdf') : null,
                      icon: const Icon(Icons.picture_as_pdf_outlined),
                      label: const Text('Compartir PDF'),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
