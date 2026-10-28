import 'dart:typed_data';
import 'modelos.dart';

abstract interface class ProbadorFotografico {
  Future<Uint8List> generar(
    Uint8List persona,
    Uint8List prenda,
    Producto producto,
    void Function(String) progreso,
    bool Function() vigente, {
    String? titularEsperado,
  });
  Future<void> borrarGuardadas();
  Future<void> eliminarGuardada(String clave);
  Future<void> invalidarRemota(String clave, String titular);
}
