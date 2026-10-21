import { InjectionToken } from "@angular/core";
import {
  ErrorRemoto,
  type Operacion,
  type Producto,
  type ProcesadorOperacion,
  type PaginaProductos,
} from "../../catalogo/dominio/modelos";

export const ADMINISTRACION_REST = new InjectionToken<AdministracionRest>(
  "CLB administración REST",
);

// Futuro adaptador OIDC: entregará cabeceras verificables por el backend y rol ADMIN.
export interface CredencialesAdministrativas {
  cabeceras(): Promise<Record<string, string>>;
}

export class AdministracionRest {
  constructor(
    private readonly url: string,
    private readonly credenciales: CredencialesAdministrativas = {
      cabeceras: async () => ({}),
    },
    private readonly solicitar: typeof fetch = (entrada, opciones) =>
      fetch(entrada, opciones),
  ) {}

  private async petición<T>(
    ruta: string,
    opciones: RequestInit = {},
  ): Promise<T> {
    const respuesta = await this.solicitar(this.url + ruta, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      ...opciones,
      headers: {
        Accept: "application/json",
        ...(await this.credenciales.cabeceras()),
        ...opciones.headers,
      },
    });
    const datos = (await respuesta.json().catch(() => ({
      mensaje: "Inventario no devolvió una respuesta JSON válida.",
    }))) as Record<string, unknown>;
    if (!respuesta.ok)
      throw new ErrorRemoto(
        respuesta.status,
        typeof datos["mensaje"] === "string"
          ? datos["mensaje"]
          : "No se pudo procesar la operación administrativa.",
        datos,
      );
    return datos as T;
  }

  async descargar(): Promise<Producto[]> {
    const productos: Producto[] = [];
    let total: number | undefined;
    for (let página = 1; página <= 10000; página++) {
      const resultado = await this.petición<PaginaProductos>(
        "/productos/administracion?" +
          new URLSearchParams({ página: String(página), límite: "100" }),
      );
      if (
        !Array.isArray(resultado.productos) ||
        !Number.isSafeInteger(resultado.paginación?.total) ||
        resultado.paginación.total < 0 ||
        resultado.paginación.página !== página ||
        (total !== undefined && resultado.paginación.total !== total)
      )
        throw new Error(
          "La descarga administrativa está incompleta o cambió durante la lectura.",
        );
      total = resultado.paginación.total;
      productos.push(...resultado.productos);
      if (
        productos.length === total &&
        new Set(productos.map((producto) => producto.identificador)).size ===
          total
      )
        return productos;
      if (!resultado.productos.length || productos.length >= total)
        throw new Error("La descarga administrativa está incompleta.");
    }
    throw new Error("La administración excede el límite de descarga local.");
  }

  async consultar(identificador: string): Promise<Producto> {
    return (
      await this.petición<{ producto: Producto }>(
        "/productos/administracion/" + encodeURIComponent(identificador),
      )
    ).producto;
  }

  procesadores(): ProcesadorOperacion[] {
    return ["REGISTRAR_PRODUCTO", "MODIFICAR_PRODUCTO"].map((tipo) => ({
      tipo,
      endpoint: this.url + "/productos",
      procesar: async (operación, señal) => this.enviar(operación, señal),
    }));
  }

  async enviar(
    operación: Readonly<Operacion>,
    señal: AbortSignal,
  ): Promise<Producto> {
    const modificación = operación.tipo === "MODIFICAR_PRODUCTO";
    const { identificadorProducto, ...datos } = operación.datos;
    const ruta = modificación
      ? "/productos/" + encodeURIComponent(String(identificadorProducto))
      : "/productos";
    const respuesta = await this.petición<{ producto: Producto }>(ruta, {
      method: modificación ? "PUT" : "POST",
      signal: señal,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": operación.claveIdempotencia,
      },
      body: JSON.stringify({
        ...datos,
        ...(modificación
          ? { versión_esperada: operación.versiónEsperada }
          : {}),
      }),
    });
    const producto = respuesta.producto;
    if (
      !producto ||
      !/^[a-f0-9]{32}$/.test(producto.identificador) ||
      typeof producto.activo !== "boolean" ||
      typeof producto.precio !== "string" ||
      !Number.isSafeInteger(producto.versión_sincronización) ||
      producto.versión_sincronización < 1
    )
      throw new Error(
        "No se recibió una confirmación válida del producto. Se conservará la operación para reintentar.",
      );
    return producto;
  }
}
