import 'package:clb_store/datos/registro_actividad_sqlite.dart';
import 'package:clb_store/dominio/actividad.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_gestion.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:clb_store/presentacion/pantalla_gestion.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../apoyo.dart';

/// Gestión falsa: devuelve lo que diría el orquestador para una misión de inventario.
class _Gestion implements FuenteGestion {
  final misiones = <String>[];

  @override
  Future<Map<String, dynamic>> mision(String texto, String token) async {
    misiones.add(texto);
    return {
      'mision': texto,
      'generativa': true,
      'fecha': '2026-11-10T18:05:09Z',
      'agentes': [
        {
          'agente': 'inventario',
          'respuesta': 'Reponer primero CLB-SEM-CAM-LIN-M: quedan 2 unidades.',
          'generativa': true,
          'herramientas_permitidas': ['stock_critico', 'proponer_reposicion'],
          'fuentes': [
            {'herramienta': 'stock_critico', 'argumentos': {'limite': 10}, 'resultado': {'variantes': []}},
          ],
        },
      ],
    };
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

class _SinRed implements FuenteCatalogo {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw SinConexion();
}

void main() {
  testWidgets('la misión escrita llega tal cual a ejecutarMision y se muestra solo lo devuelto', (tester) async {
    final gestion = _Gestion();
    late EstadoGestion g;
    late RegistroActividadSqlite actividad;
    await tester.runAsync(() async {
      final almacen = await almacenEnMemoria();
      actividad = await RegistroActividadSqlite.abrir(
        databaseFactoryFfiNoIsolate,
        inMemoryDatabasePath,
        instanciaUnica: false,
      );
      final sesion = SesionFalsa()
        ..actual = const Titular(sub: 'vendedor-sub', usuario: 'admin.demo', nombre: 'Admin', roles: {'admin'});
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
        gestion: gestion,
        actividad: actividad,
      )..titular = sesion.actual;
      g = EstadoGestion(tienda)..conectada = true;
    });
    tester.view.physicalSize = const Size(1080, 6000);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: PantallaMision(g)));

    final ejecutar = find.widgetWithText(FilledButton, 'Ejecutar misión');
    expect(tester.widget<FilledButton>(ejecutar).onPressed, isNull);
    expect(find.text('Monitorear ahora'), findsOneWidget);

    const pedido = '¿Qué productos debería reponer primero?';
    await tester.enterText(find.byType(TextField), pedido);
    await tester.pump();
    await tester.runAsync(() async {
      await tester.tap(ejecutar);
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pump();

    expect(gestion.misiones, [pedido]);
    expect(find.text('Inventario'), findsOneWidget);
    expect(find.text('Monitoreo'), findsNothing);
    expect(find.textContaining('quedan 2 unidades'), findsOneWidget);
    expect(find.text('Ver detalles · 1 herramienta'), findsOneWidget);

    await tester.tap(find.text('Ver detalles · 1 herramienta'));
    await tester.pumpAndSettle();
    expect(find.text('stock_critico'), findsOneWidget);
    // Permitida pero no invocada: aparece solo como permitida, no como utilizada.
    expect(find.text('proponer_reposicion'), findsNothing);

    final eventos = await tester.runAsync(() => actividad.leer('vendedor-sub'));
    expect(eventos!.map((e) => e.funcionalidad), containsAll(['Misión libre', 'Misión completada']));
    expect(eventos.first.descripcion, contains('stock_critico'));
    expect(eventos.first.severidad, Severidad.success);
  });
}
