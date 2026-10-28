import type { Variante } from "../../existencias/dominio/modelos";

/** Variante que se preselecciona al volver del probador con una talla: la primera activa con stock, si no la primera. */
export function varianteDeTalla(variantes: Variante[], talla: string | null): Variante | undefined {
  if (!talla) return undefined;
  const deLaTalla = variantes.filter((v) => v.activo !== false && v.talla.toLocaleUpperCase("es") === talla.toLocaleUpperCase("es"));
  return deLaTalla.find((v) => v.disponible > 0) ?? deLaTalla[0];
}
