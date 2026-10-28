import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../dominio/contratos.dart';

/// Origen de un archivo pedido por la WebView del probador.
sealed class Destino {
  const Destino();
}

/// Archivo empaquetado en la APK (ruta de asset de Flutter).
class DestinoAsset extends Destino {
  const DestinoAsset(this.ruta);
  final String ruta;
}

/// Textura publicada y descargada por hash (`RecursosPrendas`).
class DestinoTextura extends Destino {
  const DestinoTextura(this.hash);
  final String hash;
}

/// Modelo de tallas guardado en SQLite (el mismo que usa la vista rápida nativa).
class DestinoModeloTallas extends Destino {
  const DestinoModeloTallas();
}

final _archivoProbador = RegExp(
  r'^(probador\.js|movil\.(html|js)|assets/[A-Za-z0-9_.-]+\.js|modelos/blazepose-3d/(detector|landmark-full|landmark-lite)/[A-Za-z0-9_.-]+\.(json|bin))$',
);
final _prendaEmpaquetada = RegExp(
  r'^([a-z0-9-]+)(\.modelo\.json|\.espalda\.png|\.png)$',
);
final _textura = RegExp(r'^([a-f0-9]{64})\.png$');

/// Lista blanca: todo lo que no esté aquí responde 404 (incluido `..`, que ninguna expresión admite).
Destino? resolverRuta(String ruta) {
  if (ruta == '/api/v1/tallas/modelo') return const DestinoModeloTallas();
  if (ruta.startsWith('/probador/')) {
    final resto = ruta.substring('/probador/'.length);
    if (!_archivoProbador.hasMatch(resto)) return null;
    return DestinoAsset(
      resto.startsWith('movil.')
          ? 'assets/probador-host/$resto'
          : 'assets/probador/$resto',
    );
  }
  if (ruta.startsWith('/prendas/')) {
    final m = _prendaEmpaquetada.firstMatch(ruta.substring('/prendas/'.length));
    if (m == null) return null;
    // El frente vive con las prendas de la vista rápida; el modelo 3D y la espalda los copia preparar-probador.ps1.
    return DestinoAsset(
      m.group(2) == '.png'
          ? 'assets/prendas/${m.group(0)}'
          : 'assets/probador/prendas/${m.group(0)}',
    );
  }
  if (ruta.startsWith('/recursos/')) {
    final m = _textura.firstMatch(ruta.substring('/recursos/'.length));
    return m == null ? null : DestinoTextura(m.group(1)!);
  }
  return null;
}

String tipoContenido(String ruta) => switch (ruta.split('.').last) {
  'html' => 'text/html; charset=utf-8',
  'js' => 'text/javascript; charset=utf-8',
  'json' => 'application/json',
  'png' => 'image/png',
  _ => 'application/octet-stream',
};

const puertoPreferido = 47851;

/// Misma política que la web (`cabeceras-seguridad.conf`), sin red externa: solo este origen.
const politicaContenido =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'self'; "
    "form-action 'none'";

/// Sirve el microfrontend del probador a la WebView desde 127.0.0.1 (contexto seguro para la cámara y los módulos ES).
/// Solo escucha en loopback y solo entrega datos públicos: el build, BlazePose, prendas del catálogo y el modelo de tallas.
class ServidorProbador implements AnfitrionProbadorRA {
  ServidorProbador({
    required this.asset,
    required this.textura,
    required this.modeloTallas,
  });

  final Future<ByteData> Function(String ruta) asset;
  final Future<Uint8List?> Function(String hash) textura;
  final Future<Map<String, dynamic>?> Function() modeloTallas;
  HttpServer? _servidor;

  /// URL de la página anfitriona; el puerto es efímero y el servidor se reutiliza mientras viva la app.
  @override
  Future<Uri> iniciar() async {
    var servidor = _servidor;
    if (servidor == null) {
      // Puerto fijo: la WebView conserva su origen y con él el almacenamiento del probador (modelo de tallas, registro).
      // Si otra app lo ocupa, se usa uno efímero (el probador funciona igual, solo sin su estado guardado).
      try {
        servidor = await HttpServer.bind(
          InternetAddress.loopbackIPv4,
          puertoPreferido,
        );
      } on SocketException {
        servidor = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      }
      _servidor = servidor;
      servidor.listen(_atender);
    }
    return Uri.parse('http://127.0.0.1:${servidor.port}/probador/movil.html');
  }

  @override
  Future<void> detener() async {
    await _servidor?.close(force: true);
    _servidor = null;
  }

  Future<void> _atender(HttpRequest solicitud) async {
    final respuesta = solicitud.response;
    respuesta.headers
      ..set('X-Content-Type-Options', 'nosniff')
      ..set('Cache-Control', 'no-store');
    try {
      final destino = solicitud.method == 'GET'
          ? resolverRuta(solicitud.uri.path)
          : null;
      final datos = switch (destino) {
        DestinoAsset(:final ruta) => await asset(
          ruta,
        ).then((b) => b.buffer.asUint8List(b.offsetInBytes, b.lengthInBytes)),
        DestinoTextura(:final hash) => await textura(hash),
        DestinoModeloTallas() => await modeloTallas().then(
          (m) => m == null ? null : utf8.encode(jsonEncode(m)),
        ),
        null => null,
      };
      if (datos == null) {
        respuesta.statusCode = HttpStatus.notFound;
      } else {
        final ruta = destino is DestinoAsset
            ? destino.ruta
            : destino is DestinoTextura
            ? 'x.png'
            : 'x.json';
        respuesta.headers.contentType = ContentType.parse(tipoContenido(ruta));
        if (ruta.endsWith('.html'))
          respuesta.headers.set('Content-Security-Policy', politicaContenido);
        respuesta.add(datos);
      }
    } catch (_) {
      // Un asset ausente (p. ej. sin ejecutar preparar-probador.ps1) es un 404, no un cierre de la app.
      respuesta.statusCode = HttpStatus.notFound;
    } finally {
      await respuesta.close();
    }
  }
}
