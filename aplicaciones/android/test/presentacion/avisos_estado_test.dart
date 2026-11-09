import 'dart:async';

import 'package:clb_store/dominio/avisos.dart';
import 'package:clb_store/dominio/casos_de_uso.dart';
import 'package:clb_store/dominio/contratos.dart';
import 'package:clb_store/dominio/modelos.dart';
import 'package:clb_store/presentacion/estado_tienda.dart';
import 'package:clb_store/presentacion/pantalla_cuenta.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../apoyo.dart';

/// F3: vínculo del teléfono con la cuenta (login, logout sin red, cambio de cuenta en vuelo, renovación del token),
/// permiso de Android, preferencias en la cola (offline, por titular, incierto, conflicto) y recepción/toque.
void main() {
  const a = Titular(sub: 'aaaaaaaa-0000-4000-8000-000000000001', usuario: 'a', nombre: 'A', roles: {'cliente'});
  const b = Titular(sub: 'bbbbbbbb-0000-4000-8000-000000000002', usuario: 'b', nombre: 'B', roles: {'cliente'});

  Future<(EstadoTienda, _Sesion, _Servidor, _Avisos)> crear({Titular? titular = a}) async {
    final almacen = await almacenEnMemoria();
    final sesion = _Sesion()..actual = titular;
    final servidor = _Servidor(), avisos = _Avisos();
    final estado = EstadoTienda(
      almacen: almacen,
      sincronizarCatalogo: SincronizarCatalogo(_SinRed(), almacen),
      carrito: Carrito(almacen),
      confirmarPedido: ConfirmarPedido(almacen, sesion),
      sincronizarPedidos: SincronizarPedidos(almacen, VentasFalsas(), sesion, null, {guardarPreferenciasAvisos: servidor}),
      tallas: RecomendarTalla(almacen),
      sesion: sesion,
      conectividad: const Stream.empty(),
      probador: () => throw UnimplementedError(),
      elegirFoto: (_) async => null,
      avisos: avisos,
      fuenteAvisos: servidor,
      instalacion: _Identidad(),
    );
    addTearDown(() async {
      estado.dispose();
      await pumpEventQueue();
      await almacen.cerrar();
    });
    await estado.iniciar();
    await pumpEventQueue();
    return (estado, sesion, servidor, avisos);
  }

  /// SQLite corre fuera del bucle de eventos: se espera la condición, con límite.
  Future<void> hasta(bool Function() condicion) async {
    for (var i = 0; i < 400 && !condicion(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(condicion(), isTrue);
  }

  Future<void> drenar(EstadoTienda estado) async {
    await pumpEventQueue();
    await estado.enviarPedidos(forzar: true);
    await pumpEventQueue();
  }

  group('vínculo del dispositivo', () {
    test('con sesión registra el teléfono para el titular; la renovación del token lo vuelve a registrar', () async {
      final (estado, _, servidor, avisos) = await crear();
      expect(servidor.vinculos, {'inst-1': a.sub});
      expect(servidor.tokens['inst-1'], 'push-1');
      avisos.token_ = 'push-2';
      avisos.renovaciones_.add('push-2');
      await pumpEventQueue();
      expect(servidor.tokens['inst-1'], 'push-2');
      expect(servidor.vincular_, 2);
      await estado.sincronizarDispositivo();
      expect(servidor.vincular_, 2, reason: 'ya confirmado: no repite la petición');
    });

    test('logout sin red no bloquea; al volver la red se desvincula con el secreto y se olvida el token', () async {
      final (estado, _, servidor, avisos) = await crear();
      servidor.sinRed = true;
      await estado.cerrarSesion();
      await pumpEventQueue();
      expect(estado.titular, isNull);
      expect(servidor.vinculos, {'inst-1': a.sub}, reason: 'límite declarado: el servidor conserva A mientras no hay red');
      servidor.sinRed = false;
      await estado.sincronizarDispositivo();
      expect(servidor.vinculos, isEmpty);
      expect(servidor.secretosUsados.last, 'secreto-1');
      expect(avisos.olvidos, 1);
    });

    test('logout offline de A y login de B: un solo vínculo, para B', () async {
      final (estado, sesion, servidor, _) = await crear();
      servidor.sinRed = true;
      await estado.cerrarSesion();
      await pumpEventQueue();
      servidor.sinRed = false;
      sesion.actual = b;
      await estado.iniciarSesion();
      await pumpEventQueue();
      expect(servidor.vinculos, {'inst-1': b.sub});
    });

    test('cambio de cuenta con la vinculación en vuelo: converge a la cuenta nueva sin esperar otro evento', () async {
      final (estado, sesion, servidor, _) = await crear(titular: null);
      expect(servidor.vinculos, isEmpty);
      sesion.actual = a;
      estado.titular = a;
      servidor.bloqueo = Completer<void>();
      unawaited(estado.sincronizarDispositivo());
      await hasta(() => servidor.enVuelo);
      sesion.actual = b;
      estado.titular = b;
      await estado.sincronizarDispositivo(); // llega durante la otra: no se pierde
      servidor.bloqueo!.complete();
      await hasta(() => servidor.vinculos['inst-1'] == b.sub);
      await pumpEventQueue();
      expect(servidor.vinculos, {'inst-1': b.sub});
    });

    test('logout con la vinculación en vuelo: termina desvinculado', () async {
      final (estado, sesion, servidor, _) = await crear(titular: null);
      sesion.actual = a;
      estado.titular = a;
      servidor.bloqueo = Completer<void>();
      unawaited(estado.sincronizarDispositivo());
      await hasta(() => servidor.enVuelo);
      sesion.actual = null;
      estado.titular = null;
      unawaited(estado.sincronizarDispositivo());
      servidor.bloqueo!.complete();
      await hasta(() => servidor.vincular_ == 1 && servidor.vinculos.isEmpty);
    });
  });

  group('recepción', () {
    test('una sola suscripción por flujo; primer plano → aviso; toque → Pedidos; dispose las cancela', () async {
      final (estado, _, _, avisos) = await crear();
      expect(avisos.oyentes, {'recibidos': 1, 'tocados': 1, 'renovaciones': 1});
      avisos.recibidos_.add(const AvisoPedido(titulo: 'CLB Store', cuerpo: 'Pedido #ABCD confirmado', datos: {}));
      avisos.tocados_.add(const AvisoPedido(titulo: 't', cuerpo: 'c', datos: {'destino': 'pedidos', 'pedido': 'x'}));
      await pumpEventQueue();
      expect(estado.avisoEnPrimerPlano.value?.cuerpo, 'Pedido #ABCD confirmado');
      expect(estado.pestanaSolicitada.value, 2);
    });
  });

  group('permiso de Android', () {
    test('Push activo por defecto sin permiso: se concede desde Cuenta sin tocar la preferencia', () async {
      final (estado, _, _, avisos) = await crear();
      expect(estado.preferenciasAvisos.push, isTrue);
      expect(estado.permisoAvisos, PermisoAvisos.sinDecidir);
      await estado.solicitarPermisoAvisos();
      expect(avisos.solicitudes, 1);
      expect(estado.permisoAvisos, PermisoAvisos.concedido);
      expect(estado.operacionesPreferencias, isEmpty);
    });

    test('cambiar Correo no pide permiso; encender Push sí', () async {
      final (estado, _, _, avisos) = await crear();
      await estado.cambiarPreferenciasAvisos(push: true, correo: false);
      expect(avisos.solicitudes, 0);
      await drenar(estado);
      await estado.cambiarPreferenciasAvisos(push: false, correo: false);
      await drenar(estado);
      await estado.cambiarPreferenciasAvisos(push: true, correo: false);
      expect(avisos.solicitudes, 1);
    });

    testWidgets('la pantalla Cuenta ofrece «Permitir notificaciones» y lo solicita', (tester) async {
      late EstadoTienda estado;
      late _Avisos avisos;
      await tester.runAsync(() async {
        (estado, _, _, avisos) = await crear();
      });
      // En la app, el padre escucha el estado (ListenableBuilder); aquí igual.
      await tester.pumpWidget(MaterialApp(
        home: ListenableBuilder(listenable: estado, builder: (_, _) => PantallaCuenta(estado)),
      ));
      await tester.runAsync(pumpEventQueue);
      await tester.pump();
      final boton = find.text('Permitir notificaciones');
      await tester.scrollUntilVisible(boton, 200);
      await tester.tap(boton);
      await tester.runAsync(pumpEventQueue);
      await tester.pump();
      expect(avisos.solicitudes, 1);
      expect(find.text('Permitir notificaciones'), findsNothing);
    });
  });

  group('preferencias', () {
    test('Push, Correo, ambos o ninguno: cada combinación llega al servidor con versión creciente', () async {
      final (estado, _, servidor, _) = await crear();
      for (final (push, correo) in [(true, false), (false, true), (false, false), (true, true)]) {
        await estado.cambiarPreferenciasAvisos(push: push, correo: correo);
        await drenar(estado);
        expect(servidor.prefs[a.sub], (push: push, correo: correo, version: servidor.prefs[a.sub]!.version));
        expect(estado.preferenciasAvisos.push, push);
        expect(estado.preferenciasAvisos.correo, correo);
      }
      expect(servidor.prefs[a.sub]!.version, 4);
      expect(estado.preferenciasPendientes, isFalse);
    });

    test('sin red se guardan en el teléfono, sobreviven y se sincronizan al volver', () async {
      final (estado, _, servidor, _) = await crear();
      servidor.sinRed = true;
      await estado.cambiarPreferenciasAvisos(push: false, correo: true);
      await drenar(estado);
      expect(estado.preferenciasPendientes, isTrue);
      expect(estado.preferenciasAvisos.push, isFalse, reason: 'lo elegido manda en pantalla');
      servidor.sinRed = false;
      await drenar(estado);
      expect(estado.preferenciasPendientes, isFalse);
      expect(servidor.prefs[a.sub]?.push, isFalse);
    });

    test('envío incierto: no reutiliza la clave con otro cuerpo; el nuevo cambio va tras él y gana el último', () async {
      final (estado, _, servidor, _) = await crear();
      servidor.perderRespuesta = true;
      await estado.cambiarPreferenciasAvisos(push: false, correo: true);
      await pumpEventQueue();
      servidor.perderRespuesta = false;
      final incierta = estado.operacionesPreferencias.single;
      expect(incierta.intentos, 1);
      servidor.sinRed = true;
      await estado.cambiarPreferenciasAvisos(push: false, correo: false);
      await pumpEventQueue();
      final ops = estado.operacionesPreferencias;
      expect(ops, hasLength(2));
      final antigua = ops.firstWhere((o) => o.identificador == incierta.identificador);
      expect(antigua.claveIdempotencia, incierta.claveIdempotencia);
      expect(antigua.datos, {'push': false, 'correo': true, 'versión': 0});
      expect(ops.firstWhere((o) => o != antigua).datos?['tras'], incierta.identificador);
      servidor.sinRed = false;
      await drenar(estado);
      expect(servidor.prefs[a.sub], (push: false, correo: false, version: 2));
      expect(servidor.reutilizacionesConOtroCuerpo, 0);
      expect(estado.preferenciasPendientes, isFalse);
      expect(estado.preferenciasAvisos.correo, isFalse);
    });

    test('409: otro dispositivo cambió antes → revisión; «usar mis cambios» se aplica sobre la versión vigente', () async {
      final (estado, _, servidor, _) = await crear();
      servidor.prefs[a.sub] = (push: true, correo: true, version: 3);
      await estado.cambiarPreferenciasAvisos(push: false, correo: true);
      await drenar(estado);
      expect(estado.preferenciasEnRevision, isNotNull);
      await estado.resolverPreferencias(usarMias: true);
      await drenar(estado);
      expect(servidor.prefs[a.sub], (push: false, correo: true, version: 4));
      expect(estado.preferenciasEnRevision, isNull);
    });

    test('cada cuenta ve y envía solo lo suyo: el cambio offline de A no viaja con la sesión de B', () async {
      final (estado, sesion, servidor, _) = await crear();
      servidor.sinRed = true;
      await estado.cambiarPreferenciasAvisos(push: false, correo: false);
      await drenar(estado);
      await estado.cerrarSesion();
      servidor.sinRed = false;
      sesion.actual = b;
      await estado.iniciarSesion();
      await drenar(estado);
      expect(servidor.prefs.containsKey(a.sub), isFalse);
      expect(estado.preferenciasAvisos.push, isTrue);
      expect(estado.preferenciasAvisos.correo, isTrue);
    });
  });
}

typedef _Prefs = ({bool push, bool correo, int version});

/// Clientes en memoria: vínculo instalación→cuenta y preferencias con versión e Idempotency-Key (como el servidor real).
class _Servidor implements FuenteAvisos, ProcesadorOperacion {
  final vinculos = <String, String>{}, tokens = <String, String>{};
  final secretosUsados = <String>[];
  final prefs = <String, _Prefs>{};
  final _ultimo = <String, (String, String)>{};
  bool sinRed = false, perderRespuesta = false, enVuelo = false;
  Completer<void>? bloqueo;
  int vincular_ = 0, reutilizacionesConOtroCuerpo = 0;

  @override
  Future<PreferenciasAvisos> preferencias(String token) async {
    if (sinRed) throw SinConexion();
    final p = prefs[token.substring('jwt:'.length)] ?? (push: true, correo: true, version: 0);
    return PreferenciasAvisos(push: p.push, correo: p.correo, version: p.version, correoDisponible: true);
  }

  @override
  Future<void> vincular(String instalacion, String tokenPush, String secreto, String token) async {
    if (sinRed) throw SinConexion();
    enVuelo = true;
    await bloqueo?.future;
    bloqueo = null;
    enVuelo = false;
    vincular_++;
    vinculos[instalacion] = token.substring('jwt:'.length);
    tokens[instalacion] = tokenPush;
  }

  @override
  Future<void> desvincular(String instalacion, String secreto) async {
    if (sinRed) throw SinConexion();
    secretosUsados.add(secreto);
    vinculos.remove(instalacion);
    tokens.remove(instalacion);
  }

  @override
  Future<Map<String, dynamic>> enviar(Operacion op, String token) async {
    if (sinRed) throw SinConexion();
    final d = op.datos!, sub = op.titular;
    final actual = prefs[sub] ?? (push: true, correo: true, version: 0);
    final huella = '${d['push']}/${d['correo']}/${d['versión']}';
    Map<String, dynamic> resp(_Prefs p) => {
      'preferencias': {'push': p.push, 'correo': p.correo, 'versión': p.version, 'correo_disponible': true},
    };
    if (actual.version != d['versión']) {
      final ultimo = _ultimo[sub];
      if (ultimo?.$1 == op.claveIdempotencia) {
        if (ultimo!.$2 != huella) {
          reutilizacionesConOtroCuerpo++;
          throw ErrorRemoto(409, 'Clave reutilizada con otro cambio.');
        }
        return resp(actual);
      }
      throw ErrorRemoto(409, 'Las preferencias cambiaron en otro dispositivo.');
    }
    final nuevas = (push: d['push'] as bool, correo: d['correo'] as bool, version: actual.version + 1);
    prefs[sub] = nuevas;
    _ultimo[sub] = (op.claveIdempotencia, huella);
    if (perderRespuesta) throw SinConexion();
    return resp(nuevas);
  }
}

class _Avisos implements AvisosDispositivo {
  final recibidos_ = StreamController<AvisoPedido>.broadcast();
  final tocados_ = StreamController<AvisoPedido>.broadcast();
  final renovaciones_ = StreamController<String>.broadcast();
  final oyentes = <String, int>{};
  String? token_ = 'push-1';
  PermisoAvisos permiso_ = PermisoAvisos.sinDecidir;
  int solicitudes = 0, olvidos = 0;

  Stream<T> _contar<T>(String nombre, StreamController<T> c) => c.stream.transform(
    StreamTransformer.fromBind((s) {
      oyentes[nombre] = (oyentes[nombre] ?? 0) + 1;
      return s;
    }),
  );

  @override
  Future<bool> get listo async => true;
  int _generados = 1;
  // Como FCM: tras borrar el token, el siguiente getToken entrega uno nuevo.
  @override
  Future<String?> token() async => token_ ??= 'push-${++_generados}';
  @override
  Stream<String> get renovaciones => _contar('renovaciones', renovaciones_);
  @override
  Stream<AvisoPedido> get recibidos => _contar('recibidos', recibidos_);
  @override
  Stream<AvisoPedido> get tocados => _contar('tocados', tocados_);
  @override
  Future<PermisoAvisos> permiso() async => permiso_;
  @override
  Future<PermisoAvisos> solicitarPermiso() async {
    solicitudes++;
    return permiso_ = PermisoAvisos.concedido;
  }

  @override
  Future<void> olvidarToken() async {
    olvidos++;
    token_ = null;
  }
}

/// El JWT dice de quién es en el momento en que se pidió (como uno real).
class _Sesion extends SesionFalsa {
  @override
  Future<String?> tokenVigente() async => token == null || actual == null ? null : 'jwt:${actual!.sub}';
}

class _Identidad implements IdentidadInstalacion {
  @override
  Future<({String id, String secreto})> obtener() async => (id: 'inst-1', secreto: 'secreto-1');
}

class _SinRed implements FuenteCatalogo {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw SinConexion();
}
