/**
 * Conjunto que se prueba a la vez: una prenda de arriba y una de abajo. Un vestido ocupa las dos zonas.
 * Puro: la vista y los motores (RA, vista rápida, fotografía con IA) reciben la lista ya ordenada.
 */
import type { PrendaProbador } from "./contrato";
import { tipoDePrenda } from "./pose";

export interface Conjunto {
  superior?: PrendaProbador;
  inferior?: PrendaProbador;
}
export type Zona = keyof Conjunto;

export const zonaDe = (p: PrendaProbador): Zona => (tipoDePrenda(p.categoría) === "pantalon" ? "inferior" : "superior");
export const esVestido = (p: PrendaProbador | undefined): boolean => !!p && tipoDePrenda(p.categoría) === "vestido";

export function conjuntoInicial(p: PrendaProbador | null): Conjunto {
  return p ? { [zonaDe(p)]: p } : {};
}

/** Pone la prenda en su zona; un vestido desplaza a la de abajo y una de abajo desplaza al vestido. */
export function elegir(c: Conjunto, p: PrendaProbador): Conjunto {
  if (esVestido(p)) return { superior: p };
  if (zonaDe(p) === "inferior") return { superior: esVestido(c.superior) ? undefined : c.superior, inferior: p };
  return { superior: p, inferior: c.inferior };
}

export function quitar(c: Conjunto, zona: Zona): Conjunto {
  return { ...c, [zona]: undefined };
}

/** Orden de dibujo y de generación: primero la de abajo, después la de arriba (tapa la cintura). */
export function prendasDe(c: Conjunto): PrendaProbador[] {
  return [c.inferior, c.superior].filter((p): p is PrendaProbador => !!p);
}

/** Prendas para elegir: la inicial y el catálogo, sin repetidos. */
export function opciones(inicial: PrendaProbador | null, catalogo: PrendaProbador[]): PrendaProbador[] {
  const vistas = new Set<string>();
  return [...(inicial ? [inicial] : []), ...catalogo].filter((p) => !vistas.has(p.identificador) && !!vistas.add(p.identificador));
}
