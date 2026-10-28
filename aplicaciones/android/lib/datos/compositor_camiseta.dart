import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:image/image.dart' as img;
import 'package:tflite_flutter/tflite_flutter.dart';
import '../dominio/contratos.dart';
import '../dominio/pose.dart';
import '../dominio/material_camiseta.dart';

/// Modelo empaquetado y verificado; inferencia y composición fuera del hilo UI.
class CompositorCamisetaLocal implements CompositorCamiseta {
  static bool _ocupado = false;
  static const recurso = 'assets/modelos/selfie-multiclass-1.tflite';
  static const huella =
      'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0';
  Future<Uint8List>? _modelo;
  Future<Uint8List> _cargar() {
    final carga = _modelo ??= rootBundle.load(recurso).then((v) {
      final bytes = v.buffer.asUint8List(v.offsetInBytes, v.lengthInBytes);
      if (sha256.convert(bytes).toString() != huella) {
        throw const FormatException(
          'El modelo de camiseta no pasó la comprobación de integridad.',
        );
      }
      return bytes;
    });
    return carga.catchError((Object e) {
      _modelo = null;
      throw e;
    });
  }

  @override
  Future<Uint8List> componer(
    Uint8List foto,
    Uint8List textura,
    Map<String, dynamic> anclas,
    Pose pose,
  ) async {
    if (_ocupado) {
      throw const FormatException(
        'Espera a que termine el análisis anterior y vuelve a elegir la foto.',
      );
    }
    _ocupado = true;
    try {
      final modelo = await _cargar();
      return await Isolate.run(
        () => _componer(modelo, foto, textura, anclas, pose),
      );
    } finally {
      _ocupado = false;
    }
  }
}

Uint8List _componer(
  Uint8List modelo,
  Uint8List bytes,
  Uint8List textura,
  Map<String, dynamic> anclas,
  Pose pose,
) {
  final original = img.decodeImage(bytes), producto = img.decodeImage(textura);
  if (original == null || producto == null) {
    throw const FormatException('No se pudo leer la fotografía.');
  }
  final foto = img.bakeOrientation(original),
      pequena = img.copyResize(
        foto,
        width: 256,
        height: 256,
        interpolation: img.Interpolation.linear,
      );
  final entrada = Float32List(256 * 256 * 3),
      rgb = pequena.getBytes(order: img.ChannelOrder.rgb);
  for (var i = 0; i < entrada.length; i++) {
    entrada[i] = (rgb[i] - 127.5) / 127.5;
  }
  final opciones = InterpreterOptions()..threads = 2;
  Interpreter? interprete;
  late Float32List salida;
  try {
    interprete = Interpreter.fromBuffer(modelo, options: opciones);
    if (interprete.getInputTensor(0).shape.join(',') != '1,256,256,3' ||
        interprete.getOutputTensor(0).shape.join(',') != '1,256,256,6') {
      throw const FormatException('Modelo semántico incompatible.');
    }
    interprete.getInputTensor(0).data = entrada.buffer.asUint8List();
    interprete.invoke();
    salida = Float32List.fromList(
      Float32List.sublistView(
        Uint8List.fromList(interprete.getOutputTensor(0).data),
      ),
    );
  } finally {
    interprete?.close();
    opciones.delete();
  }
  for (var i = 0; i < salida.length; i += 6) {
    var max = -double.infinity, suma = 0.0;
    for (var k = 0; k < 6; k++) {
      max = math.max(max, salida[i + k]);
    }
    for (var k = 0; k < 6; k++) {
      salida[i + k] = math.exp(salida[i + k] - max);
      suma += salida[i + k];
    }
    for (var k = 0; k < 6; k++) {
      salida[i + k] /= suma;
    }
  }
  final material = prepararMaterialCamiseta(
    RasterMaterial(
      producto.width,
      producto.height,
      producto.getBytes(order: img.ChannelOrder.rgba),
    ),
    anclas,
  );
  final resultado = transferirMaterialCamiseta(
    RasterMaterial(
      foto.width,
      foto.height,
      foto.getBytes(order: img.ChannelOrder.rgba),
    ),
    salida,
    pose.puntos,
    material,
  );
  final imagen = img.Image.fromBytes(
    width: resultado.ancho,
    height: resultado.alto,
    bytes: resultado.rgba.buffer,
    numChannels: 4,
    order: img.ChannelOrder.rgba,
  );
  return Uint8List.fromList(img.encodePng(imagen));
}
