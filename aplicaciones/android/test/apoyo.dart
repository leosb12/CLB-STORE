import 'package:clb_store/datos/almacen_sqlite.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// SQLite real (FFI) en memoria: las pruebas usan el mismo adaptador que la app.
Future<AlmacenSqlite> almacenEnMemoria() {
  sqfliteFfiInit();
  return AlmacenSqlite.abrir(databaseFactoryFfiNoIsolate, inMemoryDatabasePath, instanciaUnica: false);
}

const producto = Producto(
  identificador: 'bbac86c9ecd26898f1e3f757b1efad44',
  sku: 'CLB-SEM-CAM-LIN',
  nombre: 'Camisa de lino',
  descripcion: 'Camisa de lino de la colección CLB.',
  categoria: 'Camisas',
  precioCentavos: 21900,
  fechaActualizacion: '2026-10-22T13:14:30.350000Z',
);

Variante variante(String id, String talla, {String color = 'Blanco', int disponible = 24}) => Variante(
  identificador: id,
  identificadorProducto: producto.identificador,
  sku: 'CLB-SEM-CAM-LIN-$talla-${color.substring(0, 3).toUpperCase()}',
  talla: talla,
  color: color,
  disponible: disponible,
);

const idM = 'a842e928-d9bf-4a0a-81b8-e02626ccc955';
const idL = '8588dcf6-d3cd-492a-9b2d-a6f9eee14b55';

class SesionFalsa implements Sesion {
  Titular? actual = const Titular(
    sub: 'c820b640-d877-45f3-ab1f-e0740c6b4cd4',
    usuario: 'cliente.demo',
    nombre: 'Cliente',
    roles: {'cliente'},
  );
  String? token = 'token';
  @override
  Future<Titular?> titular() async => actual;
  @override
  Future<String?> tokenVigente() async => token;
  @override
  Future<Titular> iniciar() async => actual!;
  @override
  Future<void> cerrar() async => actual = null;
}

Map<String, dynamic> pedidoJson(String id, {String estado = 'CONFIRMADO', bool comprobante = false}) => {
  'identificador': id,
  'identificador_cliente': 'c820b640-d877-45f3-ab1f-e0740c6b4cd4',
  'estado': estado,
  'motivo': null,
  'total': '438.00',
  'moneda': 'BOB',
  'líneas': [
    {'identificador_variante': idM, 'cantidad': 2},
  ],
  'comprobante_disponible': comprobante,
};

/// Ventas en memoria con su regla de idempotencia: la misma clave devuelve el pedido existente.
class VentasFalsas implements FuenteVentas {
  @override
  Future<List<PedidoVenta>> historial(String token) async => pedidos.values.map(PedidoVenta.desdeJson).toList();
  final pedidos = <String, Map<String, dynamic>>{};
  final claves = <String, String>{};
  int envios = 0;

  /// Errores a lanzar en los próximos envíos; `perderRespuesta` registra el pedido y luego simula que la red se cortó.
  final fallos = <Object>[];
  bool perderRespuesta = false;

  @override
  Future<PedidoVenta> confirmar(Operacion operacion, String token) async {
    envios++;
    if (fallos.isNotEmpty) throw fallos.removeAt(0);
    final id = claves.putIfAbsent(operacion.claveIdempotencia, () => operacion.identificador);
    pedidos.putIfAbsent(id, () => pedidoJson(id));
    if (perderRespuesta) {
      perderRespuesta = false;
      throw SinConexion();
    }
    return PedidoVenta.desdeJson(pedidos[id]!);
  }

  @override
  Future<PedidoVenta> consultar(String identificador, String token) async =>
      PedidoVenta.desdeJson(pedidos[identificador] ?? (throw ErrorRemoto(404, 'Pedido no encontrado.')));
}
