import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../dominio/casos_de_uso.dart';
import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import '../dominio/pose.dart';
import '../dominio/tallas.dart';
import '../dominio/prenda_articulada.dart';
import '../dominio/fotos_prendas.dart';
import '../dominio/prenda_probador.dart';
import 'textura_articulada.dart';
import 'comunes.dart';
import 'estado_tienda.dart';
import 'foto_generativa.dart';
import 'vista_ra.dart';

/// Tres formas de probarse: dos en el teléfono (RA 3D y vista rápida) y una en el servidor (foto con IA).
enum ModoProbador { ra, rapida, fotografica }

/// Por debajo de este rendimiento medido la RA no se ofrece por defecto (criterio de la prueba en el celular).
const imagenesMinimasRA = 8.0;

/// Probador: la pose se estima con MoveNet (TensorFlow Lite) en el teléfono y la prenda se ajusta en 2D sobre la foto.
/// Devuelve al detalle la talla elegida.
class PantallaProbador extends StatefulWidget {
  const PantallaProbador(
    this.producto,
    this.variantes, {
    super.key,
    required this.estado,
  });
  final Producto producto;
  final List<Variante> variantes;
  final EstadoTienda estado;

  @override
  State<PantallaProbador> createState() => _PantallaProbadorState();
}

class _PantallaProbadorState extends State<PantallaProbador> {
  /// null mientras se lee la preferencia guardada.
  ModoProbador? _modo;
  bool get _modoGenerativo => _modo == ModoProbador.fotografica;
  TallaSugerida? _sugerida;
  static const _usarRegiones = bool.fromEnvironment(
    'CLB_PROBADOR_REGIONES',
    defaultValue: true,
  );
  ProbarPrenda? _probador;
  Uint8List? _textura;
  TexturaArticulada? _texturaArticulada;
  PrendaArticulada? _articulacion;
  PrendaPintable? _pintura;
  late final Future<void> _cargaTextura;
  String? _errorModelo;
  ResultadoPrueba? _resultado;
  bool _analizando = false;
  bool _usarMaterial = const bool.fromEnvironment(
    'CLB_PROBADOR_MATERIAL',
    defaultValue: true,
  );
  Uint8List? _imagenMaterial, _ultimaFoto;
  String? _falloMaterial;
  CompositorCamiseta? _compositor;
  bool get _materialDisponible =>
      widget.estado.crearCompositor != null &&
      widget.producto.recursoProbador?.anclas['estampados'] is List &&
      widget.producto.categoria.toLowerCase().contains('polera');
  bool _puntos = false;
  int _turno = 0;
  final _medidas = {
    for (final c in caracteristicas) c: TextEditingController(),
  };
  String? _errorMedidas;
  RecomendacionTalla? _talla;

  bool get _tiene3D {
    final r = widget.producto.recursoProbador;
    return fotosPrendas.containsKey(widget.producto.sku) ||
        (r?.modelo3d != null && r?.espalda != null);
  }

  List<ModoProbador> get _modos => [
    if (widget.estado.probadorRA != null && _tiene3D) ModoProbador.ra,
    if (widget.producto.recursoProbador?.soloGenerativo != true)
      ModoProbador.rapida,
    if (widget.estado.probadorFotografico != null) ModoProbador.fotografica,
  ];

  /// La elección del usuario se recuerda; sin elección, la RA solo es el modo inicial si ya rindió bien en este teléfono.
  Future<void> _elegirModoInicial() async {
    final guardado = await widget.estado.preferencia('modo_probador');
    final medido = double.tryParse(
      await widget.estado.preferencia('ra_imagenes_por_segundo') ?? '',
    );
    final modos = _modos;
    var modo = ModoProbador.values.asNameMap()[guardado];
    if (modo == null || !modos.contains(modo)) {
      final raProbada = medido != null && medido >= imagenesMinimasRA;
      modo = raProbada && modos.contains(ModoProbador.ra)
          ? ModoProbador.ra
          : modos.where((m) => m != ModoProbador.ra).firstOrNull ??
                modos.firstOrNull ??
                ModoProbador.rapida;
    }
    if (mounted) setState(() => _modo = modo);
  }

  void _cambiarModo(ModoProbador modo) {
    // Al salir de la RA su WebView se destruye: el probador web apaga la cámara antes (VistaRA.dispose).
    setState(() {
      _modo = modo;
      _sugerida = null;
    });
    widget.estado.guardarPreferencia('modo_probador', modo.name);
  }

  @override
  void initState() {
    super.initState();
    _elegirModoInicial();
    _cargaTextura = widget.estado
        .textura(widget.producto)
        .then((datos) async {
          final recurso = widget.producto.recursoProbador;
          final preparada =
              _usarRegiones &&
                  datos != null &&
                  recurso != null &&
                  !recurso.soloGenerativo
              ? await TexturaArticulada.cargar(datos, recurso.anclas)
              : null;
          if (mounted) {
            setState(() {
              _textura = datos;
              _texturaArticulada = preparada;
            });
          } else {
            preparada?.dispose();
          }
        })
        .catchError((Object _) {});
    widget.estado.probador().then(
      (p) {
        if (mounted) setState(() => _probador = p);
      },
      onError: (Object e) {
        if (mounted) {
          setState(
            () => _errorModelo =
                'No se pudo cargar el modelo de pose en este teléfono ($e).',
          );
        }
      },
    );
  }

  @override
  void dispose() {
    _pintura?.dispose();
    _texturaArticulada?.dispose();
    for (final c in _medidas.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _foto(bool camara) async {
    final probador = _probador;
    if (probador == null) return;
    final bytes = await widget.estado.elegirFoto(camara);
    if (bytes == null || !mounted) return;
    _ultimaFoto = bytes;
    await _procesarFoto(bytes);
  }

  Future<void> _procesarFoto(Uint8List bytes) async {
    final probador = _probador;
    if (probador == null) return;
    // Un turno por foto: si llega otra mientras se analiza, el resultado viejo se descarta.
    final turno = ++_turno;
    setState(() => _analizando = true);
    try {
      await _cargaTextura;
      final r = await probador.ejecutar(
        bytes,
        widget.producto.categoria,
        _textura == null ? null : widget.producto.recursoProbador,
      );
      Uint8List? imagenMaterial;
      String? falloMaterial;
      if (_materialDisponible &&
          _usarMaterial &&
          _textura != null &&
          r.ajuste.ajustado) {
        try {
          _compositor ??= widget.estado.crearCompositor!();
          imagenMaterial = await _compositor!.componer(
            r.imagen,
            _textura!,
            widget.producto.recursoProbador!.anclas,
            r.pose,
          );
        } on Object catch (e) {
          falloMaterial = e is FormatException
              ? e.message.toString()
              : 'No se pudo preparar el tejido en este dispositivo. Puedes usar la vista por regiones.';
        }
      }
      if (mounted && turno == _turno) {
        final geometria = _texturaArticulada?.geometria;
        final transformacion = r.ajuste.transformacion;
        // La malla articulada es de torso y mangas: un pantalón va con el ajuste afín de cadera a tobillos.
        final articulacion =
            geometria != null &&
                transformacion != null &&
                tipoDePrenda(widget.producto.categoria) != TipoPrenda.pantalon
            ? articularPrenda(geometria, r.pose.puntos, transformacion)
            : null;
        final pintura =
            articulacion != null && !(_materialDisponible && _usarMaterial)
            ? PrendaPintable(_texturaArticulada!.imagen, articulacion)
            : null;
        final anterior = _pintura;
        setState(() {
          _resultado = r;
          _imagenMaterial = imagenMaterial;
          _falloMaterial = falloMaterial;
          _articulacion = articulacion;
          _pintura = pintura;
        });
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => anterior?.dispose(),
        );
      }
    } on Object catch (e) {
      if (mounted && turno == _turno) {
        avisar(context, 'No se pudo analizar la foto: $e');
      }
    } finally {
      if (mounted && turno == _turno) setState(() => _analizando = false);
    }
  }

  void _calcular() {
    final valores = {
      for (final e in _medidas.entries)
        e.key: double.tryParse(e.value.text.replaceAll(',', '.')),
    };
    final error = validarMedidas(valores);
    final modelo = widget.estado.modeloTallas;
    setState(() {
      _errorMedidas = error;
      _talla = error == null && modelo != null
          ? inferirTalla(modelo, valores.map((k, v) => MapEntry(k, v!)))
          : null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final modos = _modos;
    return Scaffold(
      appBar: AppBar(title: Text('Probar · ${widget.producto.nombre}')),
      bottomNavigationBar: _modo == ModoProbador.ra && _sugerida != null
          ? _barraTalla(t, _sugerida!)
          : null,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (modos.length > 1 && _modo != null) _selector(t, modos),
          Expanded(
            child: switch (_modo) {
              null => const SizedBox.shrink(),
              ModoProbador.ra => VistaRA(
                anfitrion: widget.estado.probadorRA!,
                prenda: prendaProbador(widget.producto, widget.variantes),
                catalogo: [
                  for (final p in widget.estado.productos)
                    if (combinable(p, widget.producto.identificador))
                      prendaProbador(p, const []),
                ],
                alTalla: (s) => setState(() => _sugerida = s),
                alRendimiento: (v) => widget.estado.guardarPreferencia(
                  'ra_imagenes_por_segundo',
                  '$v',
                ),
                usarVistaRapida: modos.contains(ModoProbador.rapida)
                    ? () => _cambiarModo(ModoProbador.rapida)
                    : null,
              ),
              _ => _cuerpoLocal(t),
            },
          ),
        ],
      ),
    );
  }

  Widget _selector(ThemeData t, List<ModoProbador> modos) {
    final (icono, ayuda) = switch (_modo!) {
      ModoProbador.ra => (
        Icons.smartphone_outlined,
        'Prenda en 3D sobre tu cámara. Se calcula en este teléfono y funciona sin conexión.',
      ),
      ModoProbador.rapida => (
        Icons.smartphone_outlined,
        'Superposición aproximada sobre una foto, en este teléfono. Funciona sin conexión.',
      ),
      ModoProbador.fotografica => (
        Icons.cloud_outlined,
        'Imagen realista generada en el servidor de CLB. Requiere conexión al servidor.',
      ),
    };
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<ModoProbador>(
            showSelectedIcon: false,
            segments: [
              for (final m in modos)
                ButtonSegment(
                  value: m,
                  label: Text(
                    switch (m) {
                      ModoProbador.ra => 'RA 3D',
                      ModoProbador.rapida => 'Vista rápida',
                      ModoProbador.fotografica => 'Foto con IA',
                    },
                    maxLines: 1,
                    softWrap: false,
                  ),
                ),
            ],
            selected: {_modo!},
            onSelectionChanged: (s) => _cambiarModo(s.first),
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icono, size: 18, color: t.colorScheme.onSurfaceVariant),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  ayuda,
                  style: t.textTheme.bodySmall?.copyWith(
                    color: t.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Talla que llega de la RA. No se muestra la probabilidad de esta talla: no es una métrica calibrada. Sí la exactitud
  /// del modelo en su prueba, que es lo único validado.
  Widget _barraTalla(ThemeData t, TallaSugerida s) {
    final propia = s.prenda == widget.producto.identificador;
    final otra = propia
        ? null
        : widget.estado.productos
              .where((p) => p.identificador == s.prenda)
              .firstOrNull
              ?.nombre;
    final exactitud = s.exactitud == null
        ? ''
        : ' El modelo acertó el ${(s.exactitud! * 100).round()} % de las tallas en su prueba con datos simulados.';
    return Material(
      color: t.colorScheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                liveRegion: true,
                child: Text(
                  otra == null
                      ? 'Talla sugerida: ${s.talla}'
                      : 'Talla sugerida para $otra: ${s.talla}',
                  style: t.textTheme.titleMedium,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Según las medidas que ingresaste; calculada en este teléfono.$exactitud',
                style: t.textTheme.bodySmall?.copyWith(
                  color: t.colorScheme.onSurfaceVariant,
                ),
              ),
              if (propia && s.disponible == false) ...[
                const SizedBox(height: 4),
                Text(
                  'La talla ${s.talla} no está disponible en esta prenda.',
                  style: t.textTheme.bodyMedium,
                ),
              ],
              if (propia) ...[
                const SizedBox(height: 12),
                s.disponible == false
                    ? OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Ver tallas disponibles'),
                      )
                    : FilledButton(
                        onPressed: () => Navigator.of(context).pop(s.talla),
                        child: Text('Elegir talla ${s.talla}'),
                      ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _cuerpoLocal(ThemeData t) {
    return ListView(
      padding: EdgeInsets.only(
        bottom: 32 + MediaQuery.paddingOf(context).bottom,
      ),
      children: [
        if (_modoGenerativo)
          FotoGenerativa(
            key: ValueKey(widget.producto.identificador),
            estado: widget.estado,
            producto: widget.producto,
          ),
        if (!_modoGenerativo) ...[
          if (_materialDisponible)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _usarMaterial
                        ? 'Tejido sobre camiseta base'
                        : 'Superposición por regiones',
                    style: t.textTheme.titleMedium,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Aplicar tejido sobre camiseta base'),
                    subtitle: Text(
                      _usarMaterial
                          ? 'Usa una camiseta de color uniforme y un pantalón de otro color. La foto se procesa solo en tu teléfono.'
                          : 'La malla puede dejar visible la ropa que llevas. No sustituye la camiseta de la foto.',
                    ),
                    value: _usarMaterial,
                    onChanged: _analizando
                        ? null
                        : (valor) {
                            setState(() => _usarMaterial = valor);
                            if (_ultimaFoto != null) {
                              _procesarFoto(_ultimaFoto!);
                            }
                          },
                  ),
                  if (_usarMaterial)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 12),
                      child: Text(
                        'De frente, con brazos separados y el borde de la camiseta visible. Evita objetos delante del torso. El corte y los pliegues corresponden a tu camiseta base. Compara el diseño con la foto original del producto.',
                      ),
                    ),
                  _accionesFoto(),
                  const SizedBox(height: 12),
                  Semantics(liveRegion: true, child: Text(_estadoAjuste())),
                ],
              ),
            ),
          _espejo(t),
          if (widget.producto.recursoProbador != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Fotografía en color ${widget.producto.recursoProbador!.color}. ${_materialDisponible && _usarMaterial ? 'Se conserva la forma de tu camiseta base.' : 'Vista frontal aproximada; no simula la caída de la tela.'}',
              ),
            ),
        ],
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!_modoGenerativo && !_materialDisponible) _accionesFoto(),
              if (!_modoGenerativo && !_materialDisponible)
                Semantics(
                  liveRegion: true,
                  child: Text(_estadoAjuste(), style: t.textTheme.bodyMedium),
                ),
              if (!_modoGenerativo &&
                  fotografiaPrenda(widget.producto.sku) != null)
                const Text(
                  'Fotografía: PNGimg.com · CC BY-NC 4.0. Superposición 2D aproximada.',
                ),
              if (!_modoGenerativo && _resultado != null)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Mostrar puntos del cuerpo'),
                  value: _puntos,
                  onChanged: (v) => setState(() => _puntos = v),
                ),
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 20),
              Text('Tu talla', style: t.textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                'Con cuatro medidas, el modelo de tallas de la tienda calcula la tuya en el teléfono.',
                style: t.textTheme.bodyMedium?.copyWith(
                  color: t.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              _formulario(),
              if (_errorMedidas != null) ...[
                const SizedBox(height: 8),
                Text(
                  _errorMedidas!,
                  style: t.textTheme.bodyMedium?.copyWith(
                    color: t.colorScheme.error,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _calcular,
                child: const Text('Calcular talla'),
              ),
              if (_talla != null) _recomendacion(t, _talla!),
              if (widget.estado.modeloTallas == null) _tablaReferencia(t),
              const SizedBox(height: 28),
              _privacidad(t),
            ],
          ),
        ),
      ],
    );
  }

  Widget _accionesFoto() => Row(
    children: [
      Expanded(
        child: FilledButton.icon(
          onPressed: _probador == null || _analizando
              ? null
              : () => _foto(true),
          icon: const Icon(Icons.photo_camera_outlined),
          label: const Text('Cámara'),
        ),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: _probador == null || _analizando
              ? null
              : () => _foto(false),
          icon: const Icon(Icons.photo_library_outlined),
          label: const Text('Galería'),
        ),
      ),
    ],
  );

  String _estadoAjuste() {
    if (_errorModelo != null) return _errorModelo!;
    if (_probador == null) return 'Preparando el modelo de pose…';
    if (_analizando) {
      return _materialDisponible && _usarMaterial
          ? 'Analizando pose y tejido en el teléfono…'
          : 'Detectando la pose en el teléfono…';
    }
    if (_falloMaterial != null) return _falloMaterial!;
    final r = _resultado;
    if (r == null) {
      return widget.producto.recursoProbador != null
          ? 'Usa una foto frontal desde la cabeza hasta la cadera, con ambos codos visibles y buena luz.'
          : 'Usa una foto de cuerpo entero, de frente y con buena luz.';
    }
    final a = r.ajuste;
    if (!a.ajustado) {
      return widget.producto.recursoProbador != null
          ? '${explicarSinAjuste(a.motivo!)} Prueba una foto frontal donde se vean hombros, ambos codos y cadera.'
          : '${explicarSinAjuste(a.motivo!)} Prueba una foto de cuerpo entero, de frente, donde se vean los hombros y la cadera.';
    }
    final confianza =
        'Confianza de la pose: ${(a.puntuacion * 100).round()} %. No mide el encaje de la ropa.';
    if (_imagenMaterial != null) {
      return 'Tejido aplicado sobre tu camiseta base. No representa el corte ni la talla real del producto. $confianza';
    }
    final vista = _articulacion == null
        ? 'Vista aproximada.'
        : _articulacion!.codosArticulados == 2
        ? 'Torso y mangas adaptados a tu pose.'
        : 'Ajuste de mangas parcial: una manga conserva la colocación aproximada para evitar deformarla; muestra los codos con los brazos algo más separados.';
    return a.largoEstimado
        ? '$vista $confianza El largo es estimado: prueba una foto más completa, donde se vean el torso y la cadera.'
        : '$vista $confianza';
  }

  Widget _espejo(ThemeData t) {
    final r = _resultado;
    final ajuste = r?.ajuste.transformacion;
    // El cuello real va encima de una prenda superior o vestido ajustado (no con el tejido sobre camiseta base).
    final cuello =
        r != null &&
            ajuste != null &&
            _imagenMaterial == null &&
            tipoDePrenda(widget.producto.categoria) != TipoPrenda.pantalon
        ? regionCuello(r.pose.puntos)
        : null;
    return AspectRatio(
      aspectRatio: 3 / 4,
      child: ClipRect(
        key: const ValueKey('visor-probador'),
        child: ColoredBox(
          color: t.colorScheme.surfaceContainerHigh,
          child: _analizando
              ? const Center(child: CircularProgressIndicator())
              : r == null
              ? Center(
                  child: Opacity(
                    opacity: 0.35,
                    child: SvgPicture.asset(
                      recursoPrenda(
                        widget.producto.categoria,
                        sku: widget.producto.sku,
                        probador: true,
                      ),
                      width: 180,
                      excludeFromSemantics: true,
                    ),
                  ),
                )
              : Semantics(
                  image: true,
                  label: r.ajuste.ajustado
                      ? 'Tu foto con una vista aproximada de ${widget.producto.nombre}'
                      : 'Tu foto; no se pudo ajustar la prenda',
                  child: FittedBox(
                    fit: BoxFit.contain,
                    child: SizedBox(
                      width: r.pose.ancho.toDouble(),
                      height: r.pose.alto.toDouble(),
                      child: Stack(
                        clipBehavior: Clip.hardEdge,
                        children: [
                          Positioned.fill(
                            child: Image.memory(
                              _imagenMaterial ?? r.imagen,
                              fit: BoxFit.fill,
                              gaplessPlayback: true,
                            ),
                          ),
                          if (_pintura != null)
                            Positioned.fill(
                              child: CustomPaint(
                                painter: PintorPrendaArticulada(_pintura!),
                              ),
                            )
                          else if (ajuste != null &&
                              !(_materialDisponible && _usarMaterial))
                            Positioned(
                              left: 0,
                              top: 0,
                              child: Transform(
                                transform: Matrix4.identity()
                                  ..translateByDouble(ajuste.x, ajuste.y, 0, 1)
                                  ..rotateZ(ajuste.angulo)
                                  ..scaleByDouble(
                                    ajuste.escalaX,
                                    ajuste.escalaY,
                                    1,
                                    1,
                                  )
                                  ..translateByDouble(
                                    -ajuste.origenX,
                                    -ajuste.origenY,
                                    0,
                                    1,
                                  ),
                                child: _textura != null
                                    ? Image.memory(
                                        _textura!,
                                        width: widget
                                            .producto
                                            .recursoProbador!
                                            .ancho
                                            .toDouble(),
                                        height: widget
                                            .producto
                                            .recursoProbador!
                                            .alto
                                            .toDouble(),
                                        fit: BoxFit.fill,
                                        excludeFromSemantics: true,
                                      )
                                    : SvgPicture.asset(
                                        recursoPrenda(
                                          widget.producto.categoria,
                                          sku: widget.producto.sku,
                                          probador: true,
                                        ),
                                        width: anchoIlustracion,
                                        height: altoIlustracion,
                                        excludeFromSemantics: true,
                                      ),
                              ),
                            ),
                          if (cuello != null)
                            Positioned.fill(
                              child: ClipPath(
                                clipper: RecorteCuello(cuello),
                                child: Image.memory(
                                  r.imagen,
                                  fit: BoxFit.fill,
                                  gaplessPlayback: true,
                                  excludeFromSemantics: true,
                                ),
                              ),
                            ),
                          if (_puntos)
                            Positioned.fill(
                              child: CustomPaint(painter: _Puntos(r.pose)),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
        ),
      ),
    );
  }

  Widget _formulario() {
    const etiquetas = {
      'altura_cm': 'Altura (cm)',
      'peso_kg': 'Peso (kg)',
      'pecho_cm': 'Pecho (cm)',
      'cintura_cm': 'Cintura (cm)',
    };
    Widget campo(String c) => TextField(
      controller: _medidas[c],
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textInputAction: c == 'cintura_cm'
          ? TextInputAction.done
          : TextInputAction.next,
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
      decoration: InputDecoration(labelText: etiquetas[c]),
      onSubmitted: (_) => _calcular(),
    );
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: campo('altura_cm')),
            const SizedBox(width: 12),
            Expanded(child: campo('peso_kg')),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: campo('pecho_cm')),
            const SizedBox(width: 12),
            Expanded(child: campo('cintura_cm')),
          ],
        ),
      ],
    );
  }

  Widget _recomendacion(ThemeData t, RecomendacionTalla r) {
    final talla = r.talla;
    final enPrenda = widget.variantes
        .where(
          (v) =>
              v.talla == talla &&
              v.disponible > 0 &&
              (widget.producto.recursoProbador == null ||
                  v.color == widget.producto.recursoProbador!.color),
        )
        .map((v) => v.color)
        .toList();
    final orden = r.probabilidades.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                r.alternativa == null ? talla : '$talla / ${r.alternativa}',
                style: t.textTheme.displaySmall?.copyWith(
                  color: t.colorScheme.primary,
                ),
              ),
              const SizedBox(width: 12),
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  r.alternativa == null ? 'tu talla' : 'entre dos tallas',
                  style: t.textTheme.titleSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final e in orden.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  SizedBox(
                    width: 32,
                    child: Text(e.key, style: t.textTheme.labelLarge),
                  ),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: e.value,
                      minHeight: 4,
                      backgroundColor: t.colorScheme.outlineVariant,
                      borderRadius: BorderRadius.zero,
                    ),
                  ),
                  SizedBox(
                    width: 48,
                    child: Text(
                      '${(e.value * 100).round()} %',
                      textAlign: TextAlign.end,
                      style: t.textTheme.labelMedium,
                    ),
                  ),
                ],
              ),
            ),
          if (r.tallaPorTabla != talla)
            Text(
              'Por la tabla de tallas (solo pecho) serías ${r.tallaPorTabla}.',
              style: t.textTheme.bodySmall,
            ),
          const SizedBox(height: 12),
          Text(
            enPrenda.isEmpty
                ? 'Esta prenda no tiene talla $talla disponible.'
                : 'Talla $talla disponible en ${enPrenda.join(', ')}.',
            style: t.textTheme.bodyMedium,
          ),
          if (enPrenda.isNotEmpty) ...[
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(talla),
              child: Text('Elegir talla $talla'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _tablaReferencia(ThemeData t) => Padding(
    padding: const EdgeInsets.only(top: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'El modelo de tallas aún no está en el teléfono (se descarga con la primera conexión). Mientras tanto, '
          'guíate por la tabla con una cinta métrica:',
          style: t.textTheme.bodyMedium,
        ),
        const SizedBox(height: 8),
        for (final e in tablaReferencia.entries)
          Text(
            '${e.key}: pecho ${e.value.$1.$1}–${e.value.$1.$2} · cintura ${e.value.$2.$1}–${e.value.$2.$2} cm',
            style: t.textTheme.bodySmall,
          ),
      ],
    ),
  );

  Widget _privacidad(ThemeData t) {
    final modelo = widget.estado.modeloTallas;
    final apagado = t.textTheme.bodySmall?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              Icons.lock_outline,
              size: 18,
              color: t.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _modoGenerativo
                    ? 'La fotografía con IA utiliza el servidor de CLB. Tus medidas se calculan en el teléfono.'
                    : 'La foto y tus medidas no salen del teléfono.',
                style: t.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          'Pose: ${_probador?.modelo ?? 'MoveNet Lightning v4 · TensorFlow Lite'}',
          style: apagado,
        ),
        Text(
          modelo == null
              ? 'Tallas: sin modelo guardado'
              : 'Tallas: regresión logística v${modelo.version}, exactitud ${(modelo.exactitud * 100).toStringAsFixed(1).replaceAll('.', ',')} % · guardado en el teléfono',
          style: apagado,
        ),
      ],
    );
  }
}

class _Puntos extends CustomPainter {
  _Puntos(this.pose);
  final Pose pose;

  @override
  void paint(Canvas canvas, Size size) {
    final radio = max(pose.ancho, pose.alto) / 120;
    final relleno = Paint()..color = const Color(0xFFAA703B);
    final borde = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = radio / 2.5;
    for (final p in pose.puntos.where((p) => p.confianza >= confianzaMinima)) {
      canvas
        ..drawCircle(Offset(p.x, p.y), radio, relleno)
        ..drawCircle(Offset(p.x, p.y), radio, borde);
    }
  }

  @override
  bool shouldRepaint(_Puntos old) => old.pose != pose;
}
