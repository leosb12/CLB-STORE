export interface Variante {
  identificador: string;
  identificador_producto: string;
  sku: string;
  talla: string;
  color: string;
  activo: boolean;
  fecha_creación: string;
  fecha_actualización: string;
  versión_sincronización: number;
  física: number;
  reservada: number;
  disponible: number;
  mínimo: number;
  stock_bajo?: boolean;
  agotado?: boolean;
}

export interface ConfirmacionExistencias { variante: Variante }
export interface Movimiento {
  identificador: string;
  identificador_variante: string;
  tipo: "ENTRADA" | "SALIDA" | "AJUSTE";
  cantidad: number;
  motivo: string;
  sentido: "INCREMENTO" | "DISMINUCION" | null;
  fecha: string;
  identificador_operacion: string;
  versión_sincronización: number;
}

export interface LineaCarrito {
  identificador: string;
  identificadorProducto: string;
  sku: string;
  nombre: string;
  talla: string;
  color: string;
  precioCentavos: number;
  cantidad: number;
}

export function centavos(texto: string): number {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(texto)) throw new Error("Precio decimal inválido.");
  const [entero, decimal = ""] = texto.split(".");
  return Number(entero) * 100 + Number(decimal.padEnd(2, "0"));
}

export function importe(centavos: number | bigint): string {
  const entero = BigInt(centavos);
  return `${entero / 100n},${String(entero % 100n).padStart(2, "0")} Bs`;
}

export function totalCarrito(líneas: LineaCarrito[]): bigint {
  return líneas.reduce((total, línea) => total + BigInt(línea.precioCentavos) * BigInt(línea.cantidad), 0n);
}

export function validarCantidad(cantidad: number): void {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 1_000_000_000)
    throw new Error("La cantidad debe ser un entero positivo de hasta 1000000000.");
}

export function varianteValida(valor: unknown): valor is Variante {
  if (!valor || typeof valor !== "object") return false;
  const variante = valor as Variante;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(variante.identificador)
    && typeof variante.identificador_producto === "string" && typeof variante.sku === "string"
    && typeof variante.talla === "string" && typeof variante.color === "string" && typeof variante.activo === "boolean"
    && Number.isSafeInteger(variante.versión_sincronización) && variante.versión_sincronización > 0
    && [variante.física, variante.reservada, variante.disponible, variante.mínimo].every(n => Number.isSafeInteger(n) && n >= 0)
    && variante.disponible === variante.física - variante.reservada;
}
