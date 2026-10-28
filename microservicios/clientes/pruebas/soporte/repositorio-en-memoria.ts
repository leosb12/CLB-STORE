import type { Movimiento, RegistroClave, RepositorioFidelizacion } from "../../fuente/fidelizacion/datos/repositorio-fidelizacion.js";

// Doble de la capa de datos con las mismas condiciones atómicas que DynamoDB (cada escritura es síncrona por dentro).
export class RepositorioEnMemoria implements RepositorioFidelizacion {
  readonly acreditaciones = new Map<string, Movimiento>();
  readonly reversas = new Map<string, Movimiento>();
  readonly claves = new Map<string, RegistroClave>();
  readonly saldos = new Map<string, number>();
  activo = true;

  async clave(clave: string) { return this.claves.get(clave) ?? null; }
  async movimientosDelPedido(pedido: string) {
    return { acreditación: this.acreditaciones.get(pedido) ?? null, reversa: this.reversas.get(pedido) ?? null };
  }

  async acreditar(movimiento: Movimiento, clave: RegistroClave) {
    const pedido = movimiento.identificador_pedido;
    if (this.acreditaciones.has(pedido) || this.reversas.has(pedido) || this.claves.has(clave.clave)) return false;
    this.acreditaciones.set(pedido, movimiento);
    this.aplicar(clave, movimiento.identificador_cliente, movimiento.puntos);
    return true;
  }

  async revertirAcreditado(reversa: Movimiento, clave: RegistroClave) {
    const pedido = reversa.identificador_pedido;
    if (!this.acreditaciones.has(pedido) || this.reversas.has(pedido) || this.claves.has(clave.clave)) return false;
    this.reversas.set(pedido, reversa);
    this.aplicar(clave, reversa.identificador_cliente, -reversa.puntos);
    return true;
  }

  async marcarReversaSinAcreditacion(reversa: Movimiento, clave: RegistroClave) {
    const pedido = reversa.identificador_pedido;
    if (this.acreditaciones.has(pedido) || this.reversas.has(pedido) || this.claves.has(clave.clave)) return false;
    this.reversas.set(pedido, reversa);
    this.aplicar(clave, reversa.identificador_cliente, 0);
    return true;
  }

  async registrarClave(clave: RegistroClave) {
    if (this.claves.has(clave.clave)) return false;
    this.claves.set(clave.clave, clave);
    return true;
  }

  async saldoYMovimientos(cliente: string) {
    const movimientos = [...this.acreditaciones.values(), ...this.reversas.values()]
      .filter(m => m.identificador_cliente === cliente).sort((a, b) => a.fecha.localeCompare(b.fecha));
    return { saldo: this.saldos.get(cliente) ?? 0, movimientos };
  }

  async disponible() { return this.activo; }

  private aplicar(clave: RegistroClave, cliente: string, puntos: number) {
    this.claves.set(clave.clave, clave);
    this.saldos.set(cliente, (this.saldos.get(cliente) ?? 0) + puntos);
  }
}
