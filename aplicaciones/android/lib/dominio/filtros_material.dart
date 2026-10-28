import 'dart:math' as math;
import 'dart:typed_data';

double limitarMaterial(num v, [num a = 0, num b = 1]) =>
    v.clamp(a, b).toDouble();
int indiceMaterial(int v, int fin) => v.clamp(0, fin);
double medianaMaterial(List<double> a) {
  a.sort();
  return a.isEmpty ? 0 : a[a.length ~/ 2];
}

double luminanciaMaterial(double r, double g, double b) =>
    .2126 * r + .7152 * g + .0722 * b;
Float32List mediaCajaMaterial(Float32List a, int w, int h, int r) {
  final tmp = Float32List(a.length), out = Float32List(a.length), n = 2 * r + 1;
  for (var y = 0; y < h; y++) {
    var suma = 0.0;
    for (var k = -r; k <= r; k++) {
      suma += a[y * w + indiceMaterial(k, w - 1)];
    }
    for (var x = 0; x < w; x++) {
      tmp[y * w + x] = suma / n;
      suma +=
          a[y * w + indiceMaterial(x + r + 1, w - 1)] -
          a[y * w + indiceMaterial(x - r, w - 1)];
    }
  }
  for (var x = 0; x < w; x++) {
    var suma = 0.0;
    for (var k = -r; k <= r; k++) {
      suma += tmp[indiceMaterial(k, h - 1) * w + x];
    }
    for (var y = 0; y < h; y++) {
      out[y * w + x] = suma / n;
      suma +=
          tmp[indiceMaterial(y + r + 1, h - 1) * w + x] -
          tmp[indiceMaterial(y - r, h - 1) * w + x];
    }
  }
  return out;
}

double muestraMaterial(
  List<num> a,
  int w,
  int h,
  int c,
  double x,
  double y,
  int k,
) {
  x = limitarMaterial(x, 0, w - 1);
  y = limitarMaterial(y, 0, h - 1);
  final ix = x.floor(), iy = y.floor(), fx = x - ix, fy = y - iy;
  double v(int px, int py) => a[(py * w + px) * c + k].toDouble();
  return (v(ix, iy) * (1 - fx) + v(math.min(ix + 1, w - 1), iy) * fx) *
          (1 - fy) +
      (v(ix, math.min(iy + 1, h - 1)) * (1 - fx) +
              v(math.min(ix + 1, w - 1), math.min(iy + 1, h - 1)) * fx) *
          fy;
}
