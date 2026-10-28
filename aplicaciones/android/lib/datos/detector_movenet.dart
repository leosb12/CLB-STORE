import 'dart:isolate';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';

import '../dominio/contratos.dart';
import '../dominio/pose.dart';

/// MoveNet SinglePose Lightning v4 (TensorFlow Lite float16, Apache 2.0) empaquetado en la app: la pose se estima en el
/// teléfono, sin red. Mismo modelo que el probador web (allí en TF.js).
class DetectorMoveNet implements DetectorPose {
  DetectorMoveNet._(this._interprete);

  static const recurso = 'assets/modelos/movenet-lightning-4.tflite';
  static const lado = 192;

  final Interpreter _interprete;

  static Future<DetectorMoveNet> cargar() async {
    final opciones = InterpreterOptions()..threads = 2;
    try {
      // El constructor de Interpreter ya reserva los tensores.
      return DetectorMoveNet._(
        await Interpreter.fromAsset(recurso, options: opciones),
      );
    } finally {
      opciones.delete();
    }
  }

  @override
  String get modelo => 'MoveNet Lightning v4 · TensorFlow Lite en el teléfono';

  @override
  Future<(Pose, Uint8List)> detectar(Uint8List imagen) async {
    // Decodificar y redimensionar una foto de cámara tarda: fuera del hilo de la interfaz.
    final entrada = await Isolate.run(() => prepararImagen(imagen));
    final tensor = _interprete.getInputTensor(0);
    tensor.data = tensor.type == TensorType.float32
        ? Float32List.fromList([
            for (final v in entrada.rgb) v.toDouble(),
          ]).buffer.asUint8List()
        : entrada.rgb;
    _interprete.invoke();
    final salida = Float32List.sublistView(
      Uint8List.fromList(_interprete.getOutputTensor(0).data),
    );
    return (
      Pose(
        puntosDesdeSalida(salida, entrada.ancho, entrada.alto),
        entrada.ancho,
        entrada.alto,
      ),
      entrada.jpg,
    );
  }

  void cerrar() => _interprete.close();
}

class ImagenPreparada {
  const ImagenPreparada(this.rgb, this.ancho, this.alto, this.jpg);

  /// 192 × 192 × 3 bytes RGB para MoveNet.
  final Uint8List rgb;

  /// Tamaño de la imagen orientada (la que se muestra y sobre la que se expresan los puntos).
  final int ancho, alto;
  final Uint8List jpg;
}

/// Orienta por EXIF, limita a 1280 px, rellena a cuadrado (arriba a la izquierda, sin deformar) y reduce a 192 × 192.
ImagenPreparada prepararImagen(Uint8List bytes, {int ladoMaximo = 1280}) {
  final decodificada = img.decodeImage(bytes);
  if (decodificada == null)
    throw const FormatException('No se pudo leer la imagen.');
  var orientada = img.bakeOrientation(decodificada);
  if (orientada.width > ladoMaximo || orientada.height > ladoMaximo) {
    orientada = orientada.width >= orientada.height
        ? img.copyResize(orientada, width: ladoMaximo)
        : img.copyResize(orientada, height: ladoMaximo);
  }
  final ladoCuadrado = orientada.width > orientada.height
      ? orientada.width
      : orientada.height;
  final cuadrada = img.Image(
    width: ladoCuadrado,
    height: ladoCuadrado,
    numChannels: 3,
  );
  img.compositeImage(cuadrada, orientada, dstX: 0, dstY: 0);
  final reducida = img.copyResize(
    cuadrada,
    width: DetectorMoveNet.lado,
    height: DetectorMoveNet.lado,
    interpolation: img.Interpolation.linear,
  );
  return ImagenPreparada(
    reducida.getBytes(order: img.ChannelOrder.rgb),
    orientada.width,
    orientada.height,
    img.encodeJpg(orientada, quality: 88),
  );
}

/// Salida [1, 1, 17, 3] = (y, x, confianza) normalizados al cuadrado relleno → píxeles de la imagen orientada.
List<PuntoClave> puntosDesdeSalida(Float32List salida, int ancho, int alto) {
  if (salida.length != 17 * 3)
    throw FormatException('MoveNet devolvió ${salida.length} valores.');
  final lado = (ancho > alto ? ancho : alto).toDouble();
  return [
    for (var i = 0; i < 17; i++)
      PuntoClave(
        salida[i * 3 + 1] * lado,
        salida[i * 3] * lado,
        salida[i * 3 + 2],
      ),
  ];
}
