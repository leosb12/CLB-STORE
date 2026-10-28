import { FOTOS_PRENDAS } from "./fotos-prendas";

/** Solo los SKU publicados en la colección tienen foto; el resto conserva su referencia ilustrada. */
export function fotografiaPrenda(sku: string | undefined): string | undefined {
  return sku && Object.hasOwn(FOTOS_PRENDAS, sku) ? FOTOS_PRENDAS[sku] : undefined;
}

export function recursoFotografia(sku: string | undefined, probador = false): string | undefined {
  const foto = fotografiaPrenda(sku);
  return foto ? `/prendas/${foto}.${probador ? "svg" : "png"}` : undefined;
}
