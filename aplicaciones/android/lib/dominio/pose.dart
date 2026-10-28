/// Pose corporal (17 puntos en el orden de MoveNet) y ajuste 2D de una ilustración de prenda sobre el cuerpo.
/// Port 1:1 de `probador-virtual/fuente/dominio/pose.ts`: mismas anclas y mismas perillas que el probador web.
/// No hay simulación de tela: la ilustración se traslada, rota y escala para que sus anclas coincidan con el cuerpo.
library;

import 'dart:math';
import 'fotos_prendas.dart';

String? fotografiaPrenda(String? sku) => fotosPrendas[sku];

/// Fotografías empaquetadas: funcionan desde la instalación, sin red ni cambios en MoveNet.
String recursoPrenda(String categoria, {String? sku, bool probador = false}) {
  final foto = fotografiaPrenda(sku);
  return foto == null
      ? 'assets/ilustraciones/${ilustracionDe(categoria)}.svg'
      : 'assets/prendas/$foto.${probador ? 'svg' : 'png'}';
}

const puntos = [
  'nariz',
  'ojo_izquierdo',
  'ojo_derecho',
  'oreja_izquierda',
  'oreja_derecha', //
  'hombro_izquierdo',
  'hombro_derecho',
  'codo_izquierdo',
  'codo_derecho',
  'muñeca_izquierda',
  'muñeca_derecha',
  'cadera_izquierda',
  'cadera_derecha',
  'rodilla_izquierda',
  'rodilla_derecha',
  'tobillo_izquierdo',
  'tobillo_derecho',
];

/// Coordenadas en píxeles de la imagen analizada; confianza entre 0 y 1.
class PuntoClave {
  const PuntoClave(this.x, this.y, this.confianza);
  final double x;
  final double y;
  final double confianza;
}

/// Pose detectada sobre una imagen de [ancho] × [alto] píxeles.
class Pose {
  const Pose(this.puntos, this.ancho, this.alto);
  final List<PuntoClave> puntos;
  final int ancho;
  final int alto;
}

const confianzaMinima = 0.3;

enum TipoPrenda { superior, vestido, pantalon }

TipoPrenda tipoDePrenda(String categoria) {
  final nombre = categoria.toLowerCase();
  if (nombre.contains('pantal')) return TipoPrenda.pantalon;
  if (nombre.contains('vestid')) return TipoPrenda.vestido;
  return TipoPrenda.superior;
}

/// Ilustración de la tienda por categoría (la misma regla que el catálogo web).
String ilustracionDe(String categoria) {
  final n = categoria.toLowerCase();
  if (n.contains('pantal')) return 'pantalon';
  if (n.contains('vestid')) return 'vestido';
  if (n.contains('chaquet')) return 'chaqueta';
  if (n.contains('tejid')) return 'sueter';
  if (n.contains('camiseta')) return 'camiseta';
  return 'camisa';
}

/// Las ilustraciones CLB miden 420 × 460.
const anchoIlustracion = 420.0;
const altoIlustracion = 460.0;

class Anclaje {
  const Anclaje(
    this.arriba,
    this.abajo,
    this.izquierda,
    this.derecha,
    this.superior,
    this.inferior,
    this.ensanche,
    this.alargue,
  );

  /// Par de puntos del cuerpo donde va el borde superior de la prenda.
  final (String, String) arriba;

  /// Par de puntos del cuerpo donde termina la prenda.
  final (String, String) abajo;

  /// Anclas en la ilustración, como fracción de su ancho y alto.
  final double izquierda, derecha, superior, inferior;

  /// Ancho de la prenda respecto de la distancia entre las articulaciones (las articulaciones quedan dentro del cuerpo).
  final double ensanche;

  /// Largo de la prenda respecto de la distancia entre las dos líneas del cuerpo.
  final double alargue;
}

// ponytail: anclas promedio por tipo, medidas sobre las ilustraciones de la tienda; con fotos reales de producto cada
// imagen traería sus propias anclas. `ensanche` y `alargue` son las perillas de calibración.
const anclajes = {
  TipoPrenda.superior: Anclaje(
    ('hombro_izquierdo', 'hombro_derecho'),
    ('cadera_izquierda', 'cadera_derecha'),
    155 / 420,
    266 / 420,
    96 / 460,
    381 / 460,
    1.15,
    1.1,
  ),
  TipoPrenda.vestido: Anclaje(
    ('hombro_izquierdo', 'hombro_derecho'),
    ('rodilla_izquierda', 'rodilla_derecha'),
    170 / 420,
    250 / 420,
    82 / 460,
    379 / 460,
    0.95,
    1.0,
  ),
  TipoPrenda.pantalon: Anclaje(
    ('cadera_izquierda', 'cadera_derecha'),
    ('tobillo_izquierdo', 'tobillo_derecho'),
    147 / 420,
    273 / 420,
    83 / 460,
    379 / 460,
    1.7,
    1.03,
  ),
};

/// Transformación para dibujar: trasladar a (x, y), rotar, escalar y dibujar la imagen desplazada por (−origenX, −origenY).
class Transformacion {
  const Transformacion(
    this.x,
    this.y,
    this.angulo,
    this.escalaX,
    this.escalaY,
    this.origenX,
    this.origenY,
  );
  final double x, y, angulo, escalaX, escalaY, origenX, origenY;
}

enum MotivoSinAjuste { sinPuntosSuperiores, personaMuyPequena, poseDePerfil }

class Ajuste {
  const Ajuste.ajustado(
    this.transformacion,
    this.puntuacion,
    this.largoEstimado,
  ) : motivo = null;
  const Ajuste.sinAjuste(this.motivo, this.puntuacion)
    : transformacion = null,
      largoEstimado = false;

  final Transformacion? transformacion;
  final MotivoSinAjuste? motivo;
  final double puntuacion;

  /// Sin la línea inferior visible se conserva la proporción de la ilustración.
  final bool largoEstimado;
  bool get ajustado => transformacion != null;
}

PuntoClave _punto(List<PuntoClave> pose, String nombre) =>
    pose[puntos.indexOf(nombre)];
bool _visible(PuntoClave p) => p.confianza >= confianzaMinima;
(double, double) _medio(PuntoClave a, PuntoClave b) =>
    ((a.x + b.x) / 2, (a.y + b.y) / 2);

// ponytail: proporción media; perilla de calibración. MoveNet marca la articulación del hombro, que queda por debajo
// del contorno del hombro y de la base del cuello: anclar ahí dejaba el cuello de la foto plana sobre el pecho.
/// Cuánto sube el borde superior de una prenda de hombros sobre la línea de articulaciones, en anchos de hombros.
const sobreHombros = 0.2;

/// Menos de este ancho entre articulaciones (px) no permite ubicar una prenda de forma creíble.
const _anchoMinimo = 12.0;

/// Con la línea de hombros (o de cadera) más inclinada que esto la inclinación es excesiva; no mide el giro del torso.
const _inclinacionMaxima = pi / 4;

Ajuste calcularAjuste(
  List<PuntoClave> pose,
  TipoPrenda tipo, [
  double anchoImagen = anchoIlustracion,
  double altoImagen = altoIlustracion,
  Map<String, dynamic>? textura,
]) {
  final base = anclajes[tipo]!;
  final valido =
      textura != null &&
      ['izquierda', 'derecha', 'arriba', 'abajo'].every(
        (c) =>
            textura[c] is num &&
            (textura[c] as num).isFinite &&
            textura[c] >= 0 &&
            textura[c] <= 1,
      ) &&
      textura['derecha'] - textura['izquierda'] > .05 &&
      textura['abajo'] - textura['arriba'] > .05;
  final anclaje = valido
      ? Anclaje(
          base.arriba,
          base.abajo,
          (textura['izquierda'] as num).toDouble(),
          (textura['derecha'] as num).toDouble(),
          (textura['arriba'] as num).toDouble(),
          (textura['abajo'] as num).toDouble(),
          1,
          1,
        )
      : base;
  final a = _punto(pose, anclaje.arriba.$1),
      b = _punto(pose, anclaje.arriba.$2);
  final c = _punto(pose, anclaje.abajo.$1), d = _punto(pose, anclaje.abajo.$2);
  final requeridos = [a, b, c, d].where(_visible);
  final puntuacion = requeridos.isEmpty
      ? 0.0
      : requeridos.fold(0.0, (s, p) => s + p.confianza) / 4;
  if (!_visible(a) || !_visible(b))
    return Ajuste.sinAjuste(MotivoSinAjuste.sinPuntosSuperiores, puntuacion);

  // Izquierda y derecha de la imagen, no del cuerpo: así da igual si la persona mira a la cámara o está de espaldas.
  final (izquierda, derecha) = a.x <= b.x ? (a, b) : (b, a);
  final anchoCuerpo = sqrt(
    pow(derecha.x - izquierda.x, 2) + pow(derecha.y - izquierda.y, 2),
  );
  if (anchoCuerpo < _anchoMinimo)
    return Ajuste.sinAjuste(MotivoSinAjuste.personaMuyPequena, puntuacion);
  final angulo = atan2(derecha.y - izquierda.y, derecha.x - izquierda.x);
  if (angulo.abs() > _inclinacionMaxima)
    return Ajuste.sinAjuste(MotivoSinAjuste.poseDePerfil, puntuacion);

  final anchoAncla = (anclaje.derecha - anclaje.izquierda) * anchoImagen;
  final altoAncla = (anclaje.inferior - anclaje.superior) * altoImagen;
  final escalaX = anchoCuerpo * anclaje.ensanche / anchoAncla;
  final (ax, ay) = _medio(izquierda, derecha);
  // Prendas de hombros: el borde superior va sobre el contorno del hombro (perpendicular a la línea, hacia la cabeza).
  final sobre = tipo == TipoPrenda.pantalon ? 0.0 : sobreHombros * anchoCuerpo;
  final sx = ax + sin(angulo) * sobre, sy = ay - cos(angulo) * sobre;
  final conLargo = _visible(c) && _visible(d);
  // El largo se mide perpendicular a la línea superior: con el torso inclinado la prenda no se estira de más.
  var largo = 0.0;
  if (conLargo) {
    final (ix, iy) = _medio(c, d);
    largo = max(0, -(ix - sx) * sin(angulo) + (iy - sy) * cos(angulo));
  }
  final escalaY = largo > 0 ? largo * anclaje.alargue / altoAncla : escalaX;
  return Ajuste.ajustado(
    Transformacion(
      sx,
      sy,
      angulo,
      escalaX,
      escalaY,
      (anclaje.izquierda + anclaje.derecha) / 2 * anchoImagen,
      anclaje.superior * altoImagen,
    ),
    puntuacion,
    !(largo > 0),
  );
}

// ponytail: proporciones medias respecto del ancho entre hombros (W); perillas de calibración del escote.
// Copia 1:1 de `regionCuello` en el probador web (`pose.ts`); fixture común `region-cuello.json`.
const cuelloSemiancho = 0.2, cuelloEscote = 0.1, cuelloAlto = 0.6;

/// Polígono del cuello y la cabeza sobre el que se vuelve a dibujar la foto original: la fotografía plana de la
/// prenda trae el cuello interior trasero y, puesta sobre los hombros, cortaba el cuello real. null sin los dos hombros.
List<(double, double)>? regionCuello(List<PuntoClave> pose) {
  final a = _punto(pose, 'hombro_izquierdo'),
      b = _punto(pose, 'hombro_derecho');
  if (!_visible(a) || !_visible(b)) return null;
  final (izquierda, derecha) = a.x <= b.x ? (a, b) : (b, a);
  final w = sqrt(
    pow(derecha.x - izquierda.x, 2) + pow(derecha.y - izquierda.y, 2),
  );
  if (w < _anchoMinimo) return null;
  final (cx, cy) = _medio(izquierda, derecha);
  final ex = (derecha.x - izquierda.x) / w, ey = (derecha.y - izquierda.y) / w;
  // Perpendicular hacia la cabeza (y decrece hacia arriba en la imagen).
  final nx = ey, ny = -ex;
  (double, double) en(double u, double v) =>
      (cx + ex * u * w + nx * v * w, cy + ey * u * w + ny * v * w);
  const s = cuelloSemiancho, d = cuelloEscote, h = cuelloAlto;
  final curva = List.generate(9, (k) {
    final u = s - 2 * s * k / 8;
    return en(u, sobreHombros - d * (1 - pow(u / s, 2)));
  });
  return [en(-s, sobreHombros + h), en(s, sobreHombros + h), ...curva];
}

/// Mensaje para el cliente cuando no se pudo ajustar la prenda.
String explicarSinAjuste(MotivoSinAjuste motivo) => switch (motivo) {
  MotivoSinAjuste.sinPuntosSuperiores =>
    'No se ve el cuerpo. Usa una foto de frente, con buena luz y el cuerpo visible hasta la cadera.',
  MotivoSinAjuste.personaMuyPequena =>
    'La persona se ve muy pequeña. Acércate o usa una foto más cercana.',
  MotivoSinAjuste.poseDePerfil =>
    'La inclinación es excesiva. Mantén el torso erguido y de frente a la cámara.',
};
