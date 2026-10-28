import 'dart:convert';

import 'package:clb_store/datos/almacen_sqlite.dart';
import 'package:clb_store/dominio/administracion.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

/// Inventario en memoria con su regla de idempotencia y control de versión: la misma clave devuelve el comprobante
/// original y una versión vieja responde 409.
class InventarioFalso implements ProcesadorOperacion {
  int version = 3;
  int stock = 10;
  final comprobantes = <String, Map<String, dynamic>>{};
  final claves = <String>[];
  bool perderRespuesta = false;

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    claves.add(op.claveIdempotencia);
    final previo = comprobantes[op.claveIdempotencia];
    if (previo != null) return previo;
    final esperada = op.datos!['versión_esperada'];
    if (esperada != version) throw ErrorRemoto(409, 'La variante cambió.');
    version++;
    stock += op.datos!['cantidad'] as int;
    final comprobante = {
      'variante': {
        'identificador': op.datos!['identificador_variante'],
        'versión_sincronización': version,
      },
    };
    comprobantes[op.claveIdempotencia] = comprobante;
    if (perderRespuesta) {
      perderRespuesta = false;
      throw SinConexion();
    }
    return comprobante;
  }
}

const admin = Titular(
  sub: 'a1a1a1a1-0000-4000-8000-000000000001',
  usuario: 'admin.demo',
  nombre: 'Admin',
  roles: {'admin'},
);
const otraCuenta = Titular(
  sub: 'b2b2b2b2-0000-4000-8000-000000000002',
  usuario: 'otro',
  nombre: 'Otro',
  roles: {'admin'},
);

VarianteAdmin varianteAdmin({int version = 3}) => VarianteAdmin.validar({
  'identificador': idM,
  'identificador_producto': producto.identificador,
  'sku': 'CLB-SEM-CAM-LIN-M-BLA',
  'talla': 'M',
  'color': 'Blanco',
  'física': 10,
  'reservada': 0,
  'disponible': 10,
  'mínimo': 2,
  'versión_sincronización': version,
});

void main() {
  late AlmacenSqlite almacen;
  late SesionFalsa sesion;
  late InventarioFalso inventario;
  late SincronizarPedidos sincronizar;
  var ahora = DateTime.utc(2026, 10, 27, 12);

  setUp(() async {
    almacen = await almacenEnMemoria();
    sesion = SesionFalsa()..actual = admin;
    inventario = InventarioFalso();
    sincronizar = SincronizarPedidos(
      almacen,
      VentasFalsas(),
      sesion,
      () => ahora,
      {registrarMovimiento: inventario},
    );
  });

  Future<Operacion> encolar(int cantidad, {Titular titular = admin}) async {
    ahora = ahora.add(const Duration(seconds: 1));
    final op = operacionExistencias(
      tipo: registrarMovimiento,
      variante: varianteAdmin(),
      cuerpo: {'tipo': 'ENTRADA', 'cantidad': cantidad, 'motivo': 'Recepción'},
      titular: titular.sub,
      ahora: ahora,
      cola: await almacen.operaciones(),
    );
    await almacen.encolarOperacion(op);
    return op;
  }

  Future<Operacion> leer(String id) async =>
      (await almacen.operaciones()).firstWhere((o) => o.identificador == id);

  test(
    'un pedido guardado por la versión anterior de la app se lee intacto (sin claves nuevas en su JSON)',
    () async {
      final pedido = Operacion.pedido(
        [
          LineaCarrito.desdeJson({
            'identificador_variante': idM,
            'identificador_producto': producto.identificador,
            'sku': 'S',
            'nombre': 'Camisa',
            'talla': 'M',
            'color': 'Blanco',
            'precio_centavos': 21900,
            'cantidad': 2,
          }),
        ],
        'c820b640-d877-45f3-ab1f-e0740c6b4cd4',
        ahora,
      );
      final viejo = operacionAJson(pedido)
        ..remove('datos')
        ..remove('respuesta')
        ..remove('reemplazada_por');
      final leido = operacionDesdeJson(jsonDecode(jsonEncode(viejo)));
      expect(leido.identificador, pedido.identificador);
      expect(leido.claveIdempotencia, pedido.claveIdempotencia);
      expect(leido.esPedido, isTrue);
      expect(leido.carrito.single.cantidad, 2);
      expect(leido.datos, isNull);
    },
  );

  test(
    'las propuestas offline sobre una variante se encadenan: la segunda toma la versión del comprobante de la primera',
    () async {
      final primera = await encolar(5);
      final segunda = await encolar(3);
      expect(primera.datos!['versión_esperada'], 3);
      expect(segunda.datos!.containsKey('versión_esperada'), isFalse);
      await sincronizar.ejecutar(forzar: true);
      // FIFO en un mismo ciclo: la primera confirma y la segunda espera al siguiente.
      await sincronizar.ejecutar(forzar: true);
      expect(
        (await leer(primera.identificador)).estado,
        EstadoOperacion.confirmada,
      );
      final s = await leer(segunda.identificador);
      expect(s.estado, EstadoOperacion.confirmada);
      expect(s.datos!['versión_esperada'], 4);
      expect(inventario.stock, 18);
    },
  );

  test(
    'respuesta perdida: el reintento usa la misma clave y el movimiento se aplica una sola vez',
    () async {
      final op = await encolar(5);
      inventario.perderRespuesta = true;
      await sincronizar.ejecutar(forzar: true);
      expect((await leer(op.identificador)).estado, EstadoOperacion.pendiente);
      await sincronizar.ejecutar(forzar: true);
      expect((await leer(op.identificador)).estado, EstadoOperacion.confirmada);
      expect(inventario.claves, [op.claveIdempotencia, op.claveIdempotencia]);
      expect(inventario.stock, 15);
    },
  );

  test(
    'cerrar la app durante el envío deja la operación PENDIENTE con la misma clave al volver',
    () async {
      final op = await encolar(5);
      await almacen.guardarOperacion(
        op.copiar(estado: EstadoOperacion.enviando),
      );
      await almacen.recuperarEnviando();
      final recuperada = await leer(op.identificador);
      expect(recuperada.estado, EstadoOperacion.pendiente);
      expect(recuperada.claveIdempotencia, op.claveIdempotencia);
      expect(recuperada.datos!['versión_esperada'], 3);
    },
  );

  test(
    'cambio de cuenta: la operación de A no se envía con B, ni con una cuenta sin rol admin',
    () async {
      final op = await encolar(5);
      sesion.actual = otraCuenta;
      await sincronizar.ejecutar(forzar: true);
      sesion.actual = Titular(
        sub: admin.sub,
        usuario: 'admin.demo',
        nombre: 'Admin',
        roles: const {'cliente'},
      );
      await sincronizar.ejecutar(forzar: true);
      expect(inventario.claves, isEmpty);
      expect((await leer(op.identificador)).estado, EstadoOperacion.pendiente);
      sesion.actual = admin;
      await sincronizar.ejecutar(forzar: true);
      expect((await leer(op.identificador)).estado, EstadoOperacion.confirmada);
    },
  );

  test(
    'un conflicto de versión pasa a revisión, sus dependientes esperan y «rehacer» los redirige al reemplazo',
    () async {
      inventario.version = 7; // otro dispositivo cambió la variante
      final primera = await encolar(5);
      final segunda = await encolar(2);
      await sincronizar.ejecutar(forzar: true);
      await sincronizar.ejecutar(forzar: true);
      expect(
        (await leer(primera.identificador)).estado,
        EstadoOperacion.requiereRevision,
      );
      // El dependiente espera: no se envía con una versión que ya se sabe vieja.
      expect(
        (await leer(segunda.identificador)).estado,
        EstadoOperacion.pendiente,
      );
      // Rehacer con la versión actual: una operación nueva; la antigua apunta a ella y no se vuelve a enviar.
      final nueva = operacionExistencias(
        tipo: registrarMovimiento,
        variante: varianteAdmin(version: 7),
        cuerpo: {'tipo': 'ENTRADA', 'cantidad': 5, 'motivo': 'Recepción'},
        titular: admin.sub,
        ahora: ahora.add(const Duration(seconds: 5)),
        cola: const [],
      );
      await almacen.reemplazarOperacion(
        await leer(primera.identificador),
        reemplazo(nueva, await leer(primera.identificador)),
      );
      await sincronizar.ejecutar(forzar: true);
      await sincronizar.ejecutar(forzar: true);
      expect(
        (await leer(primera.identificador)).reemplazadaPor,
        nueva.identificador,
      );
      expect(
        (await leer(nueva.identificador)).estado,
        EstadoOperacion.confirmada,
      );
      // Rehacer redirige al dependiente: toma la versión del reemplazo y se aplica después.
      final s = await leer(segunda.identificador);
      expect(s.estado, EstadoOperacion.confirmada);
      expect(s.datos!['versión_esperada'], 8);
      expect(inventario.stock, 17);
    },
  );

  test('una operación de administración no cuenta como pedido', () async {
    await encolar(1);
    expect((await almacen.operaciones()).where((o) => o.esPedido), isEmpty);
  });

  test(
    'cerrar sesión borra la caché administrativa del teléfono y conserva las preferencias del dispositivo',
    () async {
      await almacen.guardarPreferencia('gestion', '{"resumen":{}}');
      await almacen.guardarPreferencia('existencias:productos', '[]');
      await almacen.guardarPreferencia('ingesta:abc', '{}');
      await almacen.guardarPreferencia('modo_probador', 'ra');
      await almacen.borrarPreferencias(EstadoTienda.cacheAdministrativa);
      expect(await almacen.preferencia('gestion'), isNull);
      expect(await almacen.preferencia('existencias:productos'), isNull);
      expect(await almacen.preferencia('ingesta:abc'), isNull);
      expect(await almacen.preferencia('modo_probador'), 'ra');
    },
  );
}
