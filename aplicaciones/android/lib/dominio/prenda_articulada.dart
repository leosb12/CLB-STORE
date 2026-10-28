/// Geometría local de torso y mangas. Sin Flutter, red ni inferencia adicional.
library;

import 'dart:math' as math;
import 'dart:typed_data';
import 'pose.dart';

class PuntoMalla {
  const PuntoMalla(this.x, this.y);
  final double x, y;
}

class FilaTextura {
  const FilaTextura(this.y, this.izquierda, this.derecha);
  final double y, izquierda, derecha;
}

class MangaTextura {
  const MangaTextura(
    this.lado,
    this.raiz,
    this.extremo,
    this.centro,
    this.arriba, {
    this.abajo,
    this.larga = false,
  });
  final int lado;
  final double raiz, extremo, centro, arriba;

  /// Solo en manga larga: fila inferior de la manga, por debajo de la axila.
  final double? abajo;
  final bool larga;
}

class GeometriaPrenda {
  const GeometriaPrenda(
    this.ancho,
    this.alto,
    this.anclas,
    this.axila,
    this.filas,
    this.mangas,
  );
  final int ancho, alto;
  final Map<String, dynamic> anclas;
  final double axila;
  final List<FilaTextura> filas;
  final List<MangaTextura> mangas;
}

class MallaTextura {
  const MallaTextura(this.vertices, this.uv, this.indices);
  final List<double> vertices, uv;
  final List<int> indices;
}

class PrendaArticulada {
  const PrendaArticulada(
    this.regiones,
    this.codosArticulados,
    this.torsoEstimado,
  );
  final List<MallaTextura> regiones;
  final int codosArticulados;
  final bool torsoEstimado;
}

double _mezclar(num a, num b, double t) => a + (b - a) * t;
PuntoMalla _punto(PuntoMalla a, PuntoMalla b, double t) =>
    PuntoMalla(_mezclar(a.x, b.x, t), _mezclar(a.y, b.y, t));
double _distancia(PuntoMalla a, PuntoMalla b) =>
    math.sqrt(math.pow(b.x - a.x, 2) + math.pow(b.y - a.y, 2));
bool _visible(PuntoClave p) =>
    p.confianza >= confianzaMinima && p.x.isFinite && p.y.isFinite;
PuntoMalla _p(PuntoClave p) => PuntoMalla(p.x, p.y);

GeometriaPrenda? analizarTextura(
  Uint8List alfa,
  int ancho,
  int alto,
  Map<String, dynamic> a,
) {
  if (ancho < 32 ||
      alto < 32 ||
      ancho > 1024 ||
      alto > 1024 ||
      alfa.length != ancho * alto ||
      !['izquierda', 'derecha', 'arriba', 'abajo'].every(
        (c) => a[c] is num && (a[c] as num).isFinite && a[c] >= 0 && a[c] <= 1,
      ) ||
      a['derecha'] - a['izquierda'] <= .05 ||
      a['abajo'] - a['arriba'] <= .05) {
    return null;
  }
  final xi = (a['izquierda'] as num) * (ancho - 1),
      xd = (a['derecha'] as num) * (ancho - 1);
  final ys = (a['arriba'] as num) * (alto - 1),
      yi = (a['abajo'] as num) * (alto - 1);
  final centroX = ((xi + xd) / 2).round();
  // Crece desde el centro del torso: una manga larga paralela al torso no ensancha la fila.
  (double, double)? limites(double y) {
    final fila = y.round().clamp(0, alto - 1) * ancho;
    var c = centroX;
    if (alfa[fila + c] < 128) {
      var offset = 1;
      while (offset < (xd - xi) * 0.4) {
        if (c - offset >= 0 && alfa[fila + c - offset] >= 128) {
          c -= offset;
          break;
        }
        if (c + offset < ancho && alfa[fila + c + offset] >= 128) {
          c += offset;
          break;
        }
        offset++;
      }
      if (alfa[fila + c] < 128) return null;
    }
    var i = c;
    while (i > 0 && alfa[fila + (i - 1)] >= 128) {
      i--;
      if (i < xi - ancho * .03) break;
    }
    var d = c;
    while (d < ancho - 1 && alfa[fila + (d + 1)] >= 128) {
      d++;
      if (d > xd + ancho * .03) break;
    }
    return d - i > (xd - xi) * .45 ? (i.toDouble(), d.toDouble()) : null;
  }

  var axila = (ys + (yi - ys) * .32).toDouble(), consecutivas = 0;
  for (var y = (ys + (yi - ys) * .1).ceil(); y < ys + (yi - ys) * .5; y++) {
    final fila = y * ancho;
    var i = 0, d = ancho - 1;
    while (i < d && alfa[fila + i] < 128) {
      i++;
    }
    while (d > i && alfa[fila + d] < 128) {
      d--;
    }
    consecutivas = i >= xi - ancho * .035 && d <= xd + ancho * .035
        ? consecutivas + 1
        : 0;
    if (consecutivas >= math.max(3, alto * .015)) {
      axila = (y - consecutivas + 1).toDouble();
      break;
    }
  }
  axila = math
      .max(ys + (yi - ys) * .15, math.min(ys + (yi - ys) * .48, axila))
      .toDouble();
  final alturas = <double>{
    0,
    ys.toDouble(),
    axila,
    ...[.5, .67, .84, 1.0].map((s) => (ys + (yi - ys) * s).toDouble()),
    (alto - 1).toDouble(),
  }.toList()..sort();
  final filas = <FilaTextura>[];
  var ultimo = (xi.toDouble(), xd.toDouble());
  for (final y in alturas) {
    if (y > axila && y <= yi) {
      ultimo = limites(y) ?? ultimo;
    }
    filas.add(FilaTextura(y, ultimo.$1, ultimo.$2));
  }
  final mangas = <MangaTextura>[];
  for (final lado in [-1, 1]) {
    final raiz = (lado < 0 ? xi : xd).toDouble();
    final limiteBorde = lado < 0 ? 0 : ancho - 1;
    var extremo = limiteBorde.toDouble(), maxDist = 0.0;
    for (
      var y = math.max(0, (ys - alto * .05).floor());
      y <= math.min(alto - 1, (axila + (yi - ys) * .2).ceil());
      y++
    ) {
      var x = limiteBorde;
      final paso = lado < 0 ? 1 : -1, fin = lado < 0 ? ancho : -1;
      while (x != fin && alfa[y * ancho + x] < 128) {
        x += paso;
      }
      if (x != fin &&
          (lado < 0 ? x < raiz : x > raiz) &&
          (x - raiz).abs() > maxDist) {
        maxDist = (x - raiz).abs();
        extremo = x.toDouble();
      }
    }
    if (maxDist < ancho * 0.04) extremo = limiteBorde.toDouble();
    final muestras = <double>[];
    var primera = alto;
    for (var y = 0; y < axila.ceil(); y++) {
      for (
        var x = math.min(raiz, extremo).floor();
        x <= math.max(raiz, extremo).ceil();
        x++
      ) {
        if (alfa[y * ancho + x] > 8) primera = math.min(primera, y);
        if ((x - raiz).abs() > (extremo - raiz).abs() * .25 &&
            alfa[y * ancho + x] >= 128) {
          muestras.add(y.toDouble());
        }
      }
    }
    // Una manga que baja más de un cuarto del torso bajo la axila es larga.
    var abajo = axila.ceil();
    for (var y = axila.ceil(); y < yi; y++) {
      for (
        var x = math.min(raiz, extremo).floor();
        x <= math.max(raiz, extremo).ceil();
        x++
      ) {
        if ((x - raiz).abs() > (extremo - raiz).abs() * .25 &&
            alfa[y * ancho + x] >= 128) {
          abajo = math.max(abajo, y);
        }
      }
    }
    final larga = abajo - axila > (yi - ys) * .25;
    if (muestras.length > math.max(30, ancho * alto * 0.0002)) {
      muestras.sort();
      mangas.add(
        MangaTextura(
          lado,
          raiz,
          extremo,
          muestras[muestras.length ~/ 2],
          math.max(0, primera - 2).toDouble(),
          abajo: (larga ? abajo : axila.ceil()).toDouble(),
          larga: larga,
        ),
      );
    }
  }
  return GeometriaPrenda(ancho, alto, a, axila, filas, mangas);
}

PuntoMalla _transformar(Transformacion t, PuntoMalla p) => PuntoMalla(
  t.x +
      math.cos(t.angulo) * (p.x - t.origenX) * t.escalaX -
      math.sin(t.angulo) * (p.y - t.origenY) * t.escalaY,
  t.y +
      math.sin(t.angulo) * (p.x - t.origenX) * t.escalaX +
      math.cos(t.angulo) * (p.y - t.origenY) * t.escalaY,
);
MallaTextura _cuadricula(
  List<double> filas,
  List<double> columnas,
  PuntoMalla Function(double, double) fuente,
  PuntoMalla Function(double, double) destino,
) {
  final vertices = <double>[], uv = <double>[], indices = <int>[];
  for (final y in filas) {
    for (final u in columnas) {
      final s = fuente(y, u), d = destino(y, u);
      uv.addAll([s.x, s.y]);
      vertices.addAll([d.x, d.y]);
    }
  }
  for (var j = 0; j < filas.length - 1; j++) {
    for (var i = 0; i < columnas.length - 1; i++) {
      final a = j * columnas.length + i,
          b = a + 1,
          c = a + columnas.length,
          d = c + 1;
      indices.addAll([a, b, c, b, d, c]);
    }
  }
  return MallaTextura(vertices, uv, indices);
}

bool mallaSegura(MallaTextura m) {
  if (!m.vertices.every((v) => v.isFinite) || !m.uv.every((v) => v.isFinite)) {
    return false;
  }
  double area(List<double> v, int a, int b, int c) =>
      (v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) -
      (v[b * 2 + 1] - v[a * 2 + 1]) * (v[c * 2] - v[a * 2]);
  for (var i = 0; i < m.indices.length; i += 3) {
    final a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
    if (area(m.vertices, a, b, c) * area(m.uv, a, b, c) <= .000001) {
      return false;
    }
  }
  return true;
}

PrendaArticulada? articularPrenda(
  GeometriaPrenda g,
  List<PuntoClave> pose,
  Transformacion t,
) {
  if (pose.length != 17 ||
      !_visible(pose[5]) ||
      !_visible(pose[6]) ||
      ![t.x, t.y, t.angulo, t.escalaX, t.escalaY].every((v) => v.isFinite)) {
    return null;
  }
  // Hombro, codo, muñeca y cadera de cada lado de la imagen.
  final pares = pose[5].x <= pose[6].x
      ? [
          [5, 7, 9, 11],
          [6, 8, 10, 12],
        ]
      : [
          [6, 8, 10, 12],
          [5, 7, 9, 11],
        ];
  final si = _p(pose[pares[0][0]]), sd = _p(pose[pares[1][0]]);
  final hi = pose[pares[0][3]],
      hd = pose[pares[1][3]],
      completo = _visible(hi) && _visible(hd);
  final ancho = _distancia(si, sd);
  if (ancho < 12) return null;
  final eje = PuntoMalla((sd.x - si.x) / ancho, (sd.y - si.y) / ancho),
      a = g.anclas;
  // Borde superior sobre el contorno del hombro, no en la articulación (igual que `calcularAjuste`).
  final articulaciones = _punto(si, sd, .5);
  final superior = PuntoMalla(
    articulaciones.x + eje.y * sobreHombros * ancho,
    articulaciones.y - eje.x * sobreHombros * ancho,
  );
  final ys = (a['arriba'] as num) * (g.alto - 1),
      yi = (a['abajo'] as num) * (g.alto - 1);
  final inferior = completo
      ? _punto(_p(hi), _p(hd), .5)
      : _transformar(
          t,
          PuntoMalla(
            (a['izquierda'] + a['derecha']) / 2 * g.ancho,
            (a['abajo'] as num).toDouble() * g.alto,
          ),
        );
  final cadera = completo
      ? math.max(
          ancho * .76,
          math.min(ancho * 1.15, _distancia(_p(hi), _p(hd)) * 1.35),
        )
      : ancho;

  final brazoIzq = _visible(pose[pares[0][1]])
      ? _distancia(si, _p(pose[pares[0][1]]))
      : ancho * 0.55;
  final brazoDer = _visible(pose[pares[1][1]])
      ? _distancia(sd, _p(pose[pares[1][1]]))
      : ancho * 0.55;
  final brazoRef = math.max(ancho * 0.35, (brazoIzq + brazoDer) / 2);

  // Sin caderas, la sisa se acota por el largo del brazo: evita torsos estirados.
  final largoTotalTorso = math.max(1.0, _distancia(superior, inferior));
  final sisaTeorica = (g.axila - ys) / (yi - ys);
  final profSisaMax = completo
      ? largoTotalTorso * sisaTeorica
      : math.min(
          largoTotalTorso * sisaTeorica,
          math.min(brazoRef * 0.52, ancho * 0.38),
        );
  final sisaEfectiva = profSisaMax / largoTotalTorso;

  PuntoMalla borde(double y, double u) {
    final sBruto = (y - ys) / (yi - ys);
    final s = sBruto <= sisaTeorica
        ? (sBruto / sisaTeorica) * sisaEfectiva
        : sisaEfectiva +
              ((sBruto - sisaTeorica) / (1 - sisaTeorica)) * (1 - sisaEfectiva);
    final c = _punto(superior, inferior, s), acotado = sBruto.clamp(0.0, 1.0);
    final tramoInferior = math.max(
      0.0,
      (acotado - sisaTeorica) / (1 - sisaTeorica),
    );
    final anchura = acotado <= sisaTeorica
        ? _mezclar(ancho, ancho * .76, acotado / sisaTeorica)
        : _mezclar(ancho * .76, cadera, tramoInferior) *
              (1 - .03 * math.sin(math.pi * tramoInferior));
    return PuntoMalla(
      c.x + eje.x * anchura * (u - .5),
      c.y + eje.y * anchura * (u - .5),
    );
  }

  final torso = _cuadricula(g.filas.map((f) => f.y).toList(), [0, .5, 1], (
    y,
    u,
  ) {
    final f = g.filas.firstWhere((f) => f.y == y);
    return PuntoMalla(_mezclar(f.izquierda, f.derecha, u), y);
  }, borde);
  if (!mallaSegura(torso)) return null;
  PuntoMalla bordeMalla(double y, double u) {
    final j = g.filas.indexWhere((f) => f.y >= y), i = math.max(0, j - 1);
    return _punto(
      borde(g.filas[i].y, u),
      borde(g.filas[j].y, u),
      i == j ? 0 : (y - g.filas[i].y) / (g.filas[j].y - g.filas[i].y),
    );
  }

  final regiones = <MallaTextura>[];
  final antebrazosDelante = <MallaTextura>[];
  var codosArticulados = 0;
  const columnas = <double>[0, .33, .67, 1];
  for (final manga in g.mangas) {
    final esLarga =
        manga.larga && manga.abajo != null && manga.abajo! > g.axila;
    final yCodo = esLarga
        ? (g.axila + (manga.abajo! - g.axila) * 0.42).roundToDouble()
        : g.axila;
    final filas = esLarga
        ? <double>[manga.arriba, (manga.arriba + yCodo) / 2, yCodo]
        : <double>[manga.arriba, (manga.arriba + g.axila) / 2, g.axila];
    final filasAntebrazo = esLarga
        ? <double>[yCodo, (yCodo + manga.abajo!) / 2, manga.abajo!]
        : <double>[];

    final par = pares[manga.lado < 0 ? 0 : 1],
        h = _p(pose[par[0]]),
        c = pose[par[1]],
        w = pose[par[2]];
    PuntoMalla fuente(double y, double u) => PuntoMalla(
      _mezclar(
        math.min(manga.raiz, manga.extremo),
        math.max(manga.raiz, manga.extremo),
        u,
      ),
      y,
    );
    var m = _cuadricula(
      filas,
      columnas,
      fuente,
      (y, u) => _transformar(t, fuente(y, u)),
    );
    final unida = _cuadricula(filas, columnas, fuente, (y, u) {
      final s = fuente(y, u),
          peso = ((s.x - manga.raiz) / (manga.extremo - manga.raiz)).abs();
      return _punto(
        bordeMalla(y, manga.lado < 0 ? 0 : 1),
        _transformar(t, PuntoMalla(manga.extremo, y)),
        peso,
      );
    });
    // Caída natural de descanso: una manga sin codo visible no se proyecta horizontalmente.
    final radioTeorico = math.max(1.0, (g.axila - manga.arriba) / 2);
    final semiAncho = math.min(ancho * 0.18, radioTeorico * t.escalaX);
    double fraccionManga(double y) => (y - manga.centro) / radioTeorico;

    final abajoEje = PuntoMalla(-eje.y, eje.x);
    final signo = manga.lado < 0 ? -1 : 1;
    final lateralEje = PuntoMalla(eje.x * signo, eje.y * signo);
    final dirDescanso = PuntoMalla(
      abajoEje.x * 0.82 + lateralEje.x * 0.57,
      abajoEje.y * 0.82 + lateralEje.y * 0.57,
    );
    var normaDescanso = math.sqrt(
      dirDescanso.x * dirDescanso.x + dirDescanso.y * dirDescanso.y,
    );
    if (normaDescanso == 0) normaDescanso = 1;
    final dirEfectiva = PuntoMalla(
      dirDescanso.x / normaDescanso,
      dirDescanso.y / normaDescanso,
    );
    final normalEfectiva = PuntoMalla(
      -manga.lado * dirEfectiva.y,
      manga.lado * dirEfectiva.x,
    );
    final largoDescanso = math.min(
      ancho * 0.55,
      (manga.extremo - manga.raiz).abs() * t.escalaX,
    );
    final descansada = _cuadricula(filas, columnas, fuente, (y, u) {
      final s = fuente(y, u),
          peso = ((s.x - manga.raiz) / (manga.extremo - manga.raiz)).abs();
      final raiz = bordeMalla(math.min(g.axila, y), manga.lado < 0 ? 0 : 1);
      final offset = fraccionManga(y) * (semiAncho * 0.75);
      final extremo = PuntoMalla(
        h.x + dirEfectiva.x * largoDescanso + normalEfectiva.x * offset,
        h.y + dirEfectiva.y * largoDescanso + normalEfectiva.y * offset,
      );
      return _punto(raiz, extremo, peso);
    });
    if (mallaSegura(descansada)) {
      m = descansada;
    } else if (mallaSegura(unida)) {
      m = unida;
    }

    MallaTextura? mallaAntebrazoValida;
    var antebrazoEnPecho = false;

    if (_visible(c) && _distancia(h, _p(c)) > ancho * .15) {
      final brazo = _distancia(h, _p(c)),
          dir = PuntoMalla((c.x - h.x) / brazo, (c.y - h.y) / brazo),
          normal = PuntoMalla(-manga.lado * dir.y, manga.lado * dir.x),
          normalTubular = PuntoMalla(dir.y, -dir.x);
      double proyeccion(PuntoMalla p) =>
          (p.x - h.x) * dir.x + (p.y - h.y) * dir.y;
      final longitudBase = math.max(
        (manga.extremo - manga.raiz).abs() * t.escalaX,
        math.max(
              proyeccion(bordeMalla(manga.arriba, manga.lado < 0 ? 0 : 1)),
              proyeccion(bordeMalla(g.axila, manga.lado < 0 ? 0 : 1)),
            ) +
            ancho * .08,
      );
      final longitud = esLarga ? brazo : math.min(brazo * 1.25, longitudBase);
      for (final factor
          in esLarga ? [1.0, 0.95, 1.05] : [1.0, 1.15, 1.35, 0.85, 0.70]) {
        final largo = longitud * factor;
        if (!esLarga && largo > brazo * 1.35) continue;
        final candidata = _cuadricula(filas, columnas, fuente, (y, u) {
          if (esLarga) {
            final fracY = (y - manga.arriba) / (yCodo - manga.arriba);
            final posHueso = _punto(h, _p(c), fracY);
            final offset = (u - 0.5) * (semiAncho * 2);
            final posTubo = PuntoMalla(
              posHueso.x + normalTubular.x * offset,
              posHueso.y + normalTubular.y * offset,
            );
            final esBordeTorso = manga.lado < 0 ? u > 0.6 : u < 0.4;
            if (fracY < 0.5 && esBordeTorso) {
              final pesoSeam =
                  (1 - fracY / 0.5) *
                  (manga.lado < 0 ? (u - 0.6) / 0.4 : (0.4 - u) / 0.4);
              final raizSisa = bordeMalla(
                math.min(g.axila, y),
                manga.lado < 0 ? 0 : 1,
              );
              return _punto(posTubo, raizSisa, pesoSeam * 0.6);
            }
            return posTubo;
          }
          final s = fuente(y, u),
              peso = ((s.x - manga.raiz) / (manga.extremo - manga.raiz)).abs(),
              raiz = bordeMalla(y, manga.lado < 0 ? 0 : 1);
          final offset = fraccionManga(y) * semiAncho;
          final extremo = PuntoMalla(
            h.x + dir.x * largo + normal.x * offset,
            h.y + dir.y * largo + normal.y * offset,
          );
          return _punto(raiz, extremo, peso);
        });
        if (mallaSegura(candidata)) {
          m = candidata;
          codosArticulados++;
          break;
        }
      }
      // Segundo segmento (antebrazo y puño) de la manga larga.
      if (esLarga && filasAntebrazo.isNotEmpty) {
        final munecaVisible =
            _visible(w) && _distancia(_p(c), _p(w)) > ancho * .12;
        final largoF = munecaVisible
            ? math.min(_distancia(_p(c), _p(w)), brazo * 1.25)
            : brazo * .90;
        final dirF = munecaVisible
            ? PuntoMalla(
                (w.x - c.x) / _distancia(_p(c), _p(w)),
                (w.y - c.y) / _distancia(_p(c), _p(w)),
              )
            : dir;
        final normalF = PuntoMalla(dirF.y, -dirF.x);
        final candidataAntebrazo = _cuadricula(
          filasAntebrazo,
          columnas,
          fuente,
          (y, u) {
            final frac = (y - yCodo) / (manga.abajo! - yCodo);
            final posHueso = _punto(
              _p(c),
              PuntoMalla(c.x + dirF.x * largoF, c.y + dirF.y * largoF),
              frac,
            );
            final normalActual = _punto(normalTubular, normalF, frac);
            final factorEstrechar = _mezclar(1.0, 0.78, frac);
            final offset = (u - 0.5) * (semiAncho * 2 * factorEstrechar);
            return PuntoMalla(
              posHueso.x + normalActual.x * offset,
              posHueso.y + normalActual.y * offset,
            );
          },
        );
        if (mallaSegura(candidataAntebrazo)) {
          mallaAntebrazoValida = candidataAntebrazo;
          // Equivale a `hi.y || sd.y + ancho` de TypeScript: 0 o NaN usan el respaldo.
          final limiteY = hi.y != 0 && !hi.y.isNaN ? hi.y : sd.y + ancho;
          antebrazoEnPecho =
              munecaVisible && (w.x - si.x) * (sd.x - w.x) > 0 && w.y < limiteY;
        }
      }
    } else if (esLarga && filasAntebrazo.isNotEmpty) {
      // Antebrazo en descanso cuando el codo está oculto.
      final largoFDescanso = largoDescanso * 0.9;
      final posCodoDescanso = PuntoMalla(
        h.x + dirEfectiva.x * largoDescanso,
        h.y + dirEfectiva.y * largoDescanso,
      );
      final descansadaAntebrazo = _cuadricula(
        filasAntebrazo,
        columnas,
        fuente,
        (y, u) {
          final frac = (y - yCodo) / (manga.abajo! - yCodo);
          final posHueso = _punto(
            posCodoDescanso,
            PuntoMalla(
              posCodoDescanso.x + dirEfectiva.x * largoFDescanso,
              posCodoDescanso.y + dirEfectiva.y * largoFDescanso,
            ),
            frac,
          );
          final offset = (u - 0.5) * (semiAncho * 1.5);
          return PuntoMalla(
            posHueso.x + normalEfectiva.x * offset,
            posHueso.y + normalEfectiva.y * offset,
          );
        },
      );
      if (mallaSegura(descansadaAntebrazo)) {
        mallaAntebrazoValida = descansadaAntebrazo;
      }
    }
    regiones.add(m);
    if (mallaAntebrazoValida != null) {
      (antebrazoEnPecho ? antebrazosDelante : regiones).add(
        mallaAntebrazoValida,
      );
    }
  }
  regiones.add(
    torso,
  ); // por encima de la unión; comparte las raíces de las mangas
  regiones.addAll(
    antebrazosDelante,
  ); // antebrazos cruzados al frente, sobre el torso
  return PrendaArticulada(regiones, codosArticulados, !completo);
}
