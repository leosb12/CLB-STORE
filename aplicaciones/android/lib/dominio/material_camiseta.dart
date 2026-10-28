/// Transferencia de material local. Port del dominio TS, sin Flutter ni IO.
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'pose.dart';
import 'filtros_material.dart';
import 'campo_camiseta.dart';
export 'filtros_material.dart' show mediaCajaMaterial;

class RasterMaterial {
  const RasterMaterial(this.ancho, this.alto, this.rgba);
  final int ancho, alto;
  final Uint8List rgba;
}

class MaterialCamiseta {
  const MaterialCamiseta(
    this.lado,
    this.rgb,
    this.mascara,
    this.color,
    this.encuadre,
  );
  final int lado;
  final Float32List rgb, mascara;
  final List<double> color;
  final List<double> encuadre;
}

double _lineal(double v) =>
    v <= .04045 ? v / 12.92 : math.pow((v + .055) / 1.055, 2.4).toDouble();
double _srgb(double v) => v <= .0031308
    ? v * 12.92
    : 1.055 * math.pow(math.max(0, v), 1 / 2.4) - .055;
void _validar(RasterMaterial r) {
  if (r.ancho < 2 ||
      r.alto < 2 ||
      r.ancho > 2048 ||
      r.alto > 2048 ||
      r.rgba.length != r.ancho * r.alto * 4) {
    throw const FormatException('Imagen inválida o demasiado grande.');
  }
}

MaterialCamiseta prepararMaterialCamiseta(
  RasterMaterial r,
  Map<String, dynamic> a, {
  double detalle = .2,
}) {
  _validar(r);
  final izquierda = (a['izquierda'] as num).toDouble(),
      derecha = (a['derecha'] as num).toDouble(),
      arriba = (a['arriba'] as num).toDouble(),
      abajo = (a['abajo'] as num).toDouble();
  if (![izquierda, derecha, arriba, abajo].every((v) => v.isFinite) ||
      izquierda < 0 ||
      derecha > 1 ||
      arriba < 0 ||
      abajo > 1 ||
      derecha <= izquierda ||
      abajo <= arriba) {
    throw const FormatException('Anclas del material inválidas.');
  }
  final entradaZonas = a['estampados'];
  if (entradaZonas is! List) {
    throw const FormatException(
      'Esta fotografía necesita preparación de estampados. Actualiza el catálogo o prepara de nuevo la prenda en Administración.',
    );
  }
  if (entradaZonas.length > 16 ||
      entradaZonas.any(
        (z) =>
            z is! List ||
            z.length != 4 ||
            z.any((v) => v is! num || !v.isFinite || v < 0 || v > 1) ||
            z[2] <= z[0] ||
            z[3] <= z[1],
      )) {
    throw const FormatException(
      'Las zonas de estampado no cumplen el contrato.',
    );
  }
  final zonas = [
    for (final z in entradaZonas)
      [for (final v in z as List) (v as num).toDouble()],
  ];
  final proteccion = Float32List(384 * 384);
  const lado = 384, n = lado * lado;
  final original = Float32List(n * 3),
      luminancia = Float32List(n),
      canales = List.generate(3, (_) => <double>[]);
  var vacios = 0;
  var x0 = izquierda + .12 * (derecha - izquierda),
      x1 = derecha - .12 * (derecha - izquierda),
      y0 = arriba + .13 * (abajo - arriba),
      y1 = abajo - .13 * (abajo - arriba);
  for (final z in zonas) {
    x0 = math.max(0, math.min(x0, z[0] - .01));
    x1 = math.min(1, math.max(x1, z[2] + .01));
    y0 = math.max(0, math.min(y0, z[1] - .01));
    y1 = math.min(1, math.max(y1, z[3] + .01));
  }
  for (var y = 0; y < lado; y++) {
    for (var x = 0; x < lado; x++) {
      final i = y * lado + x,
          sx = (x0 + (x1 - x0) * x / (lado - 1)) * (r.ancho - 1),
          sy = (y0 + (y1 - y0) * y / (lado - 1)) * (r.alto - 1);
      final nx = sx / (r.ancho - 1), ny = sy / (r.alto - 1);
      for (final z in zonas) {
        proteccion[i] = math.max(
          proteccion[i],
          limitarMaterial(
            [
                  (nx - z[0]) / (z[2] - z[0]),
                  (z[2] - nx) / (z[2] - z[0]),
                  (ny - z[1]) / (z[3] - z[1]),
                  (z[3] - ny) / (z[3] - z[1]),
                ].reduce(math.min) /
                .08,
          ),
        );
      }
      if (muestraMaterial(r.rgba, r.ancho, r.alto, 4, sx, sy, 3) < 242) {
        vacios++;
      }
      for (var k = 0; k < 3; k++) {
        final v = muestraMaterial(r.rgba, r.ancho, r.alto, 4, sx, sy, k) / 255;
        original[i * 3 + k] = v;
        if (i % 8 == 0) {
          canales[k].add(v);
        }
      }
      luminancia[i] = luminanciaMaterial(
        original[i * 3],
        original[i * 3 + 1],
        original[i * 3 + 2],
      );
    }
  }
  if (vacios / n > .01) {
    throw const FormatException(
      'La foto del producto no tiene un torso completo para transferir el tejido.',
    );
  }
  final color = canales.map(medianaMaterial).toList(),
      base = luminanciaMaterial(color[0], color[1], color[2]),
      cbase = color.map((c) => c / math.max(.05, base)).toList();
  final iluminacion = mediaCajaMaterial(luminancia, lado, lado, 12),
      coherente = mediaCajaMaterial(luminancia, lado, lado, 3),
      rgb = Float32List(n * 3),
      mascara = Float32List(n);
  for (var i = 0; i < n; i++) {
    final l = luminancia[i],
        c = List.generate(3, (k) => original[i * 3 + k] / math.max(l, .05));
    final estampado = limitarMaterial(
          (List.generate(3, (k) => (c[k] - cbase[k]).abs()).reduce(math.max) -
                  .12) /
              .15,
        ),
        tinta = limitarMaterial((base - coherente[i] - .55) / .1);
    mascara[i] = math.max(proteccion[i], math.max(estampado, tinta));
    var v =
        base +
        (l - iluminacion[i]) *
            math.max(limitarMaterial(detalle, .2, 1), proteccion[i]);
    v = v * (1 - proteccion[i]) + l * proteccion[i];
    v = v * (1 - tinta) + l * tinta;
    v = v * (1 - estampado) + l * estampado;
    for (var k = 0; k < 3; k++) {
      rgb[i * 3 + k] = limitarMaterial(
        (cbase[k] +
                (c[k] - cbase[k]) *
                    (.25 + .75 * math.max(estampado, proteccion[i]))) *
            v,
      );
    }
  }
  final anchoAnclas = (derecha - izquierda) * r.ancho;
  return MaterialCamiseta(lado, rgb, mascara, color, [
    (x0 - (izquierda + derecha) / 2) * r.ancho / anchoAnclas,
    (y0 - arriba) * r.alto / anchoAnclas,
    (x1 - x0) * r.ancho / anchoAnclas,
    (y1 - y0) * r.alto / anchoAnclas,
  ]);
}

double Function(int, int, int) _muestreadorMaterial(
  MaterialCamiseta m,
  List<PuntoClave> pose,
) {
  final a = pose[5].x < pose[6].x ? pose[5] : pose[6],
      b = pose[5].x < pose[6].x ? pose[6] : pose[5],
      dx = b.x - a.x,
      dy = b.y - a.y,
      ancho = math.sqrt(dx * dx + dy * dy),
      cx = (a.x + b.x) / 2,
      cy = (a.y + b.y) / 2,
      cos = dx / ancho,
      sin = dy / ancho,
      e = m.encuadre;
  return (x, y, k) {
    final u = (((x - cx) * cos + (y - cy) * sin) / ancho - e[0]) / e[2],
        v = ((-(x - cx) * sin + (y - cy) * cos) / ancho - e[1]) / e[3];
    final mezcla =
        limitarMaterial([u, 1 - u, v, 1 - v].reduce(math.min) / .04) *
        muestraMaterial(
          m.mascara,
          m.lado,
          m.lado,
          1,
          u * (m.lado - 1),
          v * (m.lado - 1),
          0,
        );
    if (mezcla == 0) {
      return m.color[k];
    }
    return m.color[k] +
        (muestraMaterial(
                  m.rgb,
                  m.lado,
                  m.lado,
                  3,
                  u * (m.lado - 1),
                  v * (m.lado - 1),
                  k,
                ) -
                m.color[k]) *
            mezcla;
  };
}

RasterMaterial transferirMaterialCamiseta(
  RasterMaterial f,
  Float32List p,
  List<PuntoClave> pose,
  MaterialCamiseta m,
) {
  _validar(f);
  if (p.length != 256 * 256 * 6 || !p.every((v) => v.isFinite)) {
    throw const FormatException('Máscara semántica inválida.');
  }
  if (pose.length != 17 ||
      [5, 6, 11, 12].any(
        (i) => pose[i].confianza < .35 || !(pose[i].x + pose[i].y).isFinite,
      )) {
    throw const FormatException('Muestra hombros y cadera.');
  }
  final w = f.ancho,
      h = f.alto,
      arriba = (pose[5].y + pose[6].y) / 2,
      abajo = (pose[11].y + pose[12].y) / 2,
      izq = math.min(pose[5].x, pose[6].x),
      der = math.max(pose[5].x, pose[6].x);
  if (abajo - arriba < h * .15 ||
      der - izq < w * .15 ||
      arriba < 0 ||
      abajo >= h ||
      izq < 0 ||
      der >= w) {
    throw const FormatException(
      'Acércate y muestra el torso completo, de frente.',
    );
  }
  final campo = prepararCampoCamiseta(w, h, f.rgba, p, pose),
      rgba = Uint8List.fromList(f.rgba),
      muestrear = _muestreadorMaterial(m, pose);
  if (campo.x1 - campo.x0 < 1) {
    throw const FormatException('No se identificó un torso completo.');
  }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final i = y * w + x, alpha = campo.alfa[i];
      if (alpha == 0) {
        continue;
      }
      for (var k = 0; k < 3; k++) {
        final tela = muestrear(x, y, k),
            c = limitarMaterial(_srgb(_lineal(tela) * campo.sombra[i]));
        rgba[i * 4 + k] = (f.rgba[i * 4 + k] * (1 - alpha) + 255 * c * alpha)
            .round()
            .clamp(0, 255);
      }
    }
  }
  return RasterMaterial(w, h, rgba);
}
