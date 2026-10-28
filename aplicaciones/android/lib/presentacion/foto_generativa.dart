import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../dominio/modelos.dart';
import '../dominio/pose.dart';
import '../dominio/cola_generaciones.dart';
import 'estado_tienda.dart';

class FotoGenerativa extends StatefulWidget {
  const FotoGenerativa({
    super.key,
    required this.estado,
    required this.producto,
  });
  final EstadoTienda estado;
  final Producto producto;
  @override
  State<FotoGenerativa> createState() => _FotoGenerativaState();
}

class _FotoGenerativaState extends State<FotoGenerativa> {
  Uint8List? _foto, _resultado;
  String _estado = '', _error = '';
  bool _ocupado = false;
  int _turno = 0;
  int _lectura = 0;
  List<TrabajoGeneracion> _trabajos = const [];
  StreamSubscription<void>? _cambios;

  @override
  void initState() {
    super.initState();
    _cambios = widget.estado.colaFotografica?.cambios.listen(
      (_) => _cargarCola(),
    );
    widget.estado.addListener(_cargarCola);
    unawaited(_cargarCola());
  }

  Future<void> _cargarCola() async {
    final lectura = ++_lectura;
    try {
      final trabajos = await widget.estado.colaFotografica?.listar() ?? [];
      if (mounted && lectura == _lectura) {
        setState(
          () => _trabajos = trabajos
              .where(
                (t) =>
                    t.producto.identificador == widget.producto.identificador,
              )
              .toList(),
        );
      }
    } catch (_) {
      if (mounted && lectura == _lectura) {
        setState(() => _error = 'No se pudo leer la cola del teléfono.');
      }
    }
  }

  @override
  void dispose() {
    _turno++;
    _cambios?.cancel();
    widget.estado.removeListener(_cargarCola);
    super.dispose();
  }

  /// Cámara o galería: la foto queda en el teléfono hasta pulsar «Generar»; la cola de envío es la misma en ambos casos.
  Future<void> _elegir(bool camara) async {
    try {
      final foto = await widget.estado.elegirFoto(camara);
      if (mounted && foto != null) {
        setState(() {
          _foto = foto;
          _resultado = null;
          _error = '';
          _estado = '';
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'No se pudo abrir la fotografía.');
    }
  }

  Future<void> _generar() async {
    if (_foto == null) return;
    final turno = ++_turno;
    bool vigente() => mounted && turno == _turno;
    setState(() {
      _ocupado = true;
      _error = '';
      _resultado = null;
      _estado = 'Preparando la prenda…';
    });
    try {
      var prenda = await widget.estado.textura(widget.producto);
      if (prenda == null && fotografiaPrenda(widget.producto.sku) != null) {
        prenda = (await rootBundle.load(
          recursoPrenda(widget.producto.categoria, sku: widget.producto.sku),
        )).buffer.asUint8List();
      }
      if (prenda == null) {
        throw StateError(
          'Esta prenda necesita una fotografía publicada y descargada.',
        );
      }
      final cola = widget.estado.colaFotografica;
      if (cola != null) {
        await cola.encolar(_foto!, prenda, widget.producto);
        if (vigente()) {
          setState(
            () => _estado =
                'Solicitud guardada. Se procesará automáticamente al conectar con CLB.',
          );
        }
        await _cargarCola();
        return;
      }
      final resultado = await widget.estado.probadorFotografico!.generar(
        _foto!,
        prenda,
        widget.producto,
        (mensaje) {
          if (vigente()) setState(() => _estado = mensaje);
        },
        vigente,
      );
      if (vigente()) setState(() => _resultado = resultado);
    } catch (error) {
      if (vigente()) {
        setState(() {
          _estado = '';
          _error = error.toString().replaceFirst('Bad state: ', '');
        });
      }
    } finally {
      if (vigente()) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Probar sobre una fotografía',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const Text(
          'Una persona de frente, con torso y ambos brazos visibles hasta las muñecas. Para pantalones y vestidos, incluye las piernas completas.',
        ),
        const SizedBox(height: 12),
        const Text(
          'Al generar, guardamos tu foto y la prenda en este teléfono para enviarlas automáticamente al servidor de CLB cuando haya conexión. La cola se reanuda al abrir la app; conserva hasta cuatro solicitudes pendientes. La foto original se elimina de la cola al terminar o al eliminar la solicitud. El resultado queda en el servidor hasta 24 horas y en el teléfono para verlo sin conexión.',
        ),
        const SizedBox(height: 12),
        if (_foto != null) ...[
          ClipRRect(
            borderRadius: const BorderRadius.all(Radius.circular(2)),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240),
              child: Image.memory(
                _foto!,
                fit: BoxFit.contain,
                semanticLabel: 'Tu fotografía elegida',
                errorBuilder: (_, _, _) =>
                    const Text('No se pudo mostrar la fotografía. Elige otra.'),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _ocupado ? null : () => _elegir(true),
                icon: const Icon(Icons.photo_camera_outlined),
                label: Text(_foto == null ? 'Tomar foto' : 'Otra foto'),
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
        const SizedBox(height: 8),
        FilledButton(
          onPressed: _foto == null || _ocupado ? null : _generar,
          child: const Text('Generar imagen'),
        ),
        if (_ocupado) ...[
          const SizedBox(height: 8),
          const LinearProgressIndicator(
            semanticsLabel: 'Preparando la solicitud',
          ),
        ],
        if (_ocupado)
          TextButton(
            onPressed: () {
              _turno++;
              setState(() {
                _ocupado = false;
                _estado =
                    'Se dejó de esperar. El servidor puede terminar; vuelve a generar para recuperar el resultado.';
              });
            },
            child: const Text('Dejar de esperar'),
          ),
        TextButton(
          onPressed: _ocupado
              ? null
              : () async {
                  final confirmado = await showDialog<bool>(
                    context: context,
                    builder: (contexto) => AlertDialog(
                      title: const Text('¿Borrar las imágenes del probador?'),
                      content: const Text(
                        'Se eliminan de este teléfono los resultados y las solicitudes pendientes con tu foto. No se puede deshacer.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(contexto, false),
                          child: const Text('Cancelar'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(contexto, true),
                          child: const Text('Borrar'),
                        ),
                      ],
                    ),
                  );
                  if (confirmado != true) return;
                  try {
                    await widget.estado.probadorFotografico!.borrarGuardadas();
                    await widget.estado.colaFotografica?.borrarResultados();
                    await _cargarCola();
                    if (mounted) {
                      setState(() {
                        _resultado = null;
                        _error = '';
                        _estado =
                            'Se borraron las imágenes de este teléfono. Las copias en CLB se borrarán al conectar.';
                      });
                    }
                  } catch (_) {
                    if (mounted) {
                      setState(
                        () => _error =
                            'No se pudo acceder al almacenamiento local.',
                      );
                    }
                  }
                },
          child: const Text('Borrar imágenes del teléfono'),
        ),
        if (_estado.isNotEmpty)
          Semantics(liveRegion: true, child: Text(_estado)),
        if (_error.isNotEmpty)
          Semantics(
            liveRegion: true,
            child: Text(
              _error,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        if (_trabajos.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(
            'Solicitudes de esta prenda',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const Text(
            'Los reintentos continúan con la app abierta. Si la cierras, las solicitudes se conservan y se reanudan al volver.',
          ),
          if (widget.estado.colaFotografica?.errorAlmacenamiento != null)
            Text(
              widget.estado.colaFotografica!.errorAlmacenamiento!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          for (final trabajo in _trabajos.reversed)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(switch (trabajo.estado) {
                      'PENDIENTE' => 'En el teléfono · pendiente de envío',
                      'ENVIANDO' => 'Conectando o procesando en CLB…',
                      'LISTO' => 'Resultado disponible sin conexión',
                      _ => 'Requiere revisión',
                    }, style: Theme.of(context).textTheme.titleSmall),
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        widget.estado.colaFotografica?.avance(trabajo.clave) ??
                            trabajo.mensaje,
                      ),
                    ),
                    if (trabajo.rutaResultado != null)
                      Image.file(
                        File(trabajo.rutaResultado!),
                        semanticLabel: 'Prenda generada sobre tu fotografía',
                        errorBuilder: (_, _, _) =>
                            const Text('No se pudo abrir esta imagen.'),
                      ),
                    if (trabajo.estado == 'ERROR')
                      TextButton(
                        onPressed: () => _accionCola(trabajo, true),
                        child: const Text('Reintentar solicitud'),
                      ),
                    TextButton(
                      onPressed: () => _accionCola(trabajo, false),
                      child: const Text('Eliminar de la lista'),
                    ),
                  ],
                ),
              ),
            ),
          const Text(
            'Simulación generada con IA. Revisa el diseño y la anatomía; el tono y los estampados pueden variar.',
          ),
        ],
        if (_resultado != null) ...[
          Image.memory(
            _resultado!,
            errorBuilder: (context, error, pila) => const Text(
              'No se pudo abrir el resultado. Borra las imágenes locales y vuelve a generarlo.',
            ),
            semanticLabel: 'Prenda sobre tu fotografía, generada con IA',
          ),
          const Text(
            'Simulación generada con IA. Revisa el diseño y la anatomía; no determina el ajuste físico ni garantiza reproducir cada estampado.',
          ),
        ],
      ],
    ),
  );

  Future<void> _accionCola(TrabajoGeneracion trabajo, bool reintentar) async {
    try {
      if (reintentar) {
        await widget.estado.colaFotografica!.reintentar(trabajo);
      } else {
        await widget.estado.colaFotografica!.eliminar(trabajo);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'No se pudo actualizar la solicitud guardada.');
      }
    }
  }
}
