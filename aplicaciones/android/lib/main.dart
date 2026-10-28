import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

import 'datos/administracion_rest.dart';
import 'datos/almacen_sqlite.dart';
import 'datos/detector_movenet.dart';
import 'datos/compositor_camiseta.dart';
import 'datos/rest.dart';
import 'datos/servidor_probador.dart';
import 'datos/recursos_prendas.dart';
import 'datos/sesion_keycloak.dart';
import 'datos/probador_fotografico_rest.dart';
import 'datos/cola_generaciones_sqlite.dart';
import 'dominio/cola_generaciones.dart';
import 'dominio/administracion.dart';
import 'dominio/casos_de_uso.dart';
import 'presentacion/app.dart';
import 'presentacion/estado_tienda.dart';

/// Raíz de composición: crea los adaptadores de `datos` y los inyecta en los casos de uso del `dominio`.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final almacen = await AlmacenSqlite.abrir(
    databaseFactory,
    join(await getDatabasesPath(), 'clb_android.db'),
  );
  final cliente = ClienteJson(http.Client());
  // Administración y gestión (rol admin): mismas rutas que la web por la pasarela; sus cambios usan la cola única.
  final administracion = AdministracionRest(cliente);
  final procesadorExistencias = ProcesadorExistencias(cliente);
  final recursos = RecursosPrendas(
    join(await getDatabasesPath(), 'clb_prendas'),
    http.Client(),
    pasarela,
    espacioDisponible: () => const MethodChannel(
      'bo.clb.store/almacenamiento',
    ).invokeMethod<int>('disponible'),
  );
  final sesion = SesionKeycloak();
  final motorFotografico = ProbadorFotograficoRest(
    sesion,
    join(await getDatabasesPath(), 'clb_vton'),
    http.Client(),
  );
  final colaFotografica = ColaGeneraciones(
    await ColaGeneracionesSqlite.abrir(
      databaseFactory,
      join(await getDatabasesPath(), 'clb_vton_cola.db'),
      join(await getDatabasesPath(), 'clb_vton'),
    ),
    motorFotografico,
    sesion,
  );
  final selector = ImagePicker();
  Future<ProbarPrenda>? probador;
  late final EstadoTienda estado;
  // RA 3D: el microfrontend React se sirve desde 127.0.0.1 con los archivos de la APK y las texturas ya descargadas.
  final probadorRA = ServidorProbador(
    asset: rootBundle.load,
    textura: (hash) async {
      for (final p in estado.productos) {
        final r = p.recursoProbador;
        for (final x in [r, r?.espalda]) {
          if (x != null && x.hash == hash) return recursos.leer(x);
        }
      }
      return null;
    },
    modeloTallas: almacen.modeloTallas,
  );

  estado = EstadoTienda(
    almacen: almacen,
    sincronizarCatalogo: SincronizarCatalogo(
      CatalogoRest(cliente),
      almacen,
      null,
      recursos,
    ),
    carrito: Carrito(almacen),
    confirmarPedido: ConfirmarPedido(almacen, sesion),
    sincronizarPedidos:
        SincronizarPedidos(almacen, VentasRest(cliente), sesion, null, {
          registrarMovimiento: procesadorExistencias,
          configurarMinimo: procesadorExistencias,
          atenderAlerta: ProcesadorAtenderAlerta(cliente),
        }),
    tallas: RecomendarTalla(almacen),
    sesion: sesion,
    conectividad: Connectivity().onConnectivityChanged.map(
      (r) => !r.contains(ConnectivityResult.none),
    ),
    probador: () => probador ??= DetectorMoveNet.cargar()
        .then(ProbarPrenda.new)
        .catchError((Object e) {
          probador = null;
          throw e;
        }),
    probadorFotografico: motorFotografico,
    colaFotografica: colaFotografica,
    probadorRA: probadorRA,
    gestion: administracion,
    existencias: administracion,
    ingesta: administracion,
    // La foto se reduce en el teléfono; solo el modo fotográfico la envía al servidor al generar.
    recursosPrendas: recursos,
    crearCompositor: CompositorCamisetaLocal.new,
    elegirFoto: (camara) async {
      final foto = await selector.pickImage(
        source: camara ? ImageSource.camera : ImageSource.gallery,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 92,
      );
      return foto?.readAsBytes();
    },
  );
  runApp(AppClb(estado));
  await estado.iniciar();
}
