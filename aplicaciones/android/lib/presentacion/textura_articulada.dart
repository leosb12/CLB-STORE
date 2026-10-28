import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../dominio/prenda_articulada.dart';

/// La imagen y su alfa se decodifican una vez por prenda, fuera del pintado.
class TexturaArticulada {
  TexturaArticulada(this.imagen, this.geometria);
  final ui.Image imagen;
  final GeometriaPrenda? geometria;

  static Future<TexturaArticulada> cargar(
    Uint8List bytes,
    Map<String, dynamic> anclas,
  ) async {
    final codec = await ui.instantiateImageCodec(bytes);
    ui.Image? imagen;
    try {
      imagen = (await codec.getNextFrame()).image;
      final rgba = await imagen.toByteData(format: ui.ImageByteFormat.rawRgba);
      GeometriaPrenda? geometria;
      if (rgba != null) {
        final datos = rgba.buffer.asUint8List(
          rgba.offsetInBytes,
          rgba.lengthInBytes,
        );
        final alfa = Uint8List(imagen.width * imagen.height);
        for (var i = 0; i < alfa.length; i++) {
          alfa[i] = datos[i * 4 + 3];
        }
        geometria = analizarTextura(alfa, imagen.width, imagen.height, anclas);
      }
      return TexturaArticulada(imagen, geometria);
    } catch (_) {
      imagen?.dispose();
      rethrow;
    } finally {
      codec.dispose();
    }
  }

  void dispose() => imagen.dispose();
}

/// Recursos nativos por pose/foto; no se crean en paint ni al editar medidas de talla.
class PrendaPintable {
  PrendaPintable(ui.Image imagen, PrendaArticulada malla)
    : shader = ui.ImageShader(
        imagen,
        ui.TileMode.clamp,
        ui.TileMode.clamp,
        Float64List.fromList([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        filterQuality: ui.FilterQuality.medium,
      ),
      vertices = malla.regiones
          .map(
            (m) => ui.Vertices.raw(
              ui.VertexMode.triangles,
              Float32List.fromList(m.vertices),
              textureCoordinates: Float32List.fromList(m.uv),
              indices: Uint16List.fromList(m.indices),
            ),
          )
          .toList();

  final ui.ImageShader shader;
  final List<ui.Vertices> vertices;
  void dispose() {
    for (final v in vertices) {
      v.dispose();
    }
    shader.dispose();
  }
}

class PintorPrendaArticulada extends CustomPainter {
  PintorPrendaArticulada(this.prenda);
  final PrendaPintable prenda;
  @override
  void paint(Canvas canvas, Size size) {
    final pincel = Paint()
      ..shader = prenda.shader
      ..isAntiAlias = true;
    for (final v in prenda.vertices) {
      canvas.drawVertices(v, BlendMode.srcOver, pincel);
    }
  }

  @override
  bool shouldRepaint(PintorPrendaArticulada oldDelegate) =>
      oldDelegate.prenda != prenda;
}

/// Recorta la foto original al cuello y la cabeza para dibujarla encima de la prenda (ver `regionCuello`).
class RecorteCuello extends CustomClipper<Path> {
  RecorteCuello(this.region);
  final List<(double, double)> region;
  @override
  Path getClip(Size size) =>
      Path()..addPolygon([for (final (x, y) in region) Offset(x, y)], true);
  @override
  bool shouldReclip(RecorteCuello oldClipper) => oldClipper.region != region;
}
