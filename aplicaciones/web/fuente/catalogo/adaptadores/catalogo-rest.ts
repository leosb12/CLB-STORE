import {
  ErrorRemoto,
  type FuenteCatalogo,
  type PaginaProductos,
  type Producto,
} from "../dominio/modelos";

export class CatalogoRest implements FuenteCatalogo {
  constructor(
    private readonly url: string,
    private readonly solicitar: typeof fetch = (entrada, opciones) =>
      fetch(entrada, opciones),
  ) {}

  private async leer<T>(ruta: string): Promise<T> {
    const respuesta = await this.solicitar(`${this.url}${ruta}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok)
      throw new ErrorRemoto(
        respuesta.status,
        `Inventario respondió ${respuesta.status}.`,
      );
    return respuesta.json() as Promise<T>;
  }

  async disponible(): Promise<boolean> {
    try {
      const página = await this.leer<PaginaProductos>(
        `/productos?${new URLSearchParams({ límite: "1" })}`,
      );
      return (
        Array.isArray(página.productos) &&
        Number.isInteger(página.paginación?.total)
      );
    } catch {
      return false;
    }
  }

  async descargar(): Promise<Producto[]> {
    const productos: Producto[] = [];
    let total: number | undefined;
    for (let número = 1; número <= 10000; número++) {
      const página = await this.leer<PaginaProductos>(
        `/productos?${new URLSearchParams({ página: String(número), límite: "100" })}`,
      );
      if (
        !Array.isArray(página.productos) ||
        !Number.isSafeInteger(página.paginación?.total) ||
        página.paginación.total < 0 ||
        página.paginación.página !== número ||
        página.paginación.límite !== 100 ||
        (total !== undefined && total !== página.paginación.total)
      )
        throw new Error(
          "El catálogo cambió durante la descarga. Vuelve a sincronizar.",
        );
      total = página.paginación.total;
      for (const producto of página.productos) this.validar(producto);
      productos.push(...página.productos);
      if (productos.length === total) {
        if (
          new Set(productos.map((producto) => producto.identificador)).size !==
          total
        )
          throw new Error("El catálogo contiene identificadores repetidos.");
        return productos;
      }
      if (!página.productos.length || productos.length > total)
        throw new Error("La descarga del catálogo está incompleta.");
    }
    throw new Error("El catálogo excede el límite de descarga local.");
  }

  async consultar(identificador: string): Promise<Producto> {
    const respuesta = await this.leer<{ producto: Producto }>(
      `/productos/${encodeURIComponent(identificador)}`,
    );
    this.validar(respuesta.producto);
    return respuesta.producto;
  }

  private validar(producto: Producto): void {
    if (
      !producto ||
      !/^[a-f0-9]{32}$/.test(producto.identificador) ||
      typeof producto.nombre !== "string" ||
      typeof producto.sku !== "string" ||
      typeof producto.descripción !== "string" ||
      typeof producto.categoría !== "string" ||
      producto.moneda !== "BOB" ||
      producto.activo !== true ||
      !/^(0|[1-9]\d*)\.\d{2}$/.test(producto.precio) ||
      !Number.isSafeInteger(producto.versión_sincronización) ||
      producto.versión_sincronización < 1 ||
      !Number.isFinite(Date.parse(producto.fecha_creación)) ||
      !Number.isFinite(Date.parse(producto.fecha_actualización))
    ) {
      throw new Error(
        "La respuesta de Inventario no cumple el contrato del catálogo.",
      );
    }
  }
}
