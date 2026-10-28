/// Manifiesto público: coordenadas normalizadas sobre la textura final, no medidas físicas.
class RecursoProbador {
  RecursoProbador._(this.json);
  final Map<String, dynamic> json;
  String get hash => json['sha256'] as String;
  String get ruta => json['ruta'] as String;
  String get color => json['color'] as String;
  int get bytes => json['bytes'] as int;
  int get ancho => json['ancho'] as int;
  int get alto => json['alto'] as int;
  bool get soloGenerativo => json['esquema'] == 2;
  Map<String, dynamic> get anclas =>
      Map<String, dynamic>.from(json['anclas'] as Map? ?? const {});

  /// Modelo 3D de la realidad aumentada (lo valida el probador React, igual que en la web); null si no lo tiene.
  Map<String, dynamic>? get modelo3d => json['modelo3d'] is Map
      ? Map<String, dynamic>.from(json['modelo3d'] as Map)
      : null;

  /// Espalda deducida del modelo 3D: otra textura 768×1024 publicada y verificada igual que la frontal.
  RecursoProbador? get espalda {
    final e = json['espalda'];
    if (e is! Map) return null;
    final copia =
        {...json, 'sha256': e['sha256'], 'bytes': e['bytes'], 'ruta': e['ruta']}
          ..remove('modelo3d')
          ..remove('espalda')
          ..remove('calidad');
    return RecursoProbador._(Map<String, dynamic>.unmodifiable(copia));
  }

  factory RecursoProbador.validar(Map<String, dynamic> j) {
    final hash = j['sha256'];
    if (![1, 2].contains(j['esquema']) ||
        j['version'] is! int ||
        (j['version'] as int) < 1 ||
        !['superior', 'inferior', 'completo'].contains(j['tipo']) ||
        j['vista'] != 'frontal' ||
        j['mime'] != 'image/png' ||
        hash is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(hash) ||
        j['ruta'] != '/api/v1/recursos-probador/$hash.png' ||
        j['color'] is! String ||
        (j['color'] as String).trim().isEmpty ||
        (j['color'] as String).length > 80 ||
        j['bytes'] is! int ||
        (j['bytes'] as int) < 26 ||
        (j['bytes'] as int) > 10485760 ||
        !['ancho', 'alto'].every(
          (c) => j[c] is int && (j[c] as int) >= 128 && (j[c] as int) <= 1024,
        )) {
      throw const FormatException(
        'El recurso fotográfico no cumple el contrato.',
      );
    }
    if (j['esquema'] == 2) {
      if (j['ancho'] != 768 || j['alto'] != 1024) {
        throw const FormatException(
          'Dimensiones del recurso generativo inválidas.',
        );
      }
      // Misma regla que la web: la espalda solo acompaña a un modelo 3D y cumple el contrato de una textura.
      final e = j['espalda'];
      if (e != null &&
          (e is! Map ||
              j['modelo3d'] is! Map ||
              e['sha256'] is! String ||
              !RegExp(r'^[a-f0-9]{64}$').hasMatch(e['sha256'] as String) ||
              e['ruta'] != '/api/v1/recursos-probador/${e['sha256']}.png' ||
              e['bytes'] is! int ||
              (e['bytes'] as int) < 26 ||
              (e['bytes'] as int) > 10485760)) {
        throw const FormatException(
          'La espalda del modelo 3D no cumple el contrato.',
        );
      }
      return RecursoProbador._(Map<String, dynamic>.unmodifiable(j));
    }
    if (j['tipo'] != 'superior') {
      throw const FormatException('El recurso local debe ser superior.');
    }
    final a = j['anclas'];
    if (a is! Map ||
        a['cuello'] is! List ||
        (a['cuello'] as List).length != 2) {
      throw const FormatException('Anclas fotográficas inválidas.');
    }
    final valores = [
      for (final c in [
        'izquierda',
        'derecha',
        'arriba',
        'abajo',
        'pecho',
        'calidad',
      ])
        a[c],
      ...(a['cuello'] as List),
    ];
    if (!valores.every((v) => v is num && v.isFinite && v >= 0 && v <= 1) ||
        !(a['izquierda'] < a['cuello'][0] &&
            a['cuello'][0] < a['derecha'] &&
            a['arriba'] < a['pecho'] &&
            a['pecho'] < a['abajo']) ||
        a['calidad'] < .8 ||
        a['derecha'] - a['izquierda'] <= .05 ||
        a['abajo'] - a['arriba'] <= .05) {
      throw const FormatException('Anclas fotográficas inconsistentes.');
    }
    final zonas = a['estampados'];
    if (zonas != null &&
        (zonas is! List ||
            zonas.length > 16 ||
            zonas.any(
              (z) =>
                  z is! List ||
                  z.length != 4 ||
                  z.any((v) => v is! num || !v.isFinite || v < 0 || v > 1) ||
                  z[0] >= z[2] ||
                  z[1] >= z[3],
            ))) {
      throw const FormatException(
        'Las zonas de estampado no cumplen el contrato.',
      );
    }
    return RecursoProbador._(Map<String, dynamic>.unmodifiable(j));
  }
}
