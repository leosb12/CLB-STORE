import 'package:flutter/material.dart';

import 'comunes.dart';
import 'estado_tienda.dart';

class PantallaCuenta extends StatefulWidget {
  const PantallaCuenta(this.estado, {super.key});
  final EstadoTienda estado;

  @override
  State<PantallaCuenta> createState() => _PantallaCuentaState();
}

class _PantallaCuentaState extends State<PantallaCuenta> {
  bool _ocupado = false;

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
