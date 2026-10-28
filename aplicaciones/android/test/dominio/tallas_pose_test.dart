import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:clb_store/dominio/pose.dart';
import 'package:clb_store/dominio/tallas.dart';
import 'package:flutter_test/flutter_test.dart';

// El mismo fixture que el probador web: modelo exportado por IA y probabilidades que devolvió el servicio.
final fixture = jsonDecode(File('test/fixtures/modelo-tallas.json').readAsStringSync()) as Map<String, dynamic>;
Map<String, dynamic> modeloJson() => jsonDecode(jsonEncode(fixture['modelo']));

Map<String, double> medidas(Map m) => {for (final e in m.entries) e.key as String: (e.value as num).toDouble()};

List<PuntoClave> pose(Map<String, (double, double)> visibles) => [
  for (final n in puntos)
    visibles.containsKey(n) ? PuntoClave(visibles[n]!.$1, visibles[n]!.$2, 0.9) : const PuntoClave(0, 0, 0.05),
];

void main() {
  test('la talla offline da las mismas probabilidades que el servicio de IA de la fase 8', () {
    final modelo = ModeloTallas.validar(modeloJson());
    for (final caso in fixture['casos'] as List) {
      final r = inferirTalla(modelo, medidas(caso['medidas']));
      expect(r.talla, caso['talla']);
      expect(r.tallaPorTabla, caso['talla_por_tabla']);
      (caso['probabilidades'] as Map).forEach((talla, p) => expect(r.probabilidades[talla], closeTo(p, 1e-3)));
    }
  });

  test('una talla con menos del 60 % se presenta junto a la segunda más probable', () {
    final modelo = ModeloTallas.validar(modeloJson());
    final dudosa = inferirTalla(modelo, {'altura_cm': 172, 'peso_kg': 74, 'pecho_cm': 102, 'cintura_cm': 88});
    expect([dudosa.talla, dudosa.alternativa], ['L', 'M']);
    expect(
      inferirTalla(modelo, {'altura_cm': 155, 'peso_kg': 48, 'pecho_cm': 82, 'cintura_cm': 66}).alternativa,
      isNull,
    );
  });

  test('un modelo mal formado o manipulado se rechaza antes de usarlo', () {
    void roto(void Function(Map<String, dynamic>) cambio) {
      final m = modeloJson();
      cambio(m);
      expect(() => ModeloTallas.validar(m), throwsA(isA<ModeloTallasInvalido>()));
    }

    roto((m) => m['tipo'] = 'otro');
    roto((m) => m['escala'] = [1, 0, 1, 1]);
    roto((m) => (m['coeficientes'] as List).removeAt(0));
    roto((m) => m['media'] = [1, 2, '3', 4]);
    roto((m) => m['caracteristicas'] = ['pecho_cm', 'altura_cm', 'peso_kg', 'cintura_cm']);
    roto((m) => m['clases'] = ['XS', 'XS', 'M', 'L', 'XL']);
    roto((m) => m['metricas'] = {'exactitud': 1.5});
    roto(
      (m) => m['coeficientes'] = [
        for (final f in m['coeficientes'] as List) [for (final _ in f as List) 1e6],
      ],
    );
    roto((m) => (m['tabla'] as Map)['M']['pecho_cm'] = [102, 94]);
    expect(() => ModeloTallas.validar(null), throwsA(isA<ModeloTallasInvalido>()));
  });

  test('las medidas usan los mismos límites que Clientes e IA', () {
    expect(validarMedidas({'altura_cm': 168, 'peso_kg': 66, 'pecho_cm': 95, 'cintura_cm': 80}), isNull);
    expect(validarMedidas({'altura_cm': 99, 'peso_kg': 66, 'pecho_cm': 95, 'cintura_cm': 80}), contains('altura_cm'));
    expect(
      validarMedidas({'altura_cm': 168, 'peso_kg': double.nan, 'pecho_cm': 95, 'cintura_cm': 80}),
      contains('peso_kg'),
    );
    expect(validarMedidas({'altura_cm': 168, 'pecho_cm': 95, 'cintura_cm': 80}), contains('peso_kg'));
  });

  test('una camiseta se ancla sobre el contorno de los hombros y llega hasta la cadera', () {
    final ajuste = calcularAjuste(
      pose({
        'hombro_izquierdo': (200, 100),
        'hombro_derecho': (100, 100),
        'cadera_izquierda': (190, 300),
        'cadera_derecha': (110, 300),
      }),
      TipoPrenda.superior,
    );
    final t = ajuste.transformacion!;
    final a = anclajes[TipoPrenda.superior]!;
    // El borde superior sube sobreHombros·W sobre las articulaciones: el largo crece en lo mismo.
    expect([t.x, t.y, t.angulo], [150, 100 - sobreHombros * 100, 0]);
    expect(t.escalaX * (a.derecha - a.izquierda) * 420, closeTo(100 * a.ensanche, 1e-9));
    expect(t.escalaY * (a.inferior - a.superior) * 460, closeTo((200 + sobreHombros * 100) * a.alargue, 1e-9));
    expect(ajuste.largoEstimado, isFalse);
  });

  test('la prenda rota con la línea de los hombros y conserva su proporción si falta la cadera', () {
    final ajuste = calcularAjuste(
      pose({'hombro_izquierdo': (200, 200), 'hombro_derecho': (100, 100)}),
      TipoPrenda.superior,
    );
    expect(ajuste.transformacion!.angulo, closeTo(pi / 4, 1e-9));
    expect(ajuste.transformacion!.escalaY, ajuste.transformacion!.escalaX);
    expect(ajuste.largoEstimado, isTrue);
  });

  test('sin hombros, persona diminuta o de perfil no se ajusta y se explica el motivo', () {
    expect(
      calcularAjuste(pose({'cadera_izquierda': (190, 300), 'cadera_derecha': (110, 300)}), TipoPrenda.superior).motivo,
      MotivoSinAjuste.sinPuntosSuperiores,
    );
    expect(
      calcularAjuste(pose({'hombro_izquierdo': (105, 100), 'hombro_derecho': (100, 100)}), TipoPrenda.superior).motivo,
      MotivoSinAjuste.personaMuyPequena,
    );
    expect(
      calcularAjuste(pose({'hombro_izquierdo': (110, 200), 'hombro_derecho': (100, 100)}), TipoPrenda.superior).motivo,
      MotivoSinAjuste.poseDePerfil,
    );
    for (final m in MotivoSinAjuste.values) {
      expect(explicarSinAjuste(m), isNotEmpty);
    }
  });

  test('el pantalón usa cadera y tobillos; el vestido, hombros y rodillas', () {
    expect(tipoDePrenda('Pantalones'), TipoPrenda.pantalon);
    expect(tipoDePrenda('Vestidos'), TipoPrenda.vestido);
    expect(tipoDePrenda('Camisetas'), TipoPrenda.superior);
    expect(ilustracionDe('Tejidos'), 'sueter');
    final piernas = pose({
      'cadera_izquierda': (180, 300),
      'cadera_derecha': (120, 300),
      'tobillo_izquierdo': (175, 600),
      'tobillo_derecho': (125, 600),
    });
    expect(calcularAjuste(piernas, TipoPrenda.pantalon).transformacion!.y, 300);
    expect(calcularAjuste(piernas, TipoPrenda.vestido).ajustado, isFalse);
  });

  test('con el torso inclinado el largo se mide perpendicular a los hombros', () {
    // Hombros horizontales y cadera desplazada 200 px a la derecha y 200 px abajo: el largo útil es 200 (+ el borde
    // sobre los hombros), no 283.
    final ajuste = calcularAjuste(
      pose({
        'hombro_izquierdo': (200, 100),
        'hombro_derecho': (100, 100),
        'cadera_izquierda': (390, 300),
        'cadera_derecha': (310, 300),
      }),
      TipoPrenda.superior,
    );
    final a = anclajes[TipoPrenda.superior]!;
    expect(
      ajuste.transformacion!.escalaY * (a.inferior - a.superior) * 460,
      closeTo((200 + sobreHombros * 100) * a.alargue, 1e-9),
    );
  });
}
