import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../dominio/modelos.dart';
import 'estado_gestion.dart';
import 'estado_tienda.dart';
import 'pantalla_gestion.dart';
import 'tema.dart';

const _categoriasProbador = {
  'poleras',
  'polera',
  'camisas',
  'camisa',
  'camisetas',
  'camiseta',
  'chaqueta',
  'chaquetas',
  'suéter',
  'sueter',
  'suéteres',
  'sueteres',
  'buzo',
  'buzos',
  'polerón',
  'poleron',
  'polerones',
  'abrigo',
  'abrigos',
  'pantalón',
  'pantalon',
  'pantalones',
  'jean',
  'jeans',
  'falda',
  'faldas',
  'short',
  'shorts',
  'vestido',
  'vestidos',
  'enterizo',
  'superior',
  'inferior',
  'cuerpo completo',
};

/// Ingesta de la foto de una prenda desde el teléfono (CU04.9): la misma del panel web. El servidor quita el fondo, mide
/// la calidad, construye el modelo 3D y la espalda; lo grave bloquea y los avisos se publican solo si se aceptan.
/// Necesita conexión. Las dos claves (carga y publicación) se guardan: un reintento tras una respuesta perdida no duplica.
class PantallaFotoPrenda extends StatefulWidget {
  const PantallaFotoPrenda(
    this.tienda,
    this.producto, {
    super.key,
    this.colores = const {},
  });
  final EstadoTienda tienda;
  final Map<String, dynamic> producto;
  final Set<String> colores;

  @override
  State<PantallaFotoPrenda> createState() => _PantallaFotoPrendaState();
}

class _PantallaFotoPrendaState extends State<PantallaFotoPrenda> {
  Uint8List? _foto, _vista;
  late final _color = TextEditingController(
    text: widget.colores.length == 1 ? widget.colores.first : '',
  );
  Map<String, dynamic>? _trabajo;
  String? _error;
  bool _ocupado = false, _aceptar = false;
  String _carga = nuevoUuid(), _publicar = nuevoUuid();
  Timer? _consulta;
  int _turno = 0;

  String get _id => '${widget.producto['identificador']}';
  String get _clave => 'ingesta:$_id';

  /// Versión vigente del producto: sube al publicar y se relee ante un conflicto.
  late int _version = widget.producto['versión_sincronización'] as int;
  bool get _permitida => _categoriasProbador.contains(
    '${widget.producto['categoría']}'.trim().toLowerCase(),
  );

  @override
  void initState() {
    super.initState();
    _retomar();
  }

  @override
  void dispose() {
    _turno++;
    _consulta?.cancel();
    _color.dispose();
    super.dispose();
  }

  /// Tras cerrar la app se retoma el último trabajo con las mismas claves.
  Future<void> _retomar() async {
    final guardado = await widget.tienda.preferencia(_clave);
    if (guardado == null) return;
    final j = jsonDecode(guardado) as Map<String, dynamic>;
    _carga = j['carga'] as String;
    _publicar = j['publicar'] as String;
    await _actualizar();
  }

  Future<String> _token() async {
    if (widget.tienda.ingesta == null) throw SinConexion();
    return widget.tienda.exigirTokenAdmin();
  }

  Future<void> _elegir(bool camara) async {
    try {
      final foto = await widget.tienda.elegirFoto(camara);
      if (foto == null || !mounted) return;
      _consulta?.cancel();
      _turno++;
      setState(() {
        _foto = foto;
        _vista = null;
        _trabajo = null;
        _error = null;
        _aceptar = false;
        _carga = nuevoUuid();
        _publicar = nuevoUuid();
      });
    } on Object {
      if (mounted) setState(() => _error = 'No se pudo abrir la fotografía.');
    }
  }

  Future<void> _preparar() async {
    final color = _color.text.trim();
    if (_foto == null || color.isEmpty)
      return setState(
        () => _error = 'Elige una foto e indica el color representado.',
      );
    setState(() {
      _ocupado = true;
      _error = null;
    });
    try {
      await widget.tienda.guardarPreferencia(
        _clave,
        jsonEncode({'carga': _carga, 'publicar': _publicar}),
      );
      final r = await widget.tienda.ingesta!.cargar(
        _id,
        _carga,
        _version,
        color,
        _foto!,
        await _token(),
      );
      _trabajo = (r['trabajo'] as Map).cast<String, dynamic>();
      _seguir();
    } on ErrorRemoto catch (e) {
      // Rechazo definitivo: el siguiente intento (otro color, versión releída) es otra solicitud con otra clave.
      // Un error de red, en cambio, se reintenta con la misma clave: Inventario devuelve el trabajo ya creado.
      _carga = nuevoUuid();
      _publicar = nuevoUuid();
      if (e.estado == 409) await _releerVersion();
      _error = explicar(e);
    } on Object catch (e) {
      _error = explicar(e);
    }
    if (mounted) setState(() => _ocupado = false);
  }

  Future<void> _releerVersion() async {
    try {
      final productos = await widget.tienda.existencias!.productosAdmin(
        await _token(),
      );
      final actual = productos
          .where((p) => p['identificador'] == _id)
          .firstOrNull;
      if (actual != null) _version = actual['versión_sincronización'] as int;
    } on Object {
      // Sin red: se conserva la versión conocida; el siguiente intento la volverá a releer.
    }
  }

  void _seguir() {
    _consulta?.cancel();
    if (const {'PENDIENTE', 'PROCESANDO'}.contains(_trabajo?['estado'])) {
      _consulta = Timer(const Duration(seconds: 2), _actualizar);
    }
  }

  Future<void> _actualizar() async {
    final turno = _turno;
    try {
      final token = await _token();
      final r = await widget.tienda.ingesta!.trabajo(_id, _carga, token);
      if (!mounted || turno != _turno) return;
      _trabajo = (r['trabajo'] as Map).cast<String, dynamic>();
      if (_trabajo!['estado'] == 'LISTO' && _vista == null) {
        _vista = await widget.tienda.ingesta!.previsualizacion(
          _id,
          _carga,
          token,
        );
      }
      _error = null;
    } on ErrorRemoto catch (e) {
      // 404: la clave guardada no tiene trabajo (nunca llegó a cargarse). Se empieza de nuevo.
      if (e.estado == 404) {
        _trabajo = null;
      } else {
        _error = explicar(e);
      }
    } on Object catch (e) {
      _error = explicar(e);
    }
    if (mounted && turno == _turno) {
      setState(() {});
      _seguir();
    }
  }

  Future<void> _publicarFoto() async {
    final avisos = _calidad?['nivel'] == 'con_avisos';
    if (avisos && !_aceptar) return;
    setState(() => _ocupado = true);
    try {
      final r = await widget.tienda.ingesta!.publicar(
        _id,
        _carga,
        _publicar,
        _version,
        avisos,
        await _token(),
      );
      _trabajo = (r['trabajo'] as Map).cast<String, dynamic>();
      if (_trabajo!['estado'] == 'PUBLICADO') {
        _version = (_trabajo!['recurso']?['version'] as int?) ?? _version + 1;
        await widget.tienda.guardarPreferencia(
          _clave,
          jsonEncode({'carga': nuevoUuid(), 'publicar': nuevoUuid()}),
        );
        unawaited(widget.tienda.actualizarCatalogo());
      }
    } on Object catch (e) {
      _error = explicar(e);
    }
    if (mounted) setState(() => _ocupado = false);
  }

  Map<String, dynamic>? get _calidad =>
      (_trabajo?['calidad'] as Map?)?.cast<String, dynamic>();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final estado = _trabajo?['estado'] as String?;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Foto · ${widget.producto['nombre']}',
          maxLines: 2,
          style: t.textTheme.titleMedium,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!widget.tienda.enLinea)
            avisoEnLinea(
              context,
              'Preparar y publicar la foto necesita conexión con la tienda: el servidor quita el fondo y mide la calidad.',
              icono: Icons.cloud_off_outlined,
            ),
          if (!_permitida)
            avisoEnLinea(
              context,
              'Esta categoría no es una prenda que se pueda probar (superior, inferior o de cuerpo completo).',
            ),
          Text(
            'Cada foto pasa un control de calidad antes de publicarse.',
            style: t.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          for (final g in const [
            'Una sola prenda, extendida y de frente, sin maniquí ni persona.',
            'Fondo liso de un color distinto al de la prenda y sin sombras.',
            'Margen alrededor: la prenda no debe tocar el borde de la foto.',
            'Mangas o perneras separadas del cuerpo de la prenda.',
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('·  '),
                  Expanded(child: Text(g)),
                ],
              ),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _ocupado ? null : () => _elegir(true),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: const Text('Tomar foto'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _ocupado ? null : () => _elegir(false),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Galería'),
                ),
              ),
            ],
          ),
          if (_foto != null) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 220,
              child: Image.memory(
                _foto!,
                fit: BoxFit.contain,
                semanticLabel: 'Foto elegida de la prenda',
              ),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _color,
            // Otro color es otra solicitud: no se reutiliza la clave de una carga anterior.
            onChanged: (_) {
              if (_trabajo == null) _carga = nuevoUuid();
            },
            decoration: const InputDecoration(
              labelText: 'Color representado',
              helperText: 'El color de la variante que muestra la foto.',
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed:
                _ocupado ||
                    _foto == null ||
                    !_permitida ||
                    !widget.tienda.enLinea ||
                    _trabajo != null
                ? null
                : _preparar,
            child: const Text('Preparar foto'),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: avisoEnLinea(context, _error!, icono: Icons.error_outline),
            ),
          if (estado != null) ...[
            const Divider(height: 32),
            _etapas(context, estado),
            if (_calidad != null) _informe(context, _calidad!),
            if (estado == 'LISTO') ...[
              if (_vista != null) ...[
                const SizedBox(height: 12),
                ColoredBox(
                  color: Clb.superficiePrenda,
                  child: SizedBox(
                    height: 260,
                    child: Image.memory(
                      _vista!,
                      fit: BoxFit.contain,
                      semanticLabel: 'Prenda preparada sin fondo',
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Text(
                _trabajo?['recurso']?['espalda'] != null
                    ? 'Se generó también la espalda: la prenda tendrá realidad aumentada 3D.'
                    : 'Esta prenda no tendrá realidad aumentada; sí foto con IA.',
              ),
              if (_calidad?['nivel'] == 'con_avisos')
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _aceptar,
                  onChanged: (v) => setState(() => _aceptar = v ?? false),
                  title: const Text(
                    'Entiendo los avisos: la prenda se publicará marcada como de calidad limitada.',
                  ),
                ),
              FilledButton(
                onPressed:
                    _ocupado ||
                        (_calidad?['nivel'] == 'con_avisos' && !_aceptar)
                    ? null
                    : _publicarFoto,
                child: Text(
                  _calidad?['nivel'] == 'con_avisos'
                      ? 'Publicar con avisos'
                      : 'Publicar foto',
                ),
              ),
            ],
            if (estado == 'REQUIERE_REVISION' || estado == 'ERROR')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _calidad != null
                      ? 'Corrige lo marcado y toma otra foto: esta no se puede publicar.'
                      : '${_trabajo?['mensaje'] ?? 'Toma otra foto para volver a intentarlo.'}',
                ),
              ),
            if (estado == 'PUBLICADO')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Foto publicada. La tienda y la app la descargan con la próxima sincronización del catálogo.',
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _etapas(BuildContext context, String estado) {
    final t = Theme.of(context);
    const nombres = {
      'PENDIENTE': 'Foto recibida',
      'PROCESANDO':
          'Quitando el fondo, midiendo la calidad y armando el modelo 3D…',
      'LISTO': 'Lista para revisar',
      'REQUIERE_REVISION': 'Necesitamos otra fotografía',
      'ERROR': 'No se pudo preparar',
      'PUBLICADO': 'Foto publicada',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            nombres[estado] ?? estado,
            style: t.textTheme.titleMedium,
          ),
        ),
        if (estado == 'PENDIENTE' || estado == 'PROCESANDO')
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: LinearProgressIndicator(),
          ),
      ],
    );
  }

  /// Bloqueos primero, luego avisos, cada uno con su medida y su objetivo; lo superado queda plegado.
  Widget _informe(BuildContext context, Map<String, dynamic> c) {
    final t = Theme.of(context);
    final todas = ((c['comprobaciones'] as List?) ?? const []).cast<Map>();
    final problemas = [
      ...todas.where((x) => x['nivel'] == 'bloqueo'),
      ...todas.where((x) => x['nivel'] == 'aviso'),
    ];
    final superadas = todas.where((x) => x['nivel'] == 'ok').toList();
    const niveles = {
      'apta': 'cumple el estándar',
      'con_avisos': 'cumple con avisos',
      'no_apta': 'no cumple el estándar',
    };
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Control de calidad: ${niveles[c['nivel']] ?? c['nivel']}${c['nivel'] == 'no_apta' ? '' : ' · ${c['puntuacion']}/100'}',
            style: t.textTheme.titleSmall,
          ),
          for (final x in problemas)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                x['nivel'] == 'bloqueo' ? Icons.block : Icons.warning_amber,
                color: x['nivel'] == 'bloqueo'
                    ? t.colorScheme.error
                    : Clb.cobre,
              ),
              title: Text(
                '${x['nivel'] == 'bloqueo' ? 'Impide publicar' : 'Aviso'}: ${x['mensaje']}',
              ),
              subtitle: x['valor'] == null
                  ? null
                  : Text('Medido ${x['valor']} · objetivo ${x['umbral']}'),
            ),
          if (superadas.isNotEmpty)
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text('${superadas.length} comprobaciones superadas'),
              children: [
                for (final x in superadas)
                  ListTile(
                    dense: true,
                    leading: const Icon(Icons.check, size: 18),
                    title: Text('${x['mensaje']}'),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
