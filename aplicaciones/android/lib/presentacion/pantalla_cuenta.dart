import 'package:flutter/material.dart';

import '../dominio/avisos.dart';
import 'comunes.dart';
import 'estado_tienda.dart';

class PantallaCuenta extends StatefulWidget {
  const PantallaCuenta(this.estado, {super.key});
  final EstadoTienda estado;

  @override
  State<PantallaCuenta> createState() => _PantallaCuentaState();
}

/// Avisos de pedidos: la preferencia (guardada en Clientes, también sin red) y el permiso del sistema se muestran por
/// separado; uno no implica el otro.
class _Avisos extends StatelessWidget {
  const _Avisos(this.estado);
  final EstadoTienda estado;

  String? _permiso(PermisoAvisos permiso) => switch (permiso) {
    PermisoAvisos.concedido => null,
    PermisoAvisos.denegado =>
      'Android no tiene permitido mostrar avisos de CLB Store. Si al tocar «Permitir notificaciones» no aparece la '
          'pregunta, actívalas en Ajustes › Aplicaciones › CLB Store › Notificaciones.',
    PermisoAvisos.sinDecidir =>
      'Falta el permiso de Android para mostrar los avisos en este teléfono.',
    PermisoAvisos.noDisponible =>
      'Push no está disponible en esta instalación; los avisos llegan por correo.',
  };

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final p = estado.preferenciasAvisos;
    final apagado = t.textTheme.bodySmall?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    final permiso = p.push ? _permiso(estado.permisoAvisos) : null;
    final revision = estado.preferenciasEnRevision;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Avisos de pedidos', style: t.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Te avisamos cuando un pedido se confirma o se cancela.',
          style: apagado,
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Notificaciones en este teléfono'),
          value: p.push,
          onChanged: (v) =>
              estado.cambiarPreferenciasAvisos(push: v, correo: p.correo),
        ),
        if (permiso != null) Text(permiso, style: apagado),
        if (p.push &&
            (estado.permisoAvisos == PermisoAvisos.sinDecidir ||
                estado.permisoAvisos == PermisoAvisos.denegado))
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: estado.solicitarPermisoAvisos,
              child: const Text('Permitir notificaciones'),
            ),
          ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Correo electrónico'),
          subtitle: p.correoDisponible
              ? null
              : const Text('Tu cuenta aún no tiene un correo registrado.'),
          value: p.correo,
          onChanged: (v) =>
              estado.cambiarPreferenciasAvisos(push: p.push, correo: v),
        ),
        if (estado.preferenciasPendientes)
          Text(
            'Cambios guardados en el teléfono; se sincronizan al recuperar la conexión.',
            style: apagado,
          ),
        if (revision != null) ...[
          const SizedBox(height: 8),
          Text(
            'Tus preferencias cambiaron en otro dispositivo antes de sincronizar estas.',
            style: t.textTheme.bodyMedium,
          ),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: () => estado.resolverPreferencias(usarMias: true),
                child: const Text('Usar mis cambios'),
              ),
              TextButton(
                onPressed: () => estado.resolverPreferencias(usarMias: false),
                child: const Text('Usar las del servidor'),
              ),
            ],
          ),
        ],
        const SizedBox(height: 4),
        Text(
          'Sin Internet no llegan avisos; FCM no garantiza la entrega. Tus pedidos siempre están en «Pedidos».',
          style: apagado,
        ),
      ],
    );
  }
}

class _PantallaCuentaState extends State<PantallaCuenta> {
  bool _ocupado = false;

  @override
  void initState() {
    super.initState();
    if (widget.estado.titular != null) widget.estado.cargarPreferenciasAvisos();
  }

  Future<void> _ejecutar(Future<void> Function() accion, String error) async {
    setState(() => _ocupado = true);
    try {
      await accion();
    } on Object {
      if (mounted) avisar(context, error);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final estado = widget.estado;
    final titular = estado.titular;
    final apagado = t.textTheme.bodyMedium?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Cuenta')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
        children: [
          if (titular == null) ...[
            Text(
              'Una sola cuenta para toda la tienda',
              style: t.textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            Text(
              'Entra con el mismo usuario y contraseña de la tienda web. Sin sesión puedes ver el catálogo, armar el '
              'carrito y probarte prendas; para confirmar un pedido hace falta iniciar sesión una vez con conexión.',
              style: t.textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _ocupado || !estado.enLinea
                  ? null
                  : () => _ejecutar(
                      estado.iniciarSesion,
                      'No se pudo iniciar sesión. Revisa la conexión e inténtalo otra vez.',
                    ),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
              child: Text(_ocupado ? 'Abriendo…' : 'Iniciar sesión'),
            ),
            if (!estado.enLinea) ...[
              const SizedBox(height: 8),
              Text('Necesitas conexión para iniciar sesión.', style: apagado),
            ],
          ] else ...[
            Text(titular.nombre, style: t.textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text(titular.usuario, style: apagado),
            const SizedBox(height: 20),
            Text(
              'Es la misma cuenta de la tienda web y del panel de gestión: Keycloak la valida una vez y cada servicio '
              'comprueba el token. Sin conexión la sesión sigue disponible en este teléfono y tus pedidos esperan en la cola.',
              style: t.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Text(
              'Roles: ${titular.roles.where((r) => const {'cliente', 'admin'}.contains(r)).join(', ')}',
              style: apagado,
            ),
            const SizedBox(height: 28),
            _Avisos(estado),
            const SizedBox(height: 28),
            OutlinedButton(
              onPressed: _ocupado
                  ? null
                  : () => _ejecutar(
                      estado.cerrarSesion,
                      'No se pudo cerrar la sesión.',
                    ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
              child: const Text('Cerrar sesión'),
            ),
            if (estado.pendientes > 0) ...[
              const SizedBox(height: 8),
              Text(
                'Tienes pedidos por enviar: se enviarán cuando vuelvas a iniciar sesión con esta cuenta.',
                style: apagado,
              ),
            ],
          ],
        ],
      ),
    );
  }
}
