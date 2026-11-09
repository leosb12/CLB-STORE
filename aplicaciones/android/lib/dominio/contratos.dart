/// Lo que el dominio necesita del exterior. Las implementaciones viven en `datos/` (SQLite, REST, OIDC, TFLite);
/// las pruebas usan dobles en memoria.
library;

import 'administracion.dart';
import 'avisos.dart';
import 'dart:typed_data';

import 'modelos.dart';
import 'pose.dart';
import 'recurso_probador.dart';

abstract interface class FuenteCatalogo {
  /// Catálogo completo (todas las páginas) o error: nunca una descarga a medias.
  Future<List<Producto>> productos();
  Future<List<Variante>> variantes(String identificadorProducto);

  /// Modelo de tallas de la fase 8 (JSON público, sin datos personales).
  Future<Map<String, dynamic>> modeloTallas();
}

abstract interface class FuenteVentas {
  Future<List<PedidoVenta>> historial(String token);

  /// `POST /api/v1/pedidos` con la Idempotency-Key de la operación.
  Future<PedidoVenta> confirmar(Operacion operacion, String token);
  Future<PedidoVenta> consultar(String identificador, String token);
}

/// Persistencia del dispositivo. Cada método es atómico.
abstract interface class AlmacenLocal {
  Future<void> guardarHistorial(String titular, HistorialPedidos historial);
  Future<HistorialPedidos?> historial(String titular);

  /// Reemplaza productos y variantes en una sola transacción.
  Future<void> reemplazarCatalogo(
    List<Producto> productos,
    List<Variante> variantes,
    DateTime fecha,
  );
  Future<List<Producto>> productos();
  Future<List<Variante>> variantes(String identificadorProducto);
  Future<DateTime?> fechaCatalogo();

  Future<void> guardarModeloTallas(Map<String, dynamic> modelo);
  Future<Map<String, dynamic>?> modeloTallas();

  /// Preferencias del dispositivo (no personales), p. ej. el modo del probador y el rendimiento medido de la RA.
  Future<String?> preferencia(String clave);
  Future<void> guardarPreferencia(String clave, String valor);

  /// Borra las preferencias cuya clave empieza por alguno de los prefijos (p. ej. la caché administrativa al salir).
  Future<void> borrarPreferencias(List<String> prefijos);

  Future<List<LineaCarrito>> carrito();
  Future<void> guardarLinea(LineaCarrito linea);
  Future<void> quitarLinea(String identificadorVariante);

  /// Inserta la operación y vacía el carrito en la misma transacción.
  Future<void> encolarPedido(Operacion operacion);
  Future<void> encolarOperacion(Operacion operacion);
  Future<void> reemplazarOperacion(Operacion antigua, Operacion nueva);
  Future<List<Operacion>> operaciones();
  Future<void> guardarOperacion(Operacion operacion);

  /// Al arrancar: una operación que quedó ENVIANDO tiene resultado incierto y vuelve a PENDIENTE con la misma clave.
  Future<void> recuperarEnviando();
}

/// Gestión con agentes (IA, rol admin). Los datos se muestran tal cual: la cifra la calcula el servidor.
abstract interface class FuenteGestion {
  Future<Map<String, dynamic>> resumen(String token);
  Future<Map<String, dynamic>> mision(String texto, String token);
  Future<List<Map<String, dynamic>>> notificaciones(String token);
  Future<List<Map<String, dynamic>>> propuestas(String token);
  Future<Map<String, dynamic>> resolverPropuesta(
    String identificador,
    bool confirmar,
    String token,
  );
  /// `formatos`: elección explícita en la pantalla (PANTALLA, PDF, EXCEL); `null` = lo que diga la petición.
  Future<Map<String, dynamic>> reporte(
    String peticion,
    String token, {
    List<String>? formatos,
  });

  /// Descarga binaria del reporte guardado (`excel` o `pdf`): mismos datos que la pantalla.
  Future<Uint8List> archivo(String identificador, String formato, String token);
  Future<String> transcribir(Uint8List audio, String token);
}

/// Lectura administrativa de productos y saldos (Inventario).
abstract interface class FuenteExistencias {
  Future<List<Map<String, dynamic>>> productosAdmin(String token);
  Future<List<VarianteAdmin>> variantesAdmin(String producto, String token);
}

/// Ingesta de la foto de una prenda: carga, estado del trabajo (con informe de calidad), vista previa y publicación.
abstract interface class FuenteIngesta {
  Future<Map<String, dynamic>> cargar(
    String producto,
    String clave,
    int version,
    String color,
    Uint8List foto,
    String token,
  );
  Future<Map<String, dynamic>> trabajo(
    String producto,
    String trabajo,
    String token,
  );
  Future<Uint8List> previsualizacion(
    String producto,
    String trabajo,
    String token,
  );
  Future<Map<String, dynamic>> publicar(
    String producto,
    String trabajo,
    String clave,
    int version,
    bool aceptarAvisos,
    String token,
  );
}

/// Envía una operación administrativa de la cola con su Idempotency-Key fija y devuelve el comprobante ya validado.
/// Canal push del dispositivo (FCM). Puede no estar disponible (sin Firebase o sin Play Services): nunca bloquea la app.
abstract interface class AvisosDispositivo {
  Future<bool> get listo;
  Future<String?> token();
  Stream<String> get renovaciones;
  Stream<AvisoPedido> get recibidos;
  Stream<AvisoPedido> get tocados;
  Future<PermisoAvisos> permiso();

  /// Se pide en contexto (al activar Push), no al abrir la app.
  Future<PermisoAvisos> solicitarPermiso();

  /// Invalida el token del teléfono (otra cuenta recibirá uno nuevo).
  Future<void> olvidarToken();
}

/// Preferencias y vínculo del dispositivo en Clientes.
abstract interface class FuenteAvisos {
  Future<PreferenciasAvisos> preferencias(String token);

  /// Asocia esta instalación (y su token push) con la cuenta del JWT; el secreto prueba que es el mismo teléfono.
  Future<void> vincular(String instalacion, String tokenPush, String secreto, String token);

  /// Sin sesión: basta el secreto de la instalación (cierre de sesión sin red, convergido al reconectar).
  Future<void> desvincular(String instalacion, String secreto);
}

/// Identidad estable de esta instalación (UUID y secreto de 256 bits), guardada en el Keystore.
abstract interface class IdentidadInstalacion {
  Future<({String id, String secreto})> obtener();
}

abstract interface class ProcesadorOperacion {
  Future<Map<String, dynamic>> enviar(Operacion operacion, String token);
}

/// Aloja el microfrontend de realidad aumentada (`<clb-probador>`) dentro de la app: devuelve la URL de su página.
abstract interface class AnfitrionProbadorRA {
  Future<Uri> iniciar();
  Future<void> detener();
}

class Titular {
  const Titular({
    required this.sub,
    required this.usuario,
    required this.nombre,
    required this.roles,
  });
  final String sub;
  final String usuario;
  final String nombre;
  final Set<String> roles;
}

abstract interface class Sesion {
  /// Último titular validado: se conoce sin red (sesión offline limitada, como la web).
  Future<Titular?> titular();

  /// Token de acceso vigente, renovado si hace falta y hay red; null si no se puede.
  Future<String?> tokenVigente();
  Future<Titular> iniciar();
  Future<void> cerrar();
}

abstract interface class DetectorPose {
  /// Nombre y versión del modelo, para mostrar qué se usó.
  String get modelo;

  /// Pose en píxeles de la imagen ya orientada; la imagen nunca sale del dispositivo.
  Future<(Pose, Uint8List)> detectar(Uint8List imagen);
}

/// Composición semántica por foto. Solo recursos locales; nunca recibe un destino de red.
abstract interface class CompositorCamiseta {
  Future<Uint8List> componer(
    Uint8List foto,
    Uint8List textura,
    Map<String, dynamic> anclas,
    Pose pose,
  );
}

/// Preparar el paquete antes de activar catálogo; leer nunca requiere red.
abstract interface class FuenteRecursosPrendas {
  Future<void> preparar(List<Producto> productos);
  Future<Uint8List?> leer(RecursoProbador recurso);
}
