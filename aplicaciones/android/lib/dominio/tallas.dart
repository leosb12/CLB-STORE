/// Talla orientativa con el modelo supervisado de la fase 8 (regresión logística multinomial exportada a JSON por el
/// servicio de IA). Port 1:1 de `probador-virtual/fuente/dominio/tallas.ts`: la misma fórmula, sin librerías, para que
/// funcione sin conexión y dé las mismas probabilidades que el servicio (prueba con el mismo fixture).
library;

import 'dart:math';

const caracteristicas = ['altura_cm', 'peso_kg', 'pecho_cm', 'cintura_cm'];

/// Los mismos límites que validan el perfil de Clientes y el servicio de IA.
const limites = {
  'altura_cm': (100.0, 230.0),
  'peso_kg': (30.0, 250.0),
  'pecho_cm': (50.0, 200.0),
  'cintura_cm': (40.0, 200.0),
};

/// Tabla de tallas de referencia (la misma de IA y del probador web). Solo se muestra cuando el modelo nunca llegó al
/// teléfono: el cliente puede guiarse con una cinta métrica sin que se invente una talla. Pecho y cintura en cm.
const tablaReferencia = {
  'XS': ((78, 86), (62, 70)),
  'S': ((86, 94), (70, 78)),
  'M': ((94, 102), (78, 86)),
  'L': ((102, 110), (86, 96)),
  'XL': ((110, 120), (96, 108)),
};

/// Por debajo de esta probabilidad la talla se presenta como «entre dos tallas».
const probabilidadSegura = 0.6;

class ModeloTallasInvalido implements Exception {
  @override
  String toString() => 'El modelo de tallas no tiene la forma esperada.';
}

class ModeloTallas {
  ModeloTallas._(
    this.clases,
    this.media,
    this.escala,
    this.coeficientes,
    this.intercepto,
    this.exactitud,
    this.tabla,
    this.version,
    this.json,
  );

  final List<String> clases;
  final List<double> media;
  final List<double> escala;
  final List<List<double>> coeficientes;
  final List<double> intercepto;
  final double exactitud;

  /// talla → característica → (mínimo, máximo).
  final Map<String, Map<String, (double, double)>> tabla;
  final num version;

  /// JSON original, para guardarlo en el dispositivo.
  final Map<String, dynamic> json;

  /// El modelo llega por red o desde SQLite: se valida su forma completa antes de usarlo.
  factory ModeloTallas.validar(Object? datos) {
    try {
      final m = datos as Map<String, dynamic>;
      final n = caracteristicas.length;
      final clases = (m['clases'] as List).cast<String>();
      List<double> vector(Object? v, int largo) {
        final l = (v as List).map((x) => (x as num).toDouble()).toList();
        if (l.length != largo || l.any((x) => !x.isFinite))
          throw ModeloTallasInvalido();
        return l;
      }

      // Un coeficiente de este tamaño desborda exp() y vuelve arbitraria la recomendación.
      bool acotado(double x) => x.abs() < 1000;
      final media = vector(m['media'], n);
      final escala = vector(m['escala'], n);
      final intercepto = vector(m['intercepto'], clases.length);
      final coeficientes = (m['coeficientes'] as List)
          .map((f) => vector(f, n))
          .toList();
      final exactitud = ((m['metricas'] as Map)['exactitud'] as num).toDouble();
      final tablaJson = m['tabla'] as Map<String, dynamic>;
      final tabla = {
        for (final c in clases)
          c: {
            for (final k in caracteristicas)
              k: () {
                final r = vector((tablaJson[c] as Map)[k], 2);
                if (r[0] > r[1]) throw ModeloTallasInvalido();
                return (r[0], r[1]);
              }(),
          },
      };
      final valido =
          m['tipo'] == 'regresion_logistica_multinomial' &&
          m['version'] is num &&
          (m['caracteristicas'] as List).join(',') ==
              caracteristicas.join(',') &&
          clases.length >= 2 &&
          clases.every((c) => c.isNotEmpty && c.length <= 8) &&
          clases.toSet().length == clases.length &&
          escala.every((s) => s > 0) &&
          coeficientes.length == clases.length &&
          coeficientes.every((f) => f.every(acotado)) &&
          intercepto.every(acotado) &&
          exactitud >= 0 &&
          exactitud <= 1 &&
          m['aviso'] is String;
      if (!valido) throw ModeloTallasInvalido();
      return ModeloTallas._(
        clases,
        media,
        escala,
        coeficientes,
        intercepto,
        exactitud,
        tabla,
        m['version'],
        m,
      );
    } on ModeloTallasInvalido {
      rethrow;
    } catch (_) {
      throw ModeloTallasInvalido();
    }
  }
}

class RecomendacionTalla {
  const RecomendacionTalla(
    this.talla,
    this.probabilidades,
    this.alternativa,
    this.tallaPorTabla,
  );
  final String talla;
  final Map<String, double> probabilidades;

  /// Segunda talla más probable cuando la primera no supera [probabilidadSegura].
  final String? alternativa;
  final String tallaPorTabla;
}

/// Devuelve el mensaje del primer campo fuera de rango, o null si las medidas son válidas.
String? validarMedidas(Map<String, double?> medidas) {
  for (final nombre in caracteristicas) {
    final valor = medidas[nombre];
    final (minimo, maximo) = limites[nombre]!;
    if (valor == null || !valor.isFinite || valor < minimo || valor > maximo) {
      return '$nombre debe estar entre ${minimo.toInt()} y ${maximo.toInt()}.';
    }
  }
  return null;
}

/// softmax(coeficientes · ((x − media) / escala) + intercepto), con la resta del máximo para estabilidad numérica.
RecomendacionTalla inferirTalla(
  ModeloTallas modelo,
  Map<String, double> medidas,
) {
  final z = [
    for (var i = 0; i < caracteristicas.length; i++)
      (medidas[caracteristicas[i]]! - modelo.media[i]) / modelo.escala[i],
  ];
  final puntajes = [
    for (var k = 0; k < modelo.clases.length; k++)
      modelo.coeficientes[k].asMap().entries.fold(
        modelo.intercepto[k],
        (s, e) => s + e.value * z[e.key],
      ),
  ];
  final maximo = puntajes.reduce(max);
  final exponentes = puntajes.map((p) => exp(p - maximo)).toList();
  final total = exponentes.reduce((a, b) => a + b);
  final probabilidades = {
    for (var k = 0; k < modelo.clases.length; k++)
      modelo.clases[k]: exponentes[k] / total,
  };
  final orden = [...modelo.clases]
    ..sort((a, b) => probabilidades[b]!.compareTo(probabilidades[a]!));
  return RecomendacionTalla(
    orden[0],
    probabilidades,
    probabilidades[orden[0]]! < probabilidadSegura ? orden[1] : null,
    tallaPorTabla(modelo, medidas['pecho_cm']!),
  );
}

/// Talla cuyo centro de pecho está más cerca: la referencia que el cliente comprueba con una cinta (igual que en IA).
String tallaPorTabla(ModeloTallas modelo, double pecho) {
  var mejor = modelo.clases.first;
  var distancia = double.infinity;
  for (final talla in modelo.clases) {
    final (minimo, maximo) = modelo.tabla[talla]!['pecho_cm']!;
    final d = ((minimo + maximo) / 2 - pecho).abs();
    if (d < distancia) {
      mejor = talla;
      distancia = d;
    }
  }
  return mejor;
}
