import type { LineaCarrito } from "../../existencias/dominio/modelos";
import type { Operacion } from "../../catalogo/dominio/modelos";

/** Modelo de lectura combinado. Un pedido remoto jamás se fabrica como operación de envío. */
export function fusionarHistorial(locales: readonly Operacion[], remotos: readonly PedidoVenta[]):
    { operacion?: Operacion; pedido?: PedidoVenta }[] {
  const porId = new Map(remotos.map(p => [p.identificador, p]));
  for (const op of locales) {
    const previo = porId.get(op.identificador), reciente = op.resultadoPedido;
    if (previo && reciente && Date.parse(reciente.fecha_actualización) > Date.parse(previo.fecha_actualización))
      porId.set(op.identificador, reciente);
  }
  return [...locales.filter(op => !porId.has(op.identificador)).map(operacion => ({ operacion })),
    ...[...porId.values()].map(pedido => ({ pedido }))];
}

export const CONFIRMAR_PEDIDO = "CONFIRMAR_PEDIDO";

export type EstadoPedido = "PENDIENTE" | "CONFIRMADO" | "CANCELADO" | "EN_REVISION";

export interface LineaPedidoVenta {
  identificador_variante: string;
  sku: string;
  nombre: string;
  talla: string;
  color: string;
  precio: string;
  cantidad: number;
  subtotal: string;
}

export interface PasoSaga {
  paso: string;
  resultado: string;
  detalle: string | null;
  fecha: string;
}

/** Pedido confirmado por Ventas: el precio y el estado los decide el servidor, nunca el carrito. */
export interface PedidoVenta {
  identificador: string;
  identificador_cliente: string;
  estado: EstadoPedido;
  motivo: string | null;
  total: string;
  moneda: string;
  líneas: LineaPedidoVenta[];
  fecha_creación: string;
  fecha_actualización: string;
  saga?: { paso: string; historial: PasoSaga[] };
  /** Lo genera la automatización n8n al confirmarse el pedido (fase 10). */
  comprobante_disponible?: boolean;
}

export interface ConfirmacionPedido {
  pedido: PedidoVenta;
}

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function pedidoValido(valor: unknown): valor is PedidoVenta {
  if (!valor || typeof valor !== "object") return false;
  const pedido = valor as PedidoVenta;
  return UUID_V4.test(pedido.identificador) && ["PENDIENTE", "CONFIRMADO", "CANCELADO", "EN_REVISION"].includes(pedido.estado)
    && typeof pedido.total === "string" && Array.isArray(pedido.líneas) && pedido.líneas.length > 0;
}

/** Datos de la operación CONFIRMAR_PEDIDO: el dispositivo asigna el UUID del pedido para que los reintentos no dupliquen. */
export function solicitudPedido(identificador: string, líneas: readonly LineaCarrito[]): Record<string, unknown> {
  if (!líneas.length) throw new Error("El carrito está vacío.");
  if (líneas.length > 50) throw new Error("Un pedido admite hasta 50 variantes.");
  return {
    identificador,
    líneas: líneas.map(línea => ({ identificador_variante: línea.identificador, cantidad: línea.cantidad })),
    // Copia local del carrito: se muestra mientras el pedido está pendiente y permite devolverlo al carrito si
    // Ventas lo rechaza. No se envía al servidor.
    carrito: líneas.map(línea => ({ ...línea })),
  };
}
