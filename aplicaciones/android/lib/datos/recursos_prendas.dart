import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import '../dominio/recurso_probador.dart';

/// Archivos privados por hash; SQLite solo activa el manifiesto cuando todos están disponibles.
class RecursosPrendas implements FuenteRecursosPrendas {
  RecursosPrendas(
    this.directorio,
    this.httpCliente,
    this.pasarela, {
    this.espacioDisponible,
  });
  final String directorio;
  final http.Client httpCliente;
  final String pasarela;
  final Future<int?> Function()? espacioDisponible;

  File _archivo(RecursoProbador r) => File(p.join(directorio, '${r.hash}.png'));

  bool _valido(Uint8List datos, RecursoProbador r) =>
      datos.length == r.bytes &&
      datos.length >= 26 &&
      datos[0] == 137 &&
      datos[1] == 80 &&
      datos[2] == 78 &&
      datos[3] == 71 &&
      datos[25] == 6 &&
      ByteData.sublistView(datos).getUint32(16) == r.ancho &&
      ByteData.sublistView(datos).getUint32(20) == r.alto &&
      sha256.convert(datos).toString() == r.hash;

  @override
  Future<Uint8List?> leer(RecursoProbador r) async {
    final archivo = _archivo(r);
    if (!await archivo.exists() || await archivo.length() != r.bytes)
      return null;
    final datos = await archivo.readAsBytes();
    return _valido(datos, r) ? datos : null;
  }

  @override
  Future<void> preparar(List<Producto> productos) async {
    // La espalda del modelo 3D se descarga y verifica como la frontal: la RA también funciona sin red.
    final recursos = <String, RecursoProbador>{};
    for (final r in productos.map((p) => p.recursoProbador).nonNulls) {
      for (final x in [r, ?r.espalda]) {
        recursos[x.hash] = x;
      }
    }
    final libres = await espacioDisponible?.call();
    if (libres != null &&
        libres < recursos.values.fold(0, (n, r) => n + r.bytes) * 2) {
      throw const FileSystemException(
        'No hay espacio para el nuevo paquete fotográfico.',
      );
    }
    await Directory(directorio).create(recursive: true);
    for (final r in recursos.values) {
      if (await leer(r) != null) continue;
      final respuesta = await httpCliente
          .send(http.Request('GET', Uri.parse('$pasarela${r.ruta}')))
          .timeout(const Duration(seconds: 20));
      if (respuesta.statusCode != 200 ||
          respuesta.headers['content-type']?.split(';').first != 'image/png') {
        await respuesta.stream.listen((_) {}).cancel();
        throw SinConexion('No se pudo descargar una textura publicada.');
      }
      final contenido = BytesBuilder(copy: false);
      await for (final parte in respuesta.stream.timeout(
        const Duration(seconds: 20),
      )) {
        contenido.add(parte);
        if (contenido.length > r.bytes)
          throw const FormatException('La textura supera el tamaño declarado.');
      }
      final datos = contenido.takeBytes();
      if (!_valido(datos, r))
        throw const FormatException(
          'La textura no coincide con su manifiesto.',
        );
      final temporal = File(
        p.join(directorio, '.${r.hash}.${nuevoUuid()}.tmp'),
      );
      try {
        await temporal.writeAsBytes(datos, flush: true);
        await temporal.rename(_archivo(r).path);
      } finally {
        if (await temporal.exists()) await temporal.delete();
      }
    }
  }
}
