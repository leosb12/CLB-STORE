import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:record/record.dart';
import 'package:sqflite/sqflite.dart';

import 'estado_gestion.dart';

/// ¿Se puede dictar aquí? Grabar AAC en el teléfono y transcribir en el servidor (faster-whisper local de CLB).
Future<bool> vozDisponible(EstadoGestion g) async {
  if (!g.conectada) return false;
  final grabadora = AudioRecorder();
  try {
    return await grabadora.isEncoderSupported(AudioEncoder.aacLc);
  } on Object {
    return false;
  } finally {
    await grabadora.dispose();
  }
}

/// Toca para dictar y vuelve a tocar para terminar: el audio se transcribe y el texto queda editable antes de enviarlo
/// (es un dato, no una instrucción). El archivo de audio se borra del teléfono al terminar.
class BotonMicrofono extends StatefulWidget {
  const BotonMicrofono(this.g, this.alTexto, {super.key});
  final EstadoGestion g;
  final void Function(String texto) alTexto;

  @override
  State<BotonMicrofono> createState() => _BotonMicrofonoState();
}

class _BotonMicrofonoState extends State<BotonMicrofono> {
  final _grabadora = AudioRecorder();
  bool _grabando = false, _transcribiendo = false;
  String? _ruta;

  @override
  void dispose() {
    _grabadora.dispose();
    final ruta = _ruta;
    if (ruta != null) File(ruta).delete().ignore();
    super.dispose();
  }

  Future<void> _alternar() async {
    final mensajero = ScaffoldMessenger.of(context);
    try {
      if (!_grabando) {
        if (!await _grabadora.hasPermission()) {
          mensajero.showSnackBar(
            const SnackBar(
              content: Text('Permite el micrófono para dictar el reporte.'),
            ),
          );
          return;
        }
        _ruta = p.join(await getDatabasesPath(), 'clb_voz.m4a');
        await _grabadora.start(
          const RecordConfig(
            encoder: AudioEncoder.aacLc,
            sampleRate: 16000,
            numChannels: 1,
          ),
          path: _ruta!,
        );
        setState(() => _grabando = true);
        return;
      }
      final ruta = await _grabadora.stop();
      setState(() {
        _grabando = false;
        _transcribiendo = true;
      });
      if (ruta == null) return;
      final archivo = File(ruta);
      final audio = await archivo.readAsBytes();
      await archivo.delete();
      widget.alTexto(await widget.g.transcribir(audio));
    } on Object catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(explicar(e))));
    } finally {
      if (mounted) setState(() => _transcribiendo = false);
    }
  }

  @override
  Widget build(BuildContext context) => _transcribiendo
      ? const Padding(
          padding: EdgeInsets.all(12),
          child: SizedBox.square(
            dimension: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        )
      : IconButton(
          tooltip: _grabando ? 'Terminar y transcribir' : 'Dictar el reporte',
          onPressed: _alternar,
          icon: Icon(
            _grabando ? Icons.stop_circle_outlined : Icons.mic_none,
            color: _grabando ? Theme.of(context).colorScheme.error : null,
          ),
        );
}
