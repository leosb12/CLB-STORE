import 'dart:math' as math;
import 'dart:typed_data';
import 'pose.dart';
import 'filtros_material.dart';

class CampoCamiseta {
  const CampoCamiseta(
    this.alfa,
    this.sombra,
    this.x0,
    this.x1,
    this.y0,
    this.y1,
  );
  final Float32List alfa, sombra;
  final double x0, x1;
  final int y0, y1;
}

/// Port del campo TS: segmentación, oclusores, dobladillo e iluminación locales.
CampoCamiseta prepararCampoCamiseta(
  int w,
  int h,
  Uint8List rgba,
  Float32List p,
  List<PuntoClave> pose,
) {
  final n = w * h,
      arriba = (pose[5].y + pose[6].y) / 2,
      cadera = (pose[11].y + pose[12].y) / 2,
      izq = math.min(pose[5].x, pose[6].x),
      der = math.max(pose[5].x, pose[6].x);
  final largo = cadera - arriba, ancho = der - izq;
  final l = Float32List(n),
      cr = Float32List(n),
      cg = Float32List(n),
      cb = Float32List(n),
      ropa = Float32List(n),
      otros = Float32List(n),
      proteccion = Float32List(n);
  final referencias = List.generate(4, (_) => <double>[]);
  var bx0 = w, bx1 = 0, by0 = h, by1 = 0, cantidadOtros = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final i = y * w + x,
          r = rgba[i * 4] / 255,
          g = rgba[i * 4 + 1] / 255,
          b = rgba[i * 4 + 2] / 255,
          suma = math.max(.05, r + g + b),
          sx = (x + .5) * 256 / w - .5,
          sy = (y + .5) * 256 / h - .5;
      l[i] = luminanciaMaterial(r, g, b);
      cr[i] = r / suma;
      cg[i] = g / suma;
      cb[i] = b / suma;
      final clases = List.generate(
        6,
        (k) => muestraMaterial(p, 256, 256, 6, sx, sy, k),
      );
      ropa[i] = clases[4];
      otros[i] = clases[5];
      proteccion[i] = clases[1] + clases[2] + clases[3];
      if (y > arriba + .35 * largo &&
          y < arriba + .75 * largo &&
          x > izq + .15 * ancho &&
          x < der - .15 * ancho &&
          clases[4] > .9 &&
          i % 3 == 0) {
        final valores = [l[i], cr[i], cg[i], cb[i]];
        for (var k = 0; k < 4; k++) {
          referencias[k].add(valores[k]);
        }
      }
      if (y > arriba - .2 * largo &&
          y < cadera &&
          x > izq &&
          x < der &&
          clases[5] == clases.reduce(math.max)) {
        bx0 = math.min(bx0, x);
        bx1 = math.max(bx1, x);
        by0 = math.min(by0, y);
        by1 = math.max(by1, y);
        cantidadOtros++;
      }
    }
  }
  if (referencias[0].length < 20) {
    throw const FormatException(
      'No se identificó suficiente tejido de la camiseta.',
    );
  }
  final valores = referencias.map(medianaMaterial).toList(),
      referencia = valores[0],
      rref = valores[1],
      gref = valores[2],
      bref = valores[3];
  if (referencia < .055) {
    throw const FormatException(
      'La camiseta está demasiado oscura o su color no permite separar el tejido. Prueba una camiseta lisa y con mejor luz.',
    );
  }
  final gx = Float32List(n), gy = Float32List(n);
  double pixel(int x, int y) =>
      l[indiceMaterial(y, h - 1) * w + indiceMaterial(x, w - 1)] * 255;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final i = y * w + x;
      gx[i] =
          (pixel(x + 1, y - 1) +
                  2 * pixel(x + 1, y) +
                  pixel(x + 1, y + 1) -
                  pixel(x - 1, y - 1) -
                  2 * pixel(x - 1, y) -
                  pixel(x - 1, y + 1))
              .abs();
      gy[i] =
          (pixel(x - 1, y + 1) +
                  2 * pixel(x, y + 1) +
                  pixel(x + 1, y + 1) -
                  pixel(x - 1, y - 1) -
                  2 * pixel(x, y - 1) -
                  pixel(x + 1, y - 1))
              .abs();
    }
  }
  final gradX = mediaCajaMaterial(gx, w, h, 2),
      gradY = mediaCajaMaterial(gy, w, h, 1),
      objeto = Uint8List(n);
  if (cantidadOtros > n * .001) {
    final bw = bx1 - bx0;
    if (bw < ancho * .06 || bw > ancho * .5 || by1 - by0 < bw) {
      throw const FormatException(
        'Hay un objeto tapando la camiseta que no se pudo delimitar. Prueba una foto sin objetos delante del torso.',
      );
    }
    var mejor = -double.infinity;
    List<int>? rectangulo;
    for (
      var x0 = math.max(2, bx0 - (bw * .1).round());
      x0 < math.min(w - 3, bx0 + (bw * .15).round());
      x0 += 2
    ) {
      for (
        var x1 = math.max(x0 + 12, bx1 - (bw * .25).round());
        x1 < math.min(w - 2, bx1 + (bw * .05).round());
        x1 += 2
      ) {
        final anchura = x1 - x0;
        for (
          var y0 = by0;
          y0 <
              math.min(
                by1 - (anchura * 1.2).round(),
                by0 + ((by1 - by0) * .55).round(),
              );
          y0++
        ) {
          var horizontal = 0.0, vertical = 0.0;
          final fin = math.min(h - 1, y0 + (anchura * .65).round());
          for (var x = x0 + 4; x < x1 - 4; x++) {
            horizontal += gradY[y0 * w + x];
          }
          for (var y = y0 + 4; y < fin; y++) {
            vertical += gradX[y * w + x0] + gradX[y * w + x1];
          }
          final puntuacion =
              horizontal / (anchura - 8) +
              .6 * vertical / math.max(1, fin - y0 - 4);
          if (puntuacion > mejor) {
            mejor = puntuacion;
            rectangulo = [
              x0,
              y0,
              x1,
              math.min(by1 + 3, y0 + (anchura * 2.2).round()),
            ];
          }
        }
      }
    }
    if (rectangulo == null || mejor < 15) {
      throw const FormatException(
        'No se pudo separar el objeto delante de la camiseta. Repite sin el teléfono frente al cuerpo.',
      );
    }
    final x0 = rectangulo[0],
        y0 = rectangulo[1],
        x1 = rectangulo[2],
        y1 = rectangulo[3],
        margen = ((x1 - x0) * .1).round();
    for (
      var y = math.max(0, y0 - margen);
      y <= math.min(h - 1, y1 + margen);
      y++
    ) {
      for (
        var x = math.max(0, x0 - margen);
        x <= math.min(w - 1, x1 + margen);
        x++
      ) {
        objeto[y * w + x] = 1;
      }
    }
  }
  final perfil = Float32List(h);
  for (var y = 0; y < h; y++) {
    final filas = List.generate(4, (_) => <double>[]);
    for (
      var x = (izq + .2 * ancho).round();
      x < (der - .2 * ancho).round();
      x += 2
    ) {
      final i = y * w + x;
      filas[0].add(cr[i]);
      filas[1].add(cg[i]);
      filas[2].add(cb[i]);
      filas[3].add(l[i]);
    }
    perfil[y] = [
      (medianaMaterial(filas[0]) - rref).abs(),
      (medianaMaterial(filas[1]) - gref).abs(),
      (medianaMaterial(filas[2]) - bref).abs(),
      math.max(
        0.0,
        (medianaMaterial(filas[3]) - referencia).abs() -
            math.max(.12, referencia * .25),
      ),
    ].reduce(math.max);
  }
  final perfilSuave = mediaCajaMaterial(perfil, 1, h, 4);
  var borde = -1;
  for (
    var y = math.max(0, (cadera + .08 * largo).round());
    y < math.min(h, (cadera + .45 * largo).round());
    y++
  ) {
    if (perfilSuave[y] > .0185) {
      borde = y;
      break;
    }
  }
  if (borde < 0) {
    throw const FormatException(
      'No se distingue el final de la camiseta del pantalón. Usa prendas de colores diferentes y muestra el borde inferior.',
    );
  }
  final ya = math.max(1, borde - (.16 * largo).round()),
      yb = math.min(h - 2, borde + (.04 * largo).round()),
      xa = math.max(1, (izq - .1 * ancho).round()),
      xb = math.min(w - 2, (der + .1 * ancho).round()),
      filas = yb - ya;
  final colores = [
        cr,
        cg,
        cb,
      ].map((c) => mediaCajaMaterial(c, w, h, 5)).toList(),
      gradiente = mediaCajaMaterial(gy, w, h, 4);
  double coste(int x, int y) {
    final cambio = colores
        .map(
          (c) =>
              (c[math.min(h - 1, y + 8) * w + x] -
                      c[math.max(0, y - 8) * w + x])
                  .abs(),
        )
        .reduce(math.max);
    return gradiente[y * w + x] + 500 * cambio - .2 * (y - borde).abs();
  }

  var costes = Float64List.fromList(
    List.generate(filas, (j) => -coste(xa, ya + j)),
  );
  final caminos = <Int8List>[];
  for (var x = xa + 1; x < xb; x++) {
    final nuevo = Float64List(filas), camino = Int8List(filas);
    for (var j = 0; j < filas; j++) {
      var valor = costes[j], paso = 0;
      if (j > 0 && costes[j - 1] + .7 < valor) {
        valor = costes[j - 1] + .7;
        paso = -1;
      }
      if (j + 1 < filas && costes[j + 1] + .7 < valor) {
        valor = costes[j + 1] + .7;
        paso = 1;
      }
      nuevo[j] = valor - coste(x, ya + j);
      camino[j] = paso;
    }
    costes = nuevo;
    caminos.add(camino);
  }
  var j = 0;
  for (var k = 1; k < filas; k++) {
    if (costes[k] < costes[j]) {
      j = k;
    }
  }
  final curva = Float64List(xb - xa);
  curva[curva.length - 1] = (ya + j).toDouble();
  for (var x = curva.length - 2; x >= 0; x--) {
    j = indiceMaterial(j + caminos[x][j], filas - 1);
    curva[x] = (ya + j).toDouble();
  }
  final coef = _ajustarCuadratica(curva), dobladillo = Float32List(w);
  for (var x = 0; x < w; x++) {
    final t = 2 * (x - xa) / math.max(1, xb - xa - 1) - 1;
    dobladillo[x] = limitarMaterial(
      coef[0] + coef[1] * t + coef[2] * t * t,
      ya,
      yb - 1,
    );
  }
  final semilla = Float32List(n), visitado = Uint8List(n), cola = Int32List(n);
  var inicio = 0, fin = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final i = y * w + x;
      if (y >= math.min(pose[5].y, pose[6].y) - .6 * largo && objeto[i] == 0) {
        semilla[i] =
            (ropa[i] + otros[i]) * limitarMaterial((dobladillo[x] + 1 - y) / 2);
      }
    }
  }
  for (final fy in [.1, .25, .45, .6]) {
    for (final fx in [.2, .5, .8]) {
      final i = (arriba + fy * largo).round() * w + (izq + fx * ancho).round();
      if (i >= 0 && i < n && semilla[i] > .4 && visitado[i] == 0) {
        cola[fin++] = i;
        visitado[i] = 1;
      }
    }
  }
  while (inicio < fin) {
    final i = cola[inicio++], x = i % w;
    for (final k in [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      i - w,
      i + w,
    ]) {
      if (k >= 0 && k < n && visitado[k] == 0 && semilla[k] > .4) {
        visitado[k] = 1;
        cola[fin++] = k;
      }
    }
  }
  if (fin < w * largo * .1) {
    throw const FormatException('La máscara de la camiseta está incompleta.');
  }
  final soporte = mediaCajaMaterial(
        Float32List.fromList(visitado.map((v) => v.toDouble()).toList()),
        w,
        h,
        3,
      ),
      s = Float32List(n),
      ll = Float32List(n),
      ls = Float32List(n);
  for (var i = 0; i < n; i++) {
    s[i] = soporte[i] > 0 ? semilla[i] : 0;
    ll[i] = l[i] * l[i];
    ls[i] = l[i] * s[i];
  }
  final ml = mediaCajaMaterial(l, w, h, 3),
      ms = mediaCajaMaterial(s, w, h, 3),
      mll = mediaCajaMaterial(ll, w, h, 3),
      mls = mediaCajaMaterial(ls, w, h, 3),
      a = Float32List(n),
      b = Float32List(n);
  for (var i = 0; i < n; i++) {
    a[i] = (mls[i] - ml[i] * ms[i]) / (mll[i] - ml[i] * ml[i] + .0005);
    b[i] = ms[i] - a[i] * ml[i];
  }
  final ma = mediaCajaMaterial(a, w, h, 3),
      mb = mediaCajaMaterial(b, w, h, 3),
      alfa = Float32List(n),
      bordes = <List<double>>[];
  var y0 = h, y1 = 0;
  for (var y = 0; y < h; y++) {
    var x0 = w, x1 = 0;
    for (var x = 0; x < w; x++) {
      final i = y * w + x;
      alfa[i] = objeto[i] != 0
          ? 0
          : limitarMaterial((ma[i] * l[i] + mb[i] - .08) / .7) *
                limitarMaterial((.65 - proteccion[i]) / .35);
      if (alfa[i] > .5) {
        x0 = math.min(x0, x);
        x1 = math.max(x1, x);
        y0 = math.min(y0, y);
        y1 = math.max(y1, y);
      }
    }
    if (y > arriba + .4 * largo && y < arriba + .8 * largo && x1 > x0) {
      bordes.add([x0.toDouble(), x1.toDouble()]);
    }
  }
  if (y1 - y0 < largo * .5 || bordes.isEmpty) {
    throw const FormatException('La máscara de la camiseta es insuficiente.');
  }
  final local = mediaCajaMaterial(l, w, h, 25),
      atipico = Float32List(n),
      valida = Float32List(n),
      valor = Float32List(n);
  for (var i = 0; i < n; i++) {
    atipico[i] = alfa[i] > .9 && l[i] > local[i] * 1.45 + .03 ? 1 : 0;
  }
  final expansion = mediaCajaMaterial(
    atipico,
    w,
    h,
    math.max(3, (ancho * .025).round()),
  );
  for (var i = 0; i < n; i++) {
    if (alfa[i] > .9 && l[i] > local[i] * .3 && expansion[i] == 0) {
      valida[i] = 1;
      valor[i] = l[i];
    }
  }
  // Rellenar muestras descartadas antes del filtrado fino evita discontinuidades.
  final radioAmplio = math.max(12, (ancho * .09).round()),
      pesoAmplio = mediaCajaMaterial(valida, w, h, radioAmplio),
      valorAmplio = mediaCajaMaterial(valor, w, h, radioAmplio),
      relleno = Float32List(n);
  for (var i = 0; i < n; i++) {
    relleno[i] = valida[i] != 0
        ? l[i]
        : pesoAmplio[i] > .01
        ? valorAmplio[i] / pesoAmplio[i]
        : referencia;
  }
  final radio = math.max(3, (ancho * .018).round()),
      promedio = mediaCajaMaterial(relleno, w, h, radio),
      sombra = Float32List(n);
  for (var i = 0; i < n; i++) {
    sombra[i] = limitarMaterial(
      math.pow(promedio[i] / math.max(.02, referencia), 1.1),
      .35,
      1.7,
    );
  }
  return CampoCamiseta(
    alfa,
    sombra,
    medianaMaterial(bordes.map((b) => b[0]).toList()),
    medianaMaterial(bordes.map((b) => b[1]).toList()),
    y0,
    y1,
  );
}

List<double> _ajustarCuadratica(Float64List y) {
  final m = List.generate(3, (_) => List.filled(4, 0.0));
  for (var i = 0; i < y.length; i++) {
    final x = 2 * i / math.max(1, y.length - 1) - 1, v = [1.0, x, x * x];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        m[r][c] += v[r] * v[c];
      }
      m[r][3] += v[r] * y[i];
    }
  }
  for (var k = 0; k < 3; k++) {
    final divisor = m[k][k];
    if (divisor.abs() < 1e-9) {
      return [medianaMaterial(y.toList()), 0, 0];
    }
    for (var c = k; c < 4; c++) {
      m[k][c] /= divisor;
    }
    for (var r = 0; r < 3; r++) {
      if (r != k) {
        final factor = m[r][k];
        for (var c = k; c < 4; c++) {
          m[r][c] -= factor * m[k][c];
        }
      }
    }
  }
  return m.map((f) => f[3]).toList();
}
