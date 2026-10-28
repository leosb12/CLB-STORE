import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:clb_store/datos/servidor_probador.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/prenda_probador.dart';
import 'package:clb_store/dominio/recurso_probador.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

final hash = 'a' * 64;
final espalda = 'b' * 64;

Map<String, dynamic> recurso({Map<String, dynamic>? extra}) => {
  'esquema': 2, 'version': 1, 'tipo': 'superior', 'vista': 'frontal', 'mime': 'image/png', 'sha256': hash,
  'ruta': '/api/v1/recursos-probador/$hash.png', 'color': 'Azul', 'bytes': 2000, 'ancho': 768, 'alto': 1024,
  ...?extra,
};

void main() {
  test('la lista blanca sirve solo el probador, las prendas, las texturas por hash y el modelo de tallas', () {
    expect((resolverRuta('/probador/probador.js') as DestinoAsset).ruta, 'assets/probador/probador.js');
    expect((resolverRuta('/probador/movil.html') as DestinoAsset).ruta, 'assets/probador-host/movil.html');
    expect((resolverRuta('/probador/modelos/blazepose-3d/landmark-lite/model.json') as DestinoAsset).ruta,
        'assets/probador/modelos/blazepose-3d/landmark-lite/model.json');
    expect((resolverRuta('/prendas/polera-gris.png') as DestinoAsset).ruta, 'assets/prendas/polera-gris.png');
    expect((resolverRuta('/prendas/polera-gris.modelo.json') as DestinoAsset).ruta, 'assets/probador/prendas/polera-gris.modelo.json');
    expect((resolverRuta('/recursos/$hash.png') as DestinoTextura).hash, hash);
    expect(resolverRuta('/api/v1/tallas/modelo'), isA<DestinoModeloTallas>());
    for (final fuera in [
      '/probador/../pubspec.yaml', '/probador/%2e%2e/x.js', '/prendas/../modelos/movenet.tflite', '/recursos/abc.png',
      '/probador/modelos/movenet-lightning-4/model.json', '/api/v1/pedidos', '/', '/probador/assets/x.html',
    ]) {
      expect(resolverRuta(fuera), isNull, reason: fuera);
    }
  });

  test('el servidor escucha solo en loopback, responde 404 fuera de la lista y envía la CSP en la página', () async {
    final servidor = ServidorProbador(
      asset: (ruta) async => ByteData.sublistView(Uint8List.fromList(utf8.encode('<p>$ruta</p>'))),
      textura: (h) async => h == hash ? Uint8List.fromList([137, 80, 78, 71]) : null,
      modeloTallas: () async => {'clases': ['M']},
    );
    final url = await servidor.iniciar();
    expect(url.host, '127.0.0.1');
    final cliente = HttpClient();
    Future<HttpClientResponse> pedir(String ruta) async =>
        (await cliente.getUrl(url.replace(path: ruta))).close();
    final pagina = await pedir('/probador/movil.html');
    expect(pagina.statusCode, 200);
    expect(pagina.headers.value('content-security-policy'), contains("default-src 'self'"));
    expect(pagina.headers.value('x-content-type-options'), 'nosniff');
    expect((await pedir('/recursos/$hash.png')).statusCode, 200);
    expect((await pedir('/recursos/${'c' * 64}.png')).statusCode, 404);
    expect((await pedir('/api/v1/pedidos')).statusCode, 404);
    final tallas = await pedir('/api/v1/tallas/modelo');
    expect(jsonDecode(await utf8.decodeStream(tallas)), {'clases': ['M']});
    cliente.close(force: true);
    await servidor.detener();
  });

  test('la espalda solo acompaña a un modelo 3D y cumple el contrato de una textura (igual que la web)', () {
    final e = {'sha256': espalda, 'bytes': 1500, 'ruta': '/api/v1/recursos-probador/$espalda.png'};
    final r = RecursoProbador.validar(recurso(extra: {'modelo3d': {'version': 1}, 'espalda': e}));
    expect(r.espalda!.hash, espalda);
    expect(r.espalda!.bytes, 1500);
    expect(r.espalda!.ancho, 768);
    expect(() => RecursoProbador.validar(recurso(extra: {'espalda': e})), throwsFormatException);
    expect(() => RecursoProbador.validar(recurso(extra: {'modelo3d': {}, 'espalda': {...e, 'ruta': '/otra.png'}})), throwsFormatException);
    expect(RecursoProbador.validar(recurso()).espalda, isNull);
  });

  test('prendaProbador arma el contrato v1 con rutas del servidor local y el modelo 3D cuando hay espalda', () {
    final e = {'sha256': espalda, 'bytes': 1500, 'ruta': '/api/v1/recursos-probador/$espalda.png'};
    final p = Producto(
      identificador: producto.identificador, sku: 'CLB-ING-BUZ-AZU', nombre: 'Buzo azul', descripcion: '', categoria: 'Buzos',
      precioCentavos: 22900, fechaActualizacion: producto.fechaActualizacion,
      recursoProbador: RecursoProbador.validar(recurso(extra: {'modelo3d': {'version': 1}, 'espalda': e})),
    );
    final prenda = prendaProbador(p, [variante(idM, 'M'), variante(idL, 'L')]);
    expect(prenda['imagenFotografica'], '/recursos/$hash.png');
    expect(prenda['modelo3d'], {'modelo': {'version': 1}, 'espalda': '/recursos/$espalda.png'});
    expect(prenda['tallas'], ['M', 'L']);
    expect(prendaProbador(producto, const [])['imagen'], '');
    expect(combinable(p, p.identificador), isFalse);
  });
}
