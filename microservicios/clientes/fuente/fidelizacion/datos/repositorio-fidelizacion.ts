export type TipoMovimiento = "ACREDITACION" | "REVERSA";

export interface Movimiento {
  tipo: TipoMovimiento;
  identificador_pedido: string;
  identificador_cliente: string;
  puntos: number;
  total_centavos: number | null;
  fecha: string;
}

export interface RegistroClave {
  clave: string;
  huella: string;
  resultado: Movimiento;
}

export interface MovimientosDelPedido {
  acreditación: Movimiento | null;
  reversa: Movimiento | null;
}

/**
 * Capa de datos. Los movimientos son únicos por pedido en todo el sistema (no por cliente).
 * Cada escritura es atómica: movimiento, saldo del cliente e Idempotency-Key se guardan juntos,
 * o no se aplica nada y se devuelve false para que la capa de negocio relea.
 */
export interface RepositorioFidelizacion {
  clave(clave: string): Promise<RegistroClave | null>;
  movimientosDelPedido(pedido: string): Promise<MovimientosDelPedido>;
  /** Exige que el pedido no tenga acreditación ni reversa. */
  acreditar(movimiento: Movimiento, clave: RegistroClave): Promise<boolean>;
  /** Exige que exista la acreditación y que no exista reversa; descuenta sus puntos. */
  revertirAcreditado(reversa: Movimiento, clave: RegistroClave): Promise<boolean>;
  /** Exige que no exista acreditación ni reversa; deja la marca que bloquea una acreditación tardía. */
  marcarReversaSinAcreditacion(reversa: Movimiento, clave: RegistroClave): Promise<boolean>;
  /** Registra una clave nueva que reutiliza un resultado ya existente; false si la clave ya existía. */
  registrarClave(clave: RegistroClave): Promise<boolean>;
  saldoYMovimientos(cliente: string): Promise<{ saldo: number; movimientos: Movimiento[] }>;
  disponible(): Promise<boolean>;
}

export const REPOSITORIO_FIDELIZACION = Symbol("RepositorioFidelizacion");
