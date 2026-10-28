import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import '../dominio/contratos.dart';
import '../dominio/modelos.dart';
import '../dominio/probador_fotografico.dart';
import '../dominio/cola_generaciones.dart';
import 'rest.dart';

class ProbadorFotograficoRest implements ProbadorFotografico {
  ProbadorFotograficoRest(
    this.sesion,
    this.directorio,
    this.cliente, {
    this.base = pasarela,
  });
  final Sesion sesion;
  final String directorio, base;
  final http.Client cliente;

  Future<Map<String, String>> _cabeceras(String titular) async {
    if ((await sesion.titular())?.sub != titular) {
      throw ErrorGeneracionFotografica(
        'La sesión cambió. Abre de nuevo el probador.',
        reintentable: true,
        red: true,
      );
    }
    final token = await sesion.tokenVigente();
    if (token == null || (await sesion.titular())?.sub != titular) {
      throw ErrorGeneracionFotografica(
        'Tu sesión venció. Inicia sesión para continuar; la solicitud sigue guardada.',
        reintentable: true,
        red: true,
      );
    }
    return {'Authorization': 'Bearer $token'};
  }

  Map<String, dynamic> _datos(http.Response respuesta) {
    final datos =
        jsonDecode(utf8.decode(respuesta.bodyBytes)) as Map<String, dynamic>;
    if (respuesta.statusCode >= 300) {
      // 401, caído u ocupado: sin tope de intentos porque el servidor no llegó a generar nada.
      // 404 al consultar: el servidor perdió el trabajo y se reenvía.
      final noDisponible = [
        401,
        408,
        425,
        429,
        502,
        503,
        504,
      ].contains(respuesta.statusCode);
      throw ErrorGeneracionFotografica(
        respuesta.statusCode == 401
            ? 'Tu sesión venció. Inicia sesión para continuar; la solicitud sigue guardada.'
            : noDisponible
            ? 'El servidor de imágenes no está disponible ahora. Tu foto sigue guardada y se reintentará.'
            : datos['mensaje'] as String? ?? 'No se pudo generar la imagen.',
        reintentable:
            respuesta.statusCode >= 500 ||
            noDisponible ||
            respuesta.statusCode == 404,
        red: noDisponible,
      );
    }
    return datos;
  }

  @override
  Future<Uint8List> generar(
    Uint8List persona,
    Uint8List prenda,
    Producto producto,
    void Function(String) progreso,
    bool Function() vigente, {
    String? titularEsperado,
  }) async {
    if (persona.length > 8 * 1024 * 1024) {
      throw StateError('La foto supera 8 MB.');
    }
    final titular = (await sesion.titular())?.sub;
    if (titular == null) {
      throw ErrorGeneracionFotografica(
        'Inicia sesión para utilizar el probador fotográfico.',
        reintentable: true,
      );
    }
    if (titularEsperado != null && titular != titularEsperado) {
      throw ErrorGeneracionFotografica(
        'La solicitud pertenece a otra sesión.',
        reintentable: true,
      );
    }
    final clave = sha256
        .convert(
          utf8.encode(
            jsonEncode([
              versionMotorFotografico,
              titular,
              sha256.convert(persona).toString(),
              producto.identificador,
              sha256.convert(prenda).toString(),
              producto.categoria,
            ]),
          ),
        )
        .toString();
    await Directory(directorio).create(recursive: true);
    final archivo = File(p.join(directorio, '$clave.png'));
    if (await archivo.exists()) {
      progreso('Resultado guardado en este teléfono');
      return archivo.readAsBytes();
    }
    if (!vigente()) throw StateError('Se dejó de esperar.');
    try {
      final solicitud =
          http.MultipartRequest(
              'POST',
              Uri.parse('$base/api/v1/probador/trabajos'),
            )
            ..headers.addAll(await _cabeceras(titular))
            ..fields.addAll({
              'identificador': producto.identificador,
              'categoria': producto.categoria,
            })
            ..files.addAll([
              http.MultipartFile.fromBytes(
                'persona',
                persona,
                filename: 'persona.jpg',
              ),
              http.MultipartFile.fromBytes(
                'prenda',
                prenda,
                filename: 'prenda.png',
              ),
            ]);
      progreso('Enviando fotografías al servidor configurado…');
      var trabajo = _datos(
        await http.Response.fromStream(
          await cliente.send(solicitud).timeout(const Duration(seconds: 60)),
        ).timeout(const Duration(seconds: 60)),
      );
      final inicio = DateTime.now();
      while (trabajo['estado'] != 'LISTO') {
        if (!vigente()) throw StateError('Se dejó de esperar.');
        if (trabajo['estado'] == 'ERROR') {
          // Fallo del servidor (worker caído, GPU sin memoria, reinicio): la foto sigue en el teléfono y se reenvía.
          throw ErrorGeneracionFotografica(
            trabajo['mensaje'] as String? ?? 'No se pudo generar la imagen.',
            reintentable: trabajo['reintentable'] == true,
          );
        }
        if (!RegExp(
          r'^[a-f0-9]{64}$',
        ).hasMatch('${trabajo['identificador']}')) {
          throw StateError('El servidor devolvió un trabajo inválido.');
        }
        if (DateTime.now().difference(inicio).inMinutes > 45) {
          throw StateError(
            'La espera superó el plazo disponible. Vuelve a intentar para recuperar el resultado.',
          );
        }
        progreso(
          trabajo['estado'] == 'PENDIENTE'
              ? 'En cola…'
              : 'Generando la prenda y los brazos con IA…',
        );
        await Future<void>.delayed(const Duration(seconds: 2));
        if (!vigente()) throw StateError('Se dejó de esperar.');
        trabajo = _datos(
          await cliente
              .get(
                Uri.parse(
                  '$base/api/v1/probador/trabajos/${trabajo['identificador']}',
                ),
                headers: await _cabeceras(titular),
              )
              .timeout(const Duration(seconds: 15)),
        );
      }
      if (!RegExp(r'^[a-f0-9]{64}$').hasMatch('${trabajo['identificador']}')) {
        throw StateError('Resultado inválido.');
      }
      final respuesta = await cliente
          .get(
            Uri.parse(
              '$base/api/v1/probador/trabajos/${trabajo['identificador']}/imagen',
            ),
            headers: await _cabeceras(titular),
          )
          .timeout(const Duration(seconds: 30));
      if (respuesta.statusCode != 200 ||
          !respuesta.headers['content-type'].toString().startsWith(
            'image/png',
          )) {
        throw ErrorGeneracionFotografica(
          'No se pudo descargar la imagen.',
          reintentable: true,
        );
      }
      final esperada = respuesta.headers['x-contenido-sha256'];
      if (esperada != null &&
          sha256.convert(respuesta.bodyBytes).toString() != esperada) {
        throw ErrorGeneracionFotografica(
          'La descarga llegó incompleta.',
          reintentable: true,
          red: true,
        );
      }
      if (!vigente()) throw StateError('Se dejó de esperar.');
      var guardadaLocalmente = false;
      // La cola poda a 20 resultados junto con sus filas; aquí no se borra nada.
      try {
        final temporal = File('${archivo.path}.tmp');
        await temporal.writeAsBytes(respuesta.bodyBytes, flush: true);
        await temporal.rename(archivo.path);
        guardadaLocalmente = true;
      } on FileSystemException {
        /* La imagen sigue visible si no hay espacio en el teléfono. */
      }
      progreso(
        guardadaLocalmente
            ? 'Imagen generada y guardada en este teléfono'
            : 'Imagen generada; no se pudo guardar una copia para usar sin conexión.',
      );
      return respuesta.bodyBytes;
    } on SocketException {
      throw ErrorGeneracionFotografica(
        'Guardada en el teléfono. Se enviará al recuperar la conexión con CLB.',
        reintentable: true,
        red: true,
      );
    } on TimeoutException {
      throw ErrorGeneracionFotografica(
        'Sin respuesta de CLB. La solicitud sigue guardada y se reintentará.',
        reintentable: true,
        red: true,
      );
    } on FormatException {
      // Página HTML de la pasarela (502/504): servicio no disponible, sin tope.
      throw ErrorGeneracionFotografica(
        'El servidor de imágenes no está disponible ahora. Tu foto sigue guardada y se reintentará.',
        reintentable: true,
        red: true,
      );
    } on http.ClientException {
      throw ErrorGeneracionFotografica(
        'Guardada en el teléfono. Se enviará al recuperar la conexión con CLB.',
        reintentable: true,
        red: true,
      );
    }
  }

  @override
  Future<void> borrarGuardadas() async {
    final carpeta = Directory(directorio);
    if (!await carpeta.exists()) return;
    await for (final archivo in carpeta.list()) {
      if (RegExp(r'^[a-f0-9]{64}\.png$').hasMatch(p.basename(archivo.path))) {
        await archivo.delete();
      }
    }
  }

  @override
  Future<void> eliminarGuardada(String clave) async {
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(clave)) {
      throw StateError('Clave inválida.');
    }
    for (final extension in ['.png', '.png.tmp']) {
      final archivo = File(p.join(directorio, '$clave$extension'));
      if (await archivo.exists()) await archivo.delete();
    }
  }

  @override
  Future<void> invalidarRemota(String clave, String titular) async {
    if (clave != '*' && !RegExp(r'^[a-f0-9]{64}$').hasMatch(clave)) {
      throw StateError('Clave inválida.');
    }
    try {
      final respuesta = await cliente
          .delete(
            Uri.parse(
              '$base/api/v1/probador/trabajos${clave == '*' ? '' : '/$clave'}',
            ),
            headers: await _cabeceras(titular),
          )
          .timeout(const Duration(seconds: 15));
      if (respuesta.statusCode != 204 && respuesta.statusCode != 404) {
        throw ErrorGeneracionFotografica(
          'El borrado en CLB sigue pendiente.',
          reintentable: true,
        );
      }
    } on SocketException {
      throw ErrorGeneracionFotografica(
        'El borrado se enviará al conectar.',
        reintentable: true,
      );
    } on TimeoutException {
      throw ErrorGeneracionFotografica(
        'El borrado se enviará al conectar.',
        reintentable: true,
      );
    } on http.ClientException {
      throw ErrorGeneracionFotografica(
        'El borrado se enviará al conectar.',
        reintentable: true,
      );
    }
  }
}
