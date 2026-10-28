import 'dart:math';

import 'package:clb_store/dominio/modelos.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('el dinero va en centavos enteros y se muestra como en la web', () {
    expect(centavos('219.00'), 21900);
    expect(centavos('0.05'), 5);
    expect(importe(43805), '438,05 Bs');
    for (final malo in ['219', '219.5', '-1.00', '01.00', '1e3.00']) {
      expect(() => centavos(malo), throwsFormatException, reason: malo);
    }
  });

  test('los UUID del dispositivo son v4 y no se repiten', () {
    final ids = {for (var i = 0; i < 500; i++) nuevoUuid()};
    expect(ids.length, 500);
    expect(ids.every(esUuidV4), isTrue);
    expect(nuevoUuid(Random(1)), nuevoUuid(Random(1)));
  });

  test('qué errores se reintentan con la misma clave', () {
    for (final e in [
      SinConexion(),
      ContratoInvalido('x'),
      ErrorRemoto(500, ''),
      ErrorRemoto(401, ''),
      ErrorRemoto(429, ''),
    ]) {
      expect(esReintentable(e), isTrue, reason: '$e');
    }
    for (final e in [
      ErrorRemoto(400, ''),
      ErrorRemoto(403, ''),
      ErrorRemoto(409, ''),
      ErrorRemoto(422, ''),
      StateError('x'),
    ]) {
      expect(esReintentable(e), isFalse, reason: '$e');
    }
    expect([1, 2, 3, 4, 5, 9].map((i) => esperaTrasIntento(i).inSeconds), [5, 10, 20, 40, 60, 60]);
  });

  test('un pedido nuevo valida el carrito y su cuerpo no cambia entre reintentos', () {
    final ahora = DateTime.utc(2026, 10, 22);
    expect(() => Operacion.pedido([], 'sub', ahora), throwsArgumentError);
    const linea = LineaCarrito(
      identificadorVariante: 'v',
      identificadorProducto: 'p',
      sku: 's',
      nombre: 'n',
      talla: 'M',
      color: 'Azul',
      precioCentavos: 100,
      cantidad: 0,
    );
    expect(() => Operacion.pedido([linea], 'sub', ahora), throwsArgumentError);
    final op = Operacion.pedido([linea.conCantidad(2)], 'sub', ahora);
    expect(op.identificador, isNot(op.claveIdempotencia));
    final otra = trasEnvio(op, ahora, error: SinConexion());
    expect(
      [otra.identificador, otra.claveIdempotencia, otra.solicitud],
      [op.identificador, op.claveIdempotencia, op.solicitud],
    );
  });
}
