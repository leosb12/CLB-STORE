import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import 'comunes.dart';
import 'estado_gestion.dart';
import 'estado_tienda.dart';
import 'exportar_actividad.dart' show fechaHora;
import 'microfono.dart';
import 'pantalla_actividad.dart';
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
                  'Pide en tus palabras o por voz; los agentes consultan ventas, stock, clientes y reportes.',
                  () async {
                    final voz = await vozDisponible(g);
                    _abrir(
                      PantallaMision(
                        g,
                        microfono: voz
                            ? (alTexto) => BotonMicrofono(g, alTexto)
                            : null,
                      ),
                    );
                  },
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
                _Seccion(
                  Icons.history,
                  'Registro de actividad',
                  'Qué se hizo en este teléfono y cuándo; exportable a TXT, PDF o Excel.',
                  () => _abrir(PantallaActividad(widget.tienda)),
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

/// «Monitorea mi negocio»: misión libre (texto o voz) o el acceso rápido «Monitorear ahora». El texto llega tal cual al
/// orquestador por GraphQL (`ejecutarMision`); la pantalla muestra solo lo que devuelve: agentes, respuestas y
/// herramientas MCP invocadas. Nada se inventa ni se completa en el teléfono.
class PantallaMision extends StatefulWidget {
  const PantallaMision(this.g, {super.key, this.microfono});
  final EstadoGestion g;

  /// Botón de voz (transcriptor `/voz` del servidor); null si este teléfono no puede grabar o no hay conexión.
  final Widget Function(void Function(String texto) alTexto)? microfono;

  @override
  State<PantallaMision> createState() => _PantallaMisionState();
}

class _PantallaMisionState extends State<PantallaMision> {
  static const _nombres = {
    'monitoreo': 'Monitoreo',
    'reportes': 'Reportes',
    'inventario': 'Inventario',
    'clientes': 'Clientes',
  };
  final _texto = TextEditingController();

  @override
  void initState() {
    super.initState();
    _texto.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _texto.dispose();
    super.dispose();
  }

  bool get _valida {
    final n = _texto.text.trim().length;
    return n >= 3 && n <= 500;
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    final t = Theme.of(context);
    final tenue = t.textTheme.bodySmall?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    return ListenableBuilder(
      listenable: g,
      builder: (context, _) {
        final puede = !g.ocupado && g.conectada;
        final mision = g.mision;
        final agentes = ((mision?['agentes'] as List?) ?? const []).cast<Map>();
        return Scaffold(
          appBar: _barra(context, 'Monitorea mi negocio'),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Semantics(
                label: 'Misión',
                child: TextField(
                  controller: _texto,
                  minLines: 3,
                  maxLines: 6,
                  maxLength: 500,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    // Sin etiqueta flotante: el placeholder queda visible antes de escribir.
                    hintText: '¿Qué querés monitorear de tu negocio?',
                  ),
                ),
              ),
              Row(
                children: [
                  if (widget.microfono != null) ...[
                    DecoratedBox(
                      decoration: BoxDecoration(
                        border: Border.all(color: t.colorScheme.outline),
                        borderRadius: BorderRadius.circular(2),
                      ),
                      child: widget.microfono!((texto) {
                        // El dictado queda en el campo para revisarlo; la misión sale solo al pulsar «Ejecutar».
                        _texto.text = texto;
                        _texto.selection = TextSelection.collapsed(
                          offset: texto.length,
                        );
                      }),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: puede && _valida
                          ? () {
                              FocusScope.of(context).unfocus();
                              g.monitorear(_texto.text.trim());
                            }
                          : null,
                      icon: const Icon(Icons.send),
                      label: const Text('Ejecutar misión'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                widget.microfono != null
                    ? 'Micrófono: toca para dictar y otra vez para terminar; revisa el texto antes de ejecutar.'
                    : 'El dictado necesita conexión con el servidor y un teléfono que grabe audio.',
                style: tenue,
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: puede ? g.monitorear : null,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Monitorear ahora'),
              ),
              const SizedBox(height: 4),
              Text(
                'Acceso rápido: revisión general de ventas, stock, clientes y reportes. Las misiones solo consultan; '
                'una reposición sugerida queda como propuesta que confirmas en «Propuestas de reposición».',
                style: tenue,
              ),
              if (!g.conectada) ...[
                const SizedBox(height: 12),
                avisoEnLinea(
                  context,
                  'Necesita conexión con el servidor de gestión. Abajo queda la última misión guardada.',
                  icono: Icons.cloud_off_outlined,
                ),
              ],
              if (g.ocupado) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(
                  semanticsLabel: 'Los agentes están trabajando',
                ),
                const SizedBox(height: 8),
                Text(
                  'Los agentes consultan sus herramientas en el servidor; puede tardar hasta un par de minutos.',
                  style: t.textTheme.bodyMedium,
                ),
              ],
              if (g.aviso != null) ...[
                const SizedBox(height: 12),
                avisoEnLinea(context, g.aviso!, icono: Icons.error_outline),
              ],
              if (mision != null) ...[
                const SizedBox(height: 28),
                Text('Resultado', style: t.textTheme.titleLarge),
                const SizedBox(height: 4),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    '«${mision['mision']}»',
                    style: t.textTheme.bodyLarge,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${fechaHora(DateTime.tryParse('${mision['fecha']}') ?? DateTime.now())}'
                  ' · ${agentes.length} ${agentes.length == 1 ? 'agente' : 'agentes'}'
                  '${g.conectada ? '' : ' · copia guardada'}',
                  style: tenue?.copyWith(
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (agentes.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 12),
                    child: Text(
                      'Los agentes no devolvieron resultados para esta misión.',
                    ),
                  ),
                for (final a in agentes) ...[
                  const Divider(height: 32),
                  _ResultadoAgente(
                    a,
                    nombre: _nombres[a['agente']] ?? '${a['agente']}',
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

/// Lo que concluyó un agente; en «Ver detalles», solo las herramientas que realmente invocó según la respuesta.
class _ResultadoAgente extends StatelessWidget {
  const _ResultadoAgente(this.a, {required this.nombre});
  final Map a;
  final String nombre;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final fuentes = ((a['fuentes'] as List?) ?? const []).cast<Map>();
    final permitidas = ((a['herramientas_permitidas'] as List?) ?? const [])
        .join(', ');
    final tenue = t.textTheme.bodySmall?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(nombre, style: t.textTheme.titleMedium),
        const SizedBox(height: 2),
        Text(
          a['generativa'] == true
              ? 'Redactado por el modelo del servidor y verificado contra las cifras'
              : 'Resumen verificado, sin modelo de lenguaje',
          style: tenue,
        ),
        const SizedBox(height: 8),
        SelectableText(
          '${a['respuesta'] ?? ''}',
          style: t.textTheme.bodyMedium,
        ),
        if (a['observacion'] is String) ...[
          const SizedBox(height: 6),
          Text('${a['observacion']}', style: tenue),
        ],
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsets.only(bottom: 8),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          title: Text(
            'Ver detalles · ${fuentes.length} ${fuentes.length == 1 ? 'herramienta' : 'herramientas'}',
          ),
          children: [
            Text('Herramientas utilizadas', style: t.textTheme.titleSmall),
            if (fuentes.isEmpty)
              const Text('Este agente no invocó herramientas.'),
            for (final f in fuentes)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      _error(f) == null
                          ? Icons.build_outlined
                          : Icons.error_outline,
                      size: 18,
                      color: _error(f) == null
                          ? t.colorScheme.onSurfaceVariant
                          : t.colorScheme.error,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${f['herramienta']}',
                            style: t.textTheme.bodyMedium,
                          ),
                          if (f['argumentos'] is Map &&
                              (f['argumentos'] as Map).isNotEmpty)
                            Text(jsonEncode(f['argumentos']), style: tenue),
                          if (_error(f) != null)
                            Text(
                              'No respondió: ${_error(f)}',
                              style: tenue?.copyWith(
                                color: t.colorScheme.error,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            Text('Fuentes de los datos', style: t.textTheme.titleSmall),
            Text(
              'Herramientas MCP del servidor de CLB Store con la identidad del vendedor'
              '${permitidas.isEmpty ? '.' : '; permitidas a este agente: $permitidas.'}',
              style: tenue,
            ),
          ],
        ),
      ],
    );
  }

  static String? _error(Map f) {
    final r = f['resultado'];
    return r is Map && r['error'] != null ? '${r['error']}' : null;
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
