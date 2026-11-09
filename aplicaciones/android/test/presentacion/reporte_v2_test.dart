import 'dart:convert';

import 'package:clb_store/datos/administracion_rest.dart';
import 'package:clb_store/datos/rest.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/presentacion/estado_gestion.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:clb_store/presentacion/pantalla_gestion.dart';
import 'package:clb_store/presentacion/reporte_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../apoyo.dart';

/// Reportes v2 en Android: mismo contrato, contenido y formato que la web; procedencia y salida veraces.
Map<String, dynamic> _reporte({List<String> formatos = const [], String? procedencia = 'MODELO'}) => {
  'identificador': 'r-1',
  'procedencia': procedencia,
  'generativa': procedencia == 'MODELO',
  'observacion': procedencia == 'REGLAS'
      ? 'El modelo de lenguaje del servidor no respondió a tiempo. Interpretación limitada por reglas.'
      : null,
  'interpretacion': 'Detalle de ventas · Cliente, Producto, Cantidad, Precio unitario, Total comprado',
  'especificacion': {'version': 2, 'formatos': formatos},
  'datos': {
    'version': 2,
    'titulo': 'Ventas de esta semana',
    'columnas': [
      {'campo': 'CLIENTE', 'etiqueta': 'Cliente', 'tipo': 'TEXTO'},
      {'campo': 'PRODUCTO', 'etiqueta': 'Producto', 'tipo': 'TEXTO'},
      {'campo': 'CANTIDAD', 'etiqueta': 'Cantidad', 'tipo': 'ENTERO'},
      {'campo': 'PRECIO_UNITARIO', 'etiqueta': 'Precio unitario', 'tipo': 'DINERO'},
      {'campo': 'SUBTOTAL', 'etiqueta': 'Total comprado', 'tipo': 'DINERO'},
    ],
    'filas': [
      ['Ana Pérez', 'Polera', 2, 10000, 20000],
      ['Beto Rojas', 'Buzo', 1, 22900, 22900],
    ],
    'total_filas': 2,
    'totales': {'CANTIDAD': 3, 'SUBTOTAL': 42900},
    'grafico': {
      'tipo': 'BARRAS', 'eje': 'CLIENTE', 'valor': 'MONTO', 'etiqueta_eje': 'Cliente',
      'etiqueta_valor': 'Ventas (Bs)', 'tipo_valor': 'DINERO',
      'puntos': [{'clave': 'Beto Rojas', 'valor': 22900}, {'clave': 'Ana Pérez', 'valor': 20000}],
    },
    'periodo': {'texto': 'esta semana (desde el lunes): 09/11/2026 al 09/11/2026'},
    'datos_al': '2026-11-09T14:00:00+00:00',
    'notas': ['Precios históricos: los de cada pedido al confirmarse.'],
  },
};

Future<List<String>> _montar(WidgetTester tester, Map<String, dynamic> reporte, {bool deCopia = false, bool conectada = true}) async {
  final compartidos = <String>[];
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: ResultadoReporteV2(reporte: reporte, deCopia: deCopia, conectada: conectada, compartir: compartidos.add),
      ),
    ),
  ));
  return compartidos;
}

void main() {
  test('formato boliviano: dinero desde centavos, miles con punto, fechas dd/mm/aaaa', () {
    expect(formatoCelda(123450, 'DINERO'), 'Bs 1.234,50');
    expect(formatoCelda(5, 'DINERO'), 'Bs 0,05');
    expect(formatoCelda(1500, 'ENTERO'), '1.500');
    expect(formatoCelda('2026-11-09', 'FECHA'), '09/11/2026');
    expect(formatoCelda(null, 'TEXTO'), '—');
  });

  test('salida y procedencia: mismas reglas que la web', () {
    String s(Map e) {
      final r = salidaDe(e);
      return '${r.pantalla} ${r.archivos.join('+')} ${r.pedidos}';
    }
    expect(s({'formatos': ['PDF']}), 'false PDF true');
    expect(s({'formatos': <String>[]}), 'true PDF+EXCEL false');
    expect(s({'formatos': ['PANTALLA', 'EXCEL']}), 'true EXCEL true');
    expect(procedenciaDe({'generativa': true}), 'MODELO');
    expect(procedenciaDe({'generativa': false, 'observacion': 'Especificación editada por el usuario.'}), 'MANUAL');
    expect(procedenciaDe({'generativa': false, 'observacion': 'Modelo no disponible'}), 'REGLAS');
  });

  testWidgets('solo PDF: interpretación y compartir PDF, sin tabla ni Excel', (tester) async {
    final compartidos = await _montar(tester, _reporte(formatos: ['PDF']));
    expect(find.byType(DataTable), findsNothing);
    expect(find.text('Compartir PDF'), findsOneWidget);
    expect(find.text('Compartir Excel'), findsNothing);
    expect(find.textContaining('Pediste solo PDF'), findsOneWidget);
    expect(find.text('Interpretado por el modelo de lenguaje del servidor'), findsOneWidget);
    await tester.tap(find.text('Compartir PDF'));
    expect(compartidos, ['PDF']);
  });

  testWidgets('en pantalla: columnas pedidas, precios en Bs, total y gráfico; reglas y copia se declaran', (tester) async {
    await _montar(tester, _reporte(procedencia: 'REGLAS'), deCopia: true, conectada: false);
    expect(find.byType(DataTable), findsOneWidget);
    for (final texto in ['Cliente', 'Precio unitario', 'Total comprado', 'Bs 100,00', 'Bs 429,00', 'Total']) {
      expect(find.text(texto), findsWidgets, reason: texto);
    }
    expect(find.text('Ventas (Bs) por cliente'), findsOneWidget);
    expect(find.text('Interpretación limitada por reglas'), findsOneWidget);
    expect(find.textContaining('no respondió a tiempo'), findsOneWidget);
    expect(find.text('Copia guardada sin conexión'), findsOneWidget);
    expect(find.text('Compartir PDF'), findsOneWidget);
    expect(find.text('Compartir Excel'), findsOneWidget);
    await _montar(tester, _reporte(), deCopia: true);
    expect(find.text('Último reporte guardado en este teléfono'), findsOneWidget);
    expect(find.text('Copia guardada sin conexión'), findsNothing);
  });

  test('el adaptador envía la elección de salida y pide la procedencia', () async {
    late Map<String, dynamic> cuerpo;
    final fuente = AdministracionRest(ClienteJson(MockClient((r) async {
      cuerpo = jsonDecode(r.body) as Map<String, dynamic>;
      return http.Response.bytes(utf8.encode(jsonEncode({'data': {'generarReporte': _reporte(formatos: ['PDF'])}})), 200,
          headers: {'content-type': 'application/json'});
    })));
    final r = await fuente.reporte('ventas de la semana', 'jwt', formatos: ['PDF']);
    expect((cuerpo['variables'] as Map)['f'], ['PDF']);
    expect(cuerpo['query'], contains('procedencia'));
    expect(r['procedencia'], 'MODELO');
    final sinEleccion = AdministracionRest(ClienteJson(MockClient((r) async {
      cuerpo = jsonDecode(r.body) as Map<String, dynamic>;
      return http.Response.bytes(utf8.encode(jsonEncode({'errors': [{'message': 'No se registra el costo de las prendas.',
        'extensions': {'codigo': 'NO_DISPONIBLE', 'estado_http': 422}}]})), 200,
          headers: {'content-type': 'application/json'});
    })));
    await expectLater(sinEleccion.reporte('margen', 'jwt'),
        throwsA(isA<ErrorRemoto>().having((e) => e.mensaje, 'mensaje', contains('costo'))));
    expect((cuerpo['variables'] as Map)['f'], isNull);
  });

  testWidgets('la pantalla Reportes dibuja un reporte v2 (filas en listas) sin romper el render v1', (tester) async {
    late EstadoGestion g;
    await tester.runAsync(() async {
      final almacen = await almacenEnMemoria();
      final sesion = SesionFalsa();
      final tienda = EstadoTienda(
        almacen: almacen,
        sincronizarCatalogo: SincronizarCatalogo(_SinRed(), almacen),
        carrito: Carrito(almacen),
        confirmarPedido: ConfirmarPedido(almacen, sesion),
        sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
        tallas: RecomendarTalla(almacen),
        sesion: sesion,
        conectividad: const Stream.empty(),
        probador: () => throw UnimplementedError(),
        elegirFoto: (_) async => null,
      );
      g = EstadoGestion(tienda)
        ..reporte = _reporte(formatos: ['PANTALLA'])
        ..conectada = true;
    });
    await tester.pumpWidget(MaterialApp(home: PantallaReportes(g)));
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.byType(DataTable), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Ana Pérez'), findsWidgets);
  });
}

class _SinRed implements FuenteCatalogo {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw SinConexion();
}
