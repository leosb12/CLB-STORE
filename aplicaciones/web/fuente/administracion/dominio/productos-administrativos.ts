import type { Producto } from "../../catalogo/dominio/modelos";

export interface DatosProducto {
  sku: string;
  nombre: string;
  descripción: string;
  categoría: string;
  precio: string;
  activo: boolean;
}

export function datosDeProducto(producto?: Producto): DatosProducto {
  return producto
    ? {
        sku: producto.sku,
        nombre: producto.nombre,
        descripción: producto.descripción,
        categoría: producto.categoría,
        precio: producto.precio,
        activo: producto.activo,
      }
    : {
        sku: "",
        nombre: "",
        descripción: "",
        categoría: "",
        precio: "",
        activo: true,
      };
}

export function validarProducto(datos: DatosProducto): Record<string, string> {
  const errores: Record<string, string> = {};
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(datos.sku.trim().toUpperCase()))
    errores["sku"] =
      "El SKU admite hasta 64 letras, dígitos, guiones o guiones bajos.";
  if (!datos.nombre.trim() || [...datos.nombre.trim()].length > 160)
    errores["nombre"] = "Escribe un nombre de hasta 160 caracteres.";
  if ([...datos.descripción].length > 5000)
    errores["descripción"] = "La descripción admite hasta 5000 caracteres.";
  if (!datos.categoría.trim() || [...datos.categoría.trim()].length > 100)
    errores["categoría"] = "Escribe una categoría de hasta 100 caracteres.";
  if (
    !/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(datos.precio) ||
    /^0(?:\.0{1,2})?$/.test(datos.precio)
  )
    errores["precio"] =
      "Usa un precio positivo exacto, por ejemplo 129.90; máximo 999999999.99 BOB.";
  return errores;
}
