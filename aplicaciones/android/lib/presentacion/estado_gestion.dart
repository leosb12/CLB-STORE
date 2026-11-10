import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../dominio/actividad.dart';
import '../dominio/administracion.dart';
import '../dominio/modelos.dart';
import 'estado_tienda.dart';

/// Texto para la persona a partir de un error de dominio.
String explicar(Object error) => switch (error) {
  SesionVencida() =>
    'Tu sesión venció. Vuelve a iniciar sesión en Cuenta para actualizar la gestión.',
  SinConexion() => 'Sin conexión con la tienda: se muestra lo último guardado.',
  ErrorRemoto(estado: 401) =>
    'La sesión venció: vuelve a iniciar sesión en Cuenta.',
  ErrorRemoto(estado: 403) => 'Tu cuenta no tiene permiso de administración.',
  ErrorRemoto(estado: 429) =>
    'El asistente está ocupado con otra tarea. Inténtalo en unos segundos.',
  ErrorRemoto(estado: 502 || 503 || 504) =>
    'El servicio de gestión no está disponible ahora. La tienda sigue funcionando.',
  ErrorRemoto(:final mensaje) => mensaje,
  _ => 'No se pudo completar la acción.',
};

/// Gestión empresarial en el móvil. Lee por la red con el token admin y guarda una copia con su fecha («Datos al»)
/// para verla sin conexión. Las escrituras que no pueden esperar (confirmar reposición) exigen conexión; «atender una
/// alerta» y los cambios de stock van a la cola.
class EstadoGestion extends ChangeNotifier {
  EstadoGestion(this.tienda);
  final EstadoTienda tienda;

  Map<String, dynamic>? resumen;
  List<Map<String, dynamic>> alertas = const [];
  List<Map<String, dynamic>> propuestas = const [];
  Map<String, dynamic>? mision;
  Map<String, dynamic>? reporte;

  /// El reporte en pantalla salió de la copia guardada (sin conexión), no de una generación en esta sesión.
  bool reporteDeCopia = false;
  DateTime? datosAl;
  String? aviso;
  bool cargando = false;
  bool conectada = false;
  bool _cerrado = false;

  /// Alertas atendidas en este teléfono que esperan en la cola: se muestran como atendidas.
  Set<String> get alertasEnCola => {
    for (final o in tienda.operacionesAdministracion)
      if (o.tipo == atenderAlerta &&
          o.reemplazadaPor == null &&
          o.estado != EstadoOperacion.requiereRevision)
        o.datos?['evento'] as String,
  };

  Future<void> _guardar() => tienda.guardarPreferencia(
    'gestion',
    jsonEncode({
      'resumen': resumen,
      'alertas': alertas,
      'propuestas': propuestas,
      'mision': mision,
      'reporte': reporte,
      'datos_al': datosAl?.toUtc().toIso8601String(),
    }),
  );

  Future<void> _leerCopia() async {
    final texto = await tienda.preferencia('gestion');
    if (texto == null) return;
    final j = jsonDecode(texto) as Map<String, dynamic>;
    List<Map<String, dynamic>> lista(Object? v) => [
      for (final e in (v as List? ?? const []))
        (e as Map).cast<String, dynamic>(),
    ];
    resumen = (j['resumen'] as Map?)?.cast<String, dynamic>();
    alertas = lista(j['alertas']);
    propuestas = lista(j['propuestas']);
    mision = (j['mision'] as Map?)?.cast<String, dynamic>();
    reporte = (j['reporte'] as Map?)?.cast<String, dynamic>();
    reporteDeCopia = reporte != null;
    datosAl = DateTime.tryParse(j['datos_al'] as String? ?? '');
  }

  String? _cuenta;

  Future<void> cargar() async {
    if (cargando) return;
    // Otra cuenta (o sin sesión): nada de lo leído por la anterior queda en memoria.
    if (_cuenta != tienda.titular?.sub) {
      _cuenta = tienda.titular?.sub;
      resumen = mision = reporte = datosAl = aviso = null;
      alertas = propuestas = const [];
      conectada = false;
    }
    cargando = true;
    if (resumen == null) await _leerCopia();
    _notificar();
    try {
      final fuente = tienda.gestion;
      if (fuente == null) throw SinConexion();
      final token = await tienda.exigirTokenAdmin();
      final [r, a, p] = await Future.wait<Object>([
        fuente.resumen(token),
        fuente.notificaciones(token),
        fuente.propuestas(token),
      ]);
      resumen = r as Map<String, dynamic>;
      alertas = a as List<Map<String, dynamic>>;
      propuestas = p as List<Map<String, dynamic>>;
      datosAl = DateTime.now();
      conectada = true;
      aviso = null;
      await _guardar();
    } on Object catch (e) {
      conectada = false;
      aviso = explicar(e);
    } finally {
      cargando = false;
      _notificar();
    }
  }

  /// Misión predefinida del botón «Monitorear ahora».
  static const misionRapida = 'Monitorea mi negocio';

  /// «Monitorea mi negocio» o una misión libre: el texto del vendedor llega tal cual al orquestador (GraphQL
  /// `ejecutarMision`), que elige agentes y herramientas MCP autorizadas. El resultado queda guardado para verlo sin red.
  Future<void> monitorear([String texto = misionRapida]) async {
    tienda.registrar(
      CategoriaActividad.mcp,
      texto == misionRapida ? 'Monitorear ahora' : 'Misión libre',
      'Misión enviada a los agentes.',
    );
    await _remoto((fuente, token) async {
      mision = await fuente.mision(texto, token);
      await _guardar();
    });
    final agentes = ((mision?['agentes'] as List?) ?? const []).cast<Map>();
    if (aviso != null) {
      tienda.registrar(
        CategoriaActividad.mcp,
        'Misión rechazada o fallida',
        aviso!,
        Severidad.error,
      );
    } else {
      final herramientas = {
        for (final a in agentes)
          for (final f in ((a['fuentes'] as List?) ?? const []).cast<Map>())
            '${f['herramienta']}',
      };
      tienda.registrar(
        CategoriaActividad.mcp,
        'Misión completada',
        'Agentes: ${agentes.map((a) => a['agente']).join(', ')} · '
            '${herramientas.length} herramientas MCP: ${herramientas.join(', ')}',
        Severidad.success,
      );
    }
  }

  /// Mismo backend que la web: el modelo de lenguaje corre en el servidor (Ollama), no en el teléfono.
  Future<void> generarReporte(String peticion, {List<String>? formatos}) async {
    await _remoto((fuente, token) async {
      reporte = await fuente.reporte(peticion, token, formatos: formatos);
      reporteDeCopia = false;
      await _guardar();
    });
    tienda.registrar(
      CategoriaActividad.ia,
      'Reporte generativo',
      aviso ?? 'Reporte generado por el servidor.',
      aviso == null ? Severidad.success : Severidad.error,
    );
  }

  /// Excel o PDF del reporte actual (REST binario); `null` sin reporte o sin sesión.
  Future<Uint8List?> archivo(String formato) async {
    final id = reporte?['identificador'] as String?;
    final token = await tienda.tokenAdmin();
    if (id == null || token == null) return null;
    return tienda.gestion!.archivo(id, formato, token);
  }

  Future<String> transcribir(Uint8List audio) async {
    final token = await tienda.exigirTokenAdmin();
    return tienda.gestion!.transcribir(audio, token);
  }

  /// Confirmar escribe en Inventario con los datos actuales: exige conexión y la confirmación previa en la pantalla.
  Future<void> resolver(String propuesta, bool confirmar) =>
      _remoto((fuente, token) async {
        await fuente.resolverPropuesta(propuesta, confirmar, token);
        propuestas = await fuente.propuestas(token);
        await _guardar();
      });

  /// Idempotente en IA: se encola y se envía con la misma clave cuando haya conexión.
  Future<void> atender(String evento) async {
    final titular = tienda.titular;
    if (titular == null) return;
    final ahora = DateTime.now();
    final id = nuevoUuid();
    await tienda.encolarAdministracion(
      Operacion(
        identificador: id,
        tipo: atenderAlerta,
        claveIdempotencia: id,
        titular: titular.sub,
        fechaCreacion: ahora,
        estado: EstadoOperacion.pendiente,
        intentos: 0,
        proximoIntento: ahora,
        carrito: const [],
        datos: {'evento': evento},
      ),
    );
    _notificar();
  }

  bool ocupado = false;
  Future<void> _remoto(
    Future<void> Function(dynamic fuente, String token) accion,
  ) async {
    if (ocupado) return;
    ocupado = true;
    aviso = null;
    _notificar();
    try {
      if (tienda.gestion == null) throw SinConexion();
      await accion(tienda.gestion, await tienda.exigirTokenAdmin());
    } on Object catch (e) {
      aviso = explicar(e);
    } finally {
      ocupado = false;
      _notificar();
    }
  }

  void _notificar() {
    if (!_cerrado) notifyListeners();
  }

  @override
  void dispose() {
    _cerrado = true;
    super.dispose();
  }
}
