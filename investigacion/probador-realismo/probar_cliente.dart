import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import '../../aplicaciones/android/lib/dominio/material_camiseta.dart';
import '../../aplicaciones/android/lib/dominio/pose.dart';

void main(List<String> argumentos) {
  final ruta =
      '${argumentos.isEmpty ? 'temporales/laboratorio-realismo' : argumentos.first}/';
  if (!Directory(
    ruta,
  ).absolute.path.startsWith(Directory('temporales').absolute.path)) {
    throw const FormatException(
      'Los datos privados deben permanecer en temporales',
    );
  }
  final d =
      jsonDecode(File('${ruta}datos-cliente.json').readAsStringSync())
          as Map<String, dynamic>;
  final material = prepararMaterialCamiseta(
    RasterMaterial(
      d['texturaAncho'],
      d['texturaAlto'],
      File('${ruta}textura-cliente.rgba').readAsBytesSync(),
    ),
    Map<String, dynamic>.from(d['anclas']),
  );
  final probabilidades = Float32List.sublistView(
    File('${ruta}probabilidades.f32').readAsBytesSync(),
  );
  final pose = [
    for (final v in d['pose'])
      PuntoClave(
        (v['x'] as num).toDouble(),
        (v['y'] as num).toDouble(),
        (v['confianza'] as num).toDouble(),
      ),
  ];
  final reloj = Stopwatch()..start();
  final resultado = transferirMaterialCamiseta(
    RasterMaterial(
      d['ancho'],
      d['alto'],
      File('${ruta}foto-cliente.rgba').readAsBytesSync(),
    ),
    probabilidades,
    pose,
    material,
  );
  File('${ruta}resultado-dart.rgba').writeAsBytesSync(resultado.rgba);
  final esperado = File('${ruta}resultado-cliente.rgba').readAsBytesSync();
  var maximo = 0, suma = 0;
  for (var i = 0; i < esperado.length; i++) {
    final e = (esperado[i] - resultado.rgba[i]).abs();
    if (e > maximo) {
      maximo = e;
    }
    suma += e;
  }
  final informe = {
    'raster': 'TS vs Dart, misma foto/pose/probabilidades',
    'valores': esperado.length,
    'error_maximo': maximo,
    'error_medio': suma / esperado.length,
    'segundos_dart_jit': reloj.elapsedMilliseconds / 1000,
    'telefono': false,
  };
  File(
    '${ruta}paridad-raster.json',
  ).writeAsStringSync('${jsonEncode(informe)}\n');
  stdout.writeln(jsonEncode(informe));
  if (maximo > 3) {
    exitCode = 1;
  }
}
