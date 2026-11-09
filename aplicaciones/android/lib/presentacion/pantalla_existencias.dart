import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../dominio/administracion.dart';
import '../dominio/modelos.dart';
import 'comunes.dart';
import 'estado_gestion.dart';
import 'estado_tienda.dart';
import 'pantalla_foto_prenda.dart';
import 'pantalla_gestion.dart';
import 'tema.dart';

/// Productos para administrar existencias y fotos. Se leen con conexión y se guarda una copia con su fecha.
class PantallaProductosAdmin extends StatefulWidget {
  const PantallaProductosAdmin(this.tienda, {super.key});
  final EstadoTienda tienda;

  @override
  State<PantallaProductosAdmin> createState() => _PantallaProductosAdminState();
}

class _PantallaProductosAdminState extends State<PantallaProductosAdmin> {
  List<Map<String, dynamic>> _productos = const [];
  DateTime? _datosAl;
  String? _aviso;
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final copia = await widget.tienda.preferencia('existencias:productos');
    if (copia != null && _productos.isEmpty) {
      final j = jsonDecode(copia) as Map<String, dynamic>;
      _productos = [
        for (final p in j['productos'] as List)
          (p as Map).cast<String, dynamic>(),
      ];
      _datosAl = DateTime.tryParse('${j['datos_al']}');
    }
    try {
      if (widget.tienda.existencias == null) throw SinConexion();
      final token = await widget.tienda.exigirTokenAdmin();
      _productos = await widget.tienda.existencias!.productosAdmin(token);
      _datosAl = DateTime.now();
      _aviso = null;
      await widget.tienda.guardarPreferencia(
        'existencias:productos',
        jsonEncode({
          'productos': _productos,
          'datos_al': _datosAl!.toUtc().toIso8601String(),
        }),
      );
    } on Object catch (e) {
      _aviso = explicar(e);
    }
    if (mounted) setState(() => _cargando = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        'Existencias y fotos',
        style: Theme.of(context).textTheme.titleMedium,
      ),
    ),
    body: RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        children: [
          if (_aviso != null)
            avisoEnLinea(context, _aviso!, icono: Icons.cloud_off_outlined),
          if (_datosAl != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text('Datos al ${fechaCorta(_datosAl!)}'),
            ),
          if (_cargando && _productos.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (!_cargando && _productos.isEmpty)
            const Aviso(
              icono: Icons.inventory_2_outlined,
              titulo: 'Sin productos guardados',
              texto:
                  'Conéctate una vez para descargar los productos; después podrás registrar cambios sin red.',
            ),
          for (final p in _productos)
            ListTile(
              title: Text('${p['nombre']}'),
              subtitle: Text(
                '${p['sku']} · ${p['categoría']}${p['activo'] == false ? ' · inactivo' : ''}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => PantallaVariantesAdmin(widget.tienda, p),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

/// Variantes con su saldo confirmado y los cambios propuestos que esperan en la cola del teléfono.
class PantallaVariantesAdmin extends StatefulWidget {
  const PantallaVariantesAdmin(this.tienda, this.producto, {super.key});
  final EstadoTienda tienda;
  final Map<String, dynamic> producto;

  @override
  State<PantallaVariantesAdmin> createState() => _PantallaVariantesAdminState();
}

class _PantallaVariantesAdminState extends State<PantallaVariantesAdmin> {
  List<VarianteAdmin> _variantes = const [];
  DateTime? _datosAl;
  String? _aviso;
  bool _cargando = true;
  String get _id => '${widget.producto['identificador']}';
  String get _clave => 'existencias:variantes:$_id';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final copia = await widget.tienda.preferencia(_clave);
    if (copia != null && _variantes.isEmpty) {
      final j = jsonDecode(copia) as Map<String, dynamic>;
      _variantes = [
        for (final v in j['variantes'] as List) VarianteAdmin.validar(v),
      ];
      _datosAl = DateTime.tryParse('${j['datos_al']}');
    }
    try {
      if (widget.tienda.existencias == null) throw SinConexion();
      final token = await widget.tienda.exigirTokenAdmin();
      _variantes = await widget.tienda.existencias!.variantesAdmin(_id, token);
      _datosAl = DateTime.now();
      _aviso = null;
      await widget.tienda.guardarPreferencia(
        _clave,
        jsonEncode({
          'variantes': [for (final v in _variantes) v.json],
          'datos_al': _datosAl!.toUtc().toIso8601String(),
        }),
      );
    } on Object catch (e) {
      _aviso = explicar(e);
    }
    if (mounted) setState(() => _cargando = false);
  }

  /// La versión base es la última confirmada: la del servidor o la del comprobante más reciente de este teléfono.
  VarianteAdmin _base(VarianteAdmin v) {
    final propias = [
      for (final o in widget.tienda.operacionesAdministracion)
        if (o.estado == EstadoOperacion.confirmada &&
            o.datos?['identificador_variante'] == v.identificador &&
            o.respuesta != null)
          VarianteAdmin.validar(o.respuesta!['variante']),
    ]..sort((a, b) => b.version.compareTo(a.version));
    return propias.isNotEmpty && propias.first.version > v.version
        ? propias.first
        : v;
  }

  Future<void> _proponer(
    String tipo,
    VarianteAdmin v,
    Map<String, dynamic> cuerpo, {
    Operacion? reemplaza,
  }) async {
    final titular = widget.tienda.titular;
    if (titular == null) return;
    if (reemplaza != null) {
      // Rehacer parte de la versión actual del servidor, no de la copia que causó el conflicto.
      await _cargar();
      if (_aviso != null) {
        if (mounted)
          avisar(
            context,
            'Para rehacer hace falta leer el saldo actual: conéctate e inténtalo de nuevo.',
          );
        return;
      }
      v = _variantes.firstWhere(
        (x) => x.identificador == v.identificador,
        orElse: () => v,
      );
    }
    final op = operacionExistencias(
      tipo: tipo,
      variante: _base(v),
      cuerpo: cuerpo,
      titular: titular.sub,
      ahora: DateTime.now(),
      cola: reemplaza == null
          ? widget.tienda.operacionesAdministracion
          : const [],
    );
    if (reemplaza != null) {
      await widget.tienda.rehacer(reemplaza, reemplazo(op, reemplaza));
    } else {
      await widget.tienda.encolarAdministracion(op);
    }
    if (mounted) {
      avisar(
        context,
        widget.tienda.enLinea
            ? 'Cambio enviado; el saldo se actualiza al confirmarse.'
            : 'Cambio guardado en el teléfono; se enviará al volver la conexión.',
      );
    }
    await _cargar();
  }

  Future<void> _hojaMovimiento(VarianteAdmin v, {Operacion? reemplaza}) async {
    final cuerpo = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HojaMovimiento(variante: v, previo: reemplaza?.datos),
    );
    if (cuerpo != null)
      await _proponer(registrarMovimiento, v, cuerpo, reemplaza: reemplaza);
  }

  Future<void> _hojaMinimo(VarianteAdmin v, {Operacion? reemplaza}) async {
    final cuerpo = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HojaMinimo(variante: v, previo: reemplaza?.datos),
    );
    if (cuerpo != null)
      await _proponer(configurarMinimo, v, cuerpo, reemplaza: reemplaza);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return ListenableBuilder(
      listenable: widget.tienda,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          title: Text(
            '${widget.producto['nombre']}',
            maxLines: 2,
            style: t.textTheme.titleMedium,
          ),
        ),
        body: RefreshIndicator(
          onRefresh: _cargar,
          child: ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              if (_aviso != null)
                avisoEnLinea(context, _aviso!, icono: Icons.cloud_off_outlined),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PantallaFotoPrenda(
                        widget.tienda,
                        widget.producto,
                        colores: {for (final v in _variantes) v.color},
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: const Text('Fotografía para el probador'),
                ),
              ),
              if (_datosAl != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: Text(
                    'Saldos confirmados al ${fechaCorta(_datosAl!)}',
                    style: t.textTheme.bodySmall,
                  ),
                ),
              if (_cargando && _variantes.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(32),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (!_cargando && _variantes.isEmpty)
                const Aviso(
                  icono: Icons.straighten,
                  titulo: 'Sin variantes guardadas',
                  texto:
                      'Conéctate una vez para descargar las variantes de este producto.',
                ),
              for (final v in _variantes) _variante(context, v),
            ],
          ),
        ),
      ),
    );
  }

  Widget _variante(BuildContext context, VarianteAdmin v) {
    final t = Theme.of(context);
    final ops = [
      for (final o in widget.tienda.operacionesAdministracion)
        if (o.datos?['identificador_variante'] == v.identificador &&
            o.reemplazadaPor == null &&
            o.estado != EstadoOperacion.confirmada)
          o,
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${v.talla} · ${v.color}',
                  style: t.textTheme.titleMedium,
                ),
              ),
              if (v.stockBajo)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  color: t.colorScheme.secondaryContainer,
                  child: Text(
                    'Stock bajo',
                    style: t.textTheme.labelMedium?.copyWith(
                      color: t.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
            ],
          ),
          Text(
            'Disponible ${v.disponible} · mínimo ${v.minimo}',
            style: t.textTheme.titleSmall?.copyWith(
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          Text(
            '${v.sku} · física ${v.fisica}, reservada ${v.reservada}',
            style: t.textTheme.bodySmall?.copyWith(
              color: t.colorScheme.onSurfaceVariant,
            ),
          ),
          for (final o in ops) _pendiente(context, v, o),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            children: [
              FilledButton.tonal(
                onPressed: () => _hojaMovimiento(v),
                child: const Text('Registrar movimiento'),
              ),
              OutlinedButton(
                onPressed: () => _hojaMinimo(v),
                child: const Text('Mínimo'),
              ),
            ],
          ),
          const Divider(height: 28),
        ],
      ),
    );
  }

  /// Revisión: «Rehacer» solo ante un conflicto definitivo; un resultado incierto se «Reintenta» con la misma clave.
  Widget _pendiente(BuildContext context, VarianteAdmin v, Operacion o) {
    final t = Theme.of(context);
    final d = o.datos ?? const {};
    final que = o.tipo == registrarMovimiento
        ? '${d['tipo'] == 'SALIDA' || d['sentido'] == 'DISMINUCION' ? '−' : '+'}${d['cantidad']} (${'${d['tipo']}'.toLowerCase()})'
        : 'mínimo ${d['mínimo']}';
    final revision = o.estado == EstadoOperacion.requiereRevision;
    final incierta = !revision && o.intentos > 0 && o.error != null;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      color: revision
          ? t.colorScheme.errorContainer
          : t.colorScheme.surfaceContainerLow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                revision ? Icons.error_outline : Icons.schedule,
                size: 18,
                color: revision ? t.colorScheme.onErrorContainer : Clb.cobre,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  revision
                      ? 'Necesita revisión: $que'
                      : o.estado == EstadoOperacion.enviando
                      ? 'Enviando: $que'
                      : 'Pendiente de enviar: $que',
                  style: t.textTheme.bodyMedium?.copyWith(
                    color: revision ? t.colorScheme.onErrorContainer : null,
                  ),
                ),
              ),
            ],
          ),
          if (o.error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(o.error!, style: t.textTheme.bodySmall),
            ),
          if (revision)
            TextButton(
              onPressed: () => o.tipo == registrarMovimiento
                  ? _hojaMovimiento(v, reemplaza: o)
                  : _hojaMinimo(v, reemplaza: o),
              child: const Text('Rehacer con el saldo actual'),
            ),
          if (incierta)
            TextButton(
              onPressed: () => widget.tienda.reintentar(o),
              child: const Text('Reintentar (mismo cambio)'),
            ),
        ],
      ),
    );
  }
}

class _HojaMovimiento extends StatefulWidget {
  const _HojaMovimiento({required this.variante, this.previo});
  final VarianteAdmin variante;
  final Map<String, dynamic>? previo;

  @override
  State<_HojaMovimiento> createState() => _HojaMovimientoState();
}

class _HojaMovimientoState extends State<_HojaMovimiento> {
  late String _tipo = '${widget.previo?['tipo'] ?? 'ENTRADA'}';
  late String _sentido = '${widget.previo?['sentido'] ?? 'INCREMENTO'}';
  late final _cantidad = TextEditingController(
    text: '${widget.previo?['cantidad'] ?? ''}',
  );
  late final _motivo = TextEditingController(
    text: '${widget.previo?['motivo'] ?? ''}',
  );
  String? _error;

  void _guardar() {
    final n = int.tryParse(_cantidad.text);
    if (n == null || n < 1 || n > cantidadMaxima)
      return setState(
        () => _error = 'Escribe una cantidad entre 1 y 1 000 000 000.',
      );
    if (_tipo == 'SALIDA' && n > widget.variante.disponible) {
      return setState(
        () => _error =
            'Solo hay ${widget.variante.disponible} disponibles para sacar.',
      );
    }
    final motivo = _motivo.text.trim();
    if (motivo.isEmpty)
      return setState(
        () =>
            _error = 'Indica el motivo (queda en el historial de la variante).',
      );
    Navigator.pop(context, {
      'tipo': _tipo,
      'cantidad': n,
      'motivo': motivo,
      if (_tipo == 'AJUSTE') 'sentido': _sentido,
    });
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      16,
      0,
      16,
      16 + MediaQuery.viewInsetsOf(context).bottom,
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Movimiento · ${widget.variante.sku}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: 'ENTRADA', label: Text('Entrada')),
            ButtonSegment(value: 'SALIDA', label: Text('Salida')),
            ButtonSegment(value: 'AJUSTE', label: Text('Ajuste')),
          ],
          selected: {_tipo},
          onSelectionChanged: (s) => setState(() => _tipo = s.first),
        ),
        if (_tipo == 'AJUSTE') ...[
          const SizedBox(height: 12),
          SegmentedButton<String>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: 'INCREMENTO', label: Text('Aumenta')),
              ButtonSegment(value: 'DISMINUCION', label: Text('Disminuye')),
            ],
            selected: {_sentido},
            onSelectionChanged: (s) => setState(() => _sentido = s.first),
          ),
        ],
        const SizedBox(height: 12),
        TextField(
          controller: _cantidad,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: 'Cantidad'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _motivo,
          maxLength: 200,
          decoration: const InputDecoration(labelText: 'Motivo'),
        ),
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _guardar,
          child: const Text('Guardar movimiento'),
        ),
        const SizedBox(height: 4),
        const Text(
          'Se guarda en el teléfono y se envía con una clave única: aunque se repita, se aplica una sola vez.',
        ),
      ],
    ),
  );
}

class _HojaMinimo extends StatefulWidget {
  const _HojaMinimo({required this.variante, this.previo});
  final VarianteAdmin variante;
  final Map<String, dynamic>? previo;

  @override
  State<_HojaMinimo> createState() => _HojaMinimoState();
}

class _HojaMinimoState extends State<_HojaMinimo> {
  late final _minimo = TextEditingController(
    text: '${widget.previo?['mínimo'] ?? widget.variante.minimo}',
  );
  String? _error;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      16,
      0,
      16,
      16 + MediaQuery.viewInsetsOf(context).bottom,
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Mínimo · ${widget.variante.sku}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        const Text(
          'Al bajar a este número o menos, Inventario emite «stock bajo» y n8n crea la alerta.',
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _minimo,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: 'Mínimo'),
        ),
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () {
            final n = int.tryParse(_minimo.text);
            if (n == null || n < 0 || n > cantidadMaxima)
              return setState(
                () => _error = 'Escribe un número entre 0 y 1 000 000 000.',
              );
            Navigator.pop(context, {'mínimo': n});
          },
          child: const Text('Guardar mínimo'),
        ),
      ],
    ),
  );
}
