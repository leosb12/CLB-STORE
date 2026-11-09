import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_gestion.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

/// La gestión distingue una sesión vencida (Keycloak rechazó la renovación y la sesión local se borró: pedir login)
/// de un fallo de red (la sesión sigue guardada: mostrar la copia y reintentar).
void main() {
  const admin = Titular(sub: 'a-1', usuario: 'admin.demo', nombre: 'Admin', roles: {'admin'});

  Future<(EstadoTienda, SesionFalsa)> crear() async {
    final almacen = await almacenEnMemoria();
    final sesion = SesionFalsa()..actual = admin;
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_CatalogoVacio(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: const Stream.empty(),
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
    );
    estado.titular = admin;
    addTearDown(() async {
      estado.dispose();
      await almacen.cerrar();
    });
    return (estado, sesion);
  }

  test('token vigente: se entrega', () async {
    final (estado, _) = await crear();
    expect(await estado.exigirTokenAdmin(), 'token');
  });

  test('renovación rechazada (sesión local borrada): SesionVencida y el aviso pide iniciar sesión', () async {
    final (estado, sesion) = await crear();
    sesion
      ..token = null
      ..actual = null;
    expect(estado.exigirTokenAdmin(), throwsA(isA<SesionVencida>()));
    expect(explicar(const SesionVencida()), contains('iniciar sesión'));
    expect(explicar(const SesionVencida()), isNot(contains('Sin conexión')));
  });

  test('sin red al renovar (sesión guardada): SinConexion, no se pide login', () async {
    final (estado, sesion) = await crear();
    sesion.token = null;
    expect(estado.exigirTokenAdmin(), throwsA(isA<SinConexion>()));
  });
}

class _CatalogoVacio implements FuenteCatalogo {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw SinConexion();
}
