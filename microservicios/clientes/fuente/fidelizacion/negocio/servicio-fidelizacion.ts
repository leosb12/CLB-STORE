import { createHash } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { Inject, Injectable } from "@nestjs/common";
import { REPOSITORIO_FIDELIZACION, type Movimiento, type RegistroClave, type RepositorioFidelizacion } from "../datos/repositorio-fidelizacion.js";

/** Error de negocio con su código y estado HTTP; el detalle opcional se agrega a la respuesta (p. ej., el estado vigente). */
export class ErrorDeFidelizacion extends Error {
  constructor(mensaje: string, readonly código: string, readonly estado: number, readonly detalle?: Record<string, unknown>) { super(mensaje); }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTENTOS = 5;

/** Regla de fidelización: 1 punto por cada 10 Bs completos del total del pedido. */
export function puntosPorTotal(totalCentavos: number): number {
  return Math.floor(totalCentavos / 1000);
}

@Injectable()
export class ServicioFidelizacion {
  constructor(@Inject(REPOSITORIO_FIDELIZACION) private readonly repositorio: RepositorioFidelizacion) {}

  async acreditar(clave: string, pedido: string, cliente: string, totalCentavos: number): Promise<Movimiento> {
    const huella = this.huella("ACREDITACION", pedido, cliente, totalCentavos);
    return this.conReintentos(async () => {
      const [repetida, { acreditación, reversa }] = await Promise.all([this.repetida(clave, huella), this.repositorio.movimientosDelPedido(pedido)]);
      if (repetida) return repetida;
      if (reversa) throw new ErrorDeFidelizacion("El pedido ya fue revertido; no se acreditan puntos.", "PEDIDO_REVERTIDO", 409);
      if (acreditación) {
        // Idempotencia por pedido: el mismo pedido con otra clave devuelve el resultado original y registra la clave.
        if (acreditación.identificador_cliente !== cliente || acreditación.total_centavos !== totalCentavos) {
          throw new ErrorDeFidelizacion("El pedido ya se acreditó con otros datos.", "CONFLICTO_ACREDITACION", 409);
        }
        return (await this.repositorio.registrarClave({ clave, huella, resultado: acreditación })) ? acreditación : null;
      }
      const movimiento: Movimiento = { tipo: "ACREDITACION", identificador_pedido: pedido, identificador_cliente: cliente,
        puntos: puntosPorTotal(totalCentavos), total_centavos: totalCentavos, fecha: new Date().toISOString() };
      return (await this.repositorio.acreditar(movimiento, { clave, huella, resultado: movimiento })) ? movimiento : null;
    });
  }

  /** Compensación de la SAGA: revierte la acreditación o, si aún no llegó, la bloquea para siempre. */
  async revertir(clave: string, pedido: string, cliente: string): Promise<Movimiento> {
    const huella = this.huella("REVERSA", pedido, cliente, null);
    return this.conReintentos(async () => {
      const [repetida, { acreditación, reversa }] = await Promise.all([this.repetida(clave, huella), this.repositorio.movimientosDelPedido(pedido)]);
      if (repetida) return repetida;
      const dueño = acreditación?.identificador_cliente ?? reversa?.identificador_cliente;
      if (dueño && dueño !== cliente) throw new ErrorDeFidelizacion("El pedido pertenece a otro cliente.", "CONFLICTO_CLIENTE", 409);
      if (reversa) return (await this.repositorio.registrarClave({ clave, huella, resultado: reversa })) ? reversa : null;
      const nueva: Movimiento = { tipo: "REVERSA", identificador_pedido: pedido, identificador_cliente: cliente,
        puntos: acreditación?.puntos ?? 0, total_centavos: acreditación?.total_centavos ?? null, fecha: new Date().toISOString() };
      const registro: RegistroClave = { clave, huella, resultado: nueva };
      const aplicada = acreditación
        ? await this.repositorio.revertirAcreditado(nueva, registro)
        : await this.repositorio.marcarReversaSinAcreditacion(nueva, registro);
      return aplicada ? nueva : null;
    });
  }

  consultar(cliente: string): Promise<{ saldo: number; movimientos: Movimiento[] }> {
    return this.repositorio.saldoYMovimientos(cliente);
  }

  /**
   * Movimientos de un pedido del cliente leídos por su clave con lectura consistente (M05): el comprobante no depende del
   * índice por cliente, que es eventual. Un pedido de otro cliente se devuelve vacío.
   */
  async movimientosDelPedido(cliente: string, pedido: string): Promise<{ acreditación: Movimiento | null; reversa: Movimiento | null }> {
    const { acreditación, reversa } = await this.repositorio.movimientosDelPedido(pedido);
    const propio = (m: Movimiento | null) => (m?.identificador_cliente === cliente ? m : null);
    return { acreditación: propio(acreditación), reversa: propio(reversa) };
  }

  disponible(): Promise<boolean> {
    return this.repositorio.disponible();
  }

  validarClave(clave: unknown): string {
    if (typeof clave !== "string" || !UUID_V4.test(clave)) {
      throw new ErrorDeFidelizacion("Idempotency-Key debe ser un UUID v4 válido.", "DATOS_INVALIDOS", 422);
    }
    return clave.toLowerCase();
  }

  /** Una condición incumplida o un conflicto entre transacciones devuelve null: se espera, se relee y se decide de nuevo. */
  private async conReintentos(intento: () => Promise<Movimiento | null>): Promise<Movimiento> {
    for (let número = 0; número < INTENTOS; número++) {
      const resultado = await intento();
      if (resultado) return resultado;
      await esperar(20 * 2 ** número + Math.random() * 20);
    }
    throw new ErrorDeFidelizacion("Fidelización está ocupada. Reintenta con la misma clave.", "OCUPADO", 503);
  }

  private async repetida(clave: string, huella: string): Promise<Movimiento | null> {
    const registro = await this.repositorio.clave(clave);
    if (!registro) return null;
    if (registro.huella !== huella) throw new ErrorDeFidelizacion("Esta Idempotency-Key ya se utilizó con otra solicitud. No se aplicó ningún cambio.", "CONFLICTO_IDEMPOTENCIA", 409);
    return registro.resultado;
  }

  private huella(operación: string, pedido: string, cliente: string, total: number | null): string {
    return createHash("sha256").update(JSON.stringify([operación, pedido, cliente, total])).digest("hex");
  }
}
