import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:clb_store/datos/registro_actividad_sqlite.dart';
import 'package:clb_store/dominio/actividad.dart';
import 'package:clb_store/presentacion/exportar_actividad.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  sqfliteFfiInit();
  late Directory carpeta;
  setUp(() => carpeta = Directory.systemTemp.createTempSync('clb_actividad'));
  tearDown(() => carpeta.deleteSync(recursive: true));

  Future<RegistroActividadSqlite> abrir() => RegistroActividadSqlite.abrir(
    databaseFactoryFfiNoIsolate,
    '${carpeta.path}/clb_actividad.db',
    instanciaUnica: false,
  );

  test('persiste al reabrir, aislado por cuenta y del más reciente al más antiguo', () async {
    var r = await abrir();
    await r.registrar('vendedor', CategoriaActividad.carrito, 'Agregar al carrito', 'Camisa · talla M', Severidad.success);
    await r.registrar('vendedor', CategoriaActividad.pedidos, 'Confirmar pedido', 'Guardado', Severidad.info);
    await r.registrar('otra', CategoriaActividad.sesion, 'Iniciar sesión', 'Sesión iniciada.', Severidad.success);
    await r.cerrar();

    r = await abrir();
    final eventos = await r.leer('vendedor');
    expect(eventos.map((e) => e.funcionalidad), ['Confirmar pedido', 'Agregar al carrito']);
    expect(eventos.last.severidad, Severidad.success);
    expect(eventos.last.fecha.isUtc, isTrue);
    expect(await r.leer('otra'), hasLength(1));
    await r.cerrar();
  });

  test('conserva solo los últimos $limiteActividad eventos por cuenta', () async {
    final r = await abrir();
    for (var i = 0; i < limiteActividad + 5; i++) {
      await r.registrar('vendedor', CategoriaActividad.catalogo, 'Evento $i', '', Severidad.info);
    }
    await r.registrar('otra', CategoriaActividad.catalogo, 'Ajena', '', Severidad.info);
    final eventos = await r.leer('vendedor');
    expect(eventos, hasLength(limiteActividad));
    expect(eventos.first.funcionalidad, 'Evento ${limiteActividad + 4}');
    expect(eventos.last.funcionalidad, 'Evento 5');
    expect(await r.leer('otra'), hasLength(1));
    await r.cerrar();
  });

  test('no guarda tokens, correos ni coordenadas aunque lleguen en un mensaje', () async {
    final r = await abrir();
    await r.registrar(
      'vendedor',
      CategoriaActividad.errores,
      'Error',
      'Bearer abc.def eyJhbGciOi.eyJzdWIi.firma en -17.78334, -63.18210 de ana@correo.bo -17.7520123',
      Severidad.error,
    );
    final texto = (await r.leer('vendedor')).single.descripcion;
    expect(texto, isNot(contains('eyJ')));
    expect(texto, isNot(contains('abc.def')));
    expect(texto, isNot(contains('-17.78')));
    expect(texto, isNot(contains('-63.18')));
    expect(texto, isNot(contains('-17.7520')));
    expect(texto, isNot(contains('ana@')));
    expect(sanear('Total 120.00 Bs · talla M'), 'Total 120.00 Bs · talla M');
    await r.cerrar();
  });

  test('exporta TXT, PDF y Excel con fecha, severidad y descripción', () {
    final eventos = [
      EventoActividad(
        fecha: DateTime.utc(2026, 11, 10, 18, 5, 9),
        categoria: CategoriaActividad.carrito,
        funcionalidad: 'Agregar al carrito',
        descripcion: 'Camisa (lino) · talla M <ñ>',
        severidad: Severidad.success,
      ),
    ];
    expect(utf8.decode(exportarTxt(eventos)), contains('SUCCESS | Carrito | Agregar al carrito | Camisa (lino)'));
    final pdf = latin1.decode(exportarPdf(eventos));
    expect(pdf, startsWith('%PDF-1.4'));
    expect(pdf, contains(r'Camisa \(lino\)'));
    expect(pdf.trimRight(), endsWith('%%EOF'));
    final libro = ZipDecoder().decodeBytes(exportarXlsx(eventos));
    final hoja = utf8.decode(libro.findFile('xl/worksheets/sheet1.xml')!.content);
    expect(hoja, contains('Camisa (lino) · talla M &lt;ñ&gt;'));
    expect(hoja, contains('SUCCESS'));
  });
}
