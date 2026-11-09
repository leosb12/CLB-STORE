import type { TrabajoFotografico } from "../dominio/trabajo-fotografico";
import { InjectionToken } from "@angular/core";
import { varianteValida, type Variante, type Movimiento, type ConfirmacionExistencias } from "../../existencias/dominio/modelos";
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

  /**
   * Consulta o acción de gestión por GraphQL (R5). Inventario sigue siendo el propietario: la respuesta es su mismo
   * cuerpo y un rechazo trae `estado_http` y su cuerpo, así la cola decide igual que con REST.
   */
  private async gestion<T>(consulta: string, variables: Record<string, unknown> = {}, señal?: AbortSignal): Promise<T> {
    const respuesta = await this.petición<{ data?: Record<string, T> | null; errors?: { message: string; extensions?: Record<string, unknown> }[] }>(
      "/graphql", { method: "POST", ...(señal ? { signal: señal } : {}), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: consulta, variables }) });
    const error = respuesta.errors?.[0];
    if (error) {
      const extensiones = error.extensions ?? {};
      const estado = typeof extensiones["estado_http"] === "number" ? extensiones["estado_http"] : 500;
      const cuerpo = extensiones["cuerpo"] as Record<string, unknown> | undefined;
      throw new ErrorRemoto(estado, error.message, cuerpo ?? { código: extensiones["codigo"] });
    }
    const valores = respuesta.data ? Object.values(respuesta.data) : [];
    if (valores.length !== 1 || valores[0] === null || valores[0] === undefined) throw new Error("La gestión no devolvió datos.");
    return valores[0];
  }

  async capacidadFotografica(): Promise<boolean> {
    return (await this.gestion<{habilitado: boolean}>("{ capacidadesIngesta }")).habilitado === true;
  }
  async cargarFotografia(id: string, clave: string, version: number, color: string, archivo: File): Promise<TrabajoFotografico> {
    const datos = new FormData(); datos.set("imagen",archivo); datos.set("color",color); datos.set("versión_esperada",String(version));
    return (await this.petición<{trabajo: TrabajoFotografico}>(`/productos/${id}/recursos-probador`, {method: "POST", headers: {"Idempotency-Key": clave},body: datos})).trabajo;
  }
  async consultarFotografia(id: string, trabajo: string): Promise<TrabajoFotografico> {
    return (await this.gestion<{trabajo: TrabajoFotografico}>("query($p: String!, $t: String!) { trabajoIngesta(producto: $p, trabajo: $t) }",
      { p: id, t: trabajo })).trabajo;
  }
  async publicarFotografia(id: string, trabajo: string, clave: string, version: number, aceptarAvisos = false): Promise<TrabajoFotografico> {
    return (await this.gestion<{trabajo: TrabajoFotografico}>(
      "mutation($p: String!, $t: String!, $c: String!, $d: JSON!) { publicarRecurso(producto: $p, trabajo: $t, clave: $c, datos: $d) }",
      { p: id, t: trabajo, c: clave, d: {versión_esperada: version, ...(aceptarAvisos ? {aceptar_avisos: true} : {})} })).trabajo;
  }
  async previsualizarFotografia(id: string, trabajo: string): Promise<Blob> {
    const r = await this.solicitar(`${this.url}/productos/${id}/recursos-probador/${trabajo}/previsualizacion`, {
      headers: await this.credenciales.cabeceras(), cache: "no-store", signal: AbortSignal.timeout(10_000)});
    if (!r.ok || r.headers.get("Content-Type")?.split(";")[0] !== "image/png") throw new Error("No se pudo cargar la previsualización.");
    return r.blob();
  }

  async descargar(): Promise<Producto[]> {
    const productos: Producto[] = [];
    let total: number | undefined;
    for (let página = 1; página <= 10000; página++) {
      const resultado = await this.gestion<PaginaProductos>(
        "query($p: Int!) { productosAdmin(pagina: $p, limite: 100) }", { p: página },
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
      await this.gestion<{ producto: Producto }>(
        "query($p: String!) { productoAdmin(producto: $p) }", { p: identificador },
      )
    ).producto;
  }

  procesadores(): ProcesadorOperacion[] {
    return [...["CREAR_VARIANTE", "MODIFICAR_VARIANTE", "REGISTRAR_MOVIMIENTO", "CONFIGURAR_MINIMO"].map(tipo => ({
      tipo, endpoint: this.url + "/graphql", procesar: (operación: Readonly<Operacion>, señal: AbortSignal) => this.enviarExistencias(operación, señal),
    })), ...["REGISTRAR_PRODUCTO", "MODIFICAR_PRODUCTO"].map((tipo) => ({
      tipo,
      endpoint: this.url + "/graphql",
      procesar: async (operación: Readonly<Operacion>, señal: AbortSignal) => this.enviar(operación, señal),
    }))];
  }

  async variantes(producto: string, administración = false): Promise<Variante[]> {
    // La vista pública de la tienda sigue en REST; la administrativa es una consulta de gestión (GraphQL).
    const respuesta = administración
      ? await this.gestion<{ variantes: Variante[] }>("query($p: String!) { variantesAdmin(producto: $p) }", { p: producto })
      : await this.petición<{ variantes: Variante[] }>("/productos/" + encodeURIComponent(producto) + "/variantes");
    if (!Array.isArray(respuesta.variantes) || !respuesta.variantes.every(varianteValida) || respuesta.variantes.some(v => v.identificador_producto !== producto)) throw new Error("Respuesta de variantes inválida.");
    return respuesta.variantes;
  }
  async variante(id: string): Promise<Variante> {
    const respuesta = await this.gestion<ConfirmacionExistencias>("query($v: String!) { varianteAdmin(variante: $v) }", { v: id });
    if (!varianteValida(respuesta.variante)) throw new Error("Respuesta de variante inválida.");
    return respuesta.variante;
  }
  async movimientos(id: string): Promise<Movimiento[]> {
    const respuesta = await this.gestion<{ movimientos: Movimiento[] }>("query($v: String!) { movimientos(variante: $v) }", { v: id });
    if (!Array.isArray(respuesta.movimientos)) throw new Error("Historial inválido.");
    return respuesta.movimientos;
  }
  async enviarExistencias(operación: Readonly<Operacion>, señal: AbortSignal): Promise<ConfirmacionExistencias> {
    const { identificador_producto, identificador_variante, ...datos } = operación.datos;
    const crear = operación.tipo === "CREAR_VARIANTE";
    const movimiento = operación.tipo === "REGISTRAR_MOVIMIENTO";
    const mínimo = operación.tipo === "CONFIGURAR_MINIMO";
    const mutación = crear ? "crearVariante(producto: $id, clave: $c, datos: $d)"
      : `${movimiento ? "registrarMovimiento" : mínimo ? "fijarMinimo" : "modificarVariante"}(variante: $id, clave: $c, datos: $d)`;
    const respuesta = await this.gestion<ConfirmacionExistencias>(`mutation($id: String!, $c: String!, $d: JSON!) { ${mutación} }`, {
      id: String(crear ? identificador_producto : identificador_variante), c: operación.claveIdempotencia,
      d: { ...datos, ...(!crear ? { versión_esperada: operación.versiónEsperada } : {}) },
    }, señal);
    if (!varianteValida(respuesta.variante) || respuesta.variante.identificador !== (crear ? datos["identificador"] : identificador_variante)
      || respuesta.variante.versión_sincronización !== (crear ? 1 : Number(operación.versiónEsperada) + 1))
      throw new Error("No se recibió una confirmación válida de existencias. Se reintentará la misma operación.");
    return respuesta;
  }

  async enviar(
    operación: Readonly<Operacion>,
    señal: AbortSignal,
  ): Promise<Producto> {
    const modificación = operación.tipo === "MODIFICAR_PRODUCTO";
    const { identificadorProducto, ...datos } = operación.datos;
    const cuerpo = { ...datos, ...(modificación ? { versión_esperada: operación.versiónEsperada } : {}) };
    const respuesta = modificación
      ? await this.gestion<{ producto: Producto }>(
          "mutation($p: String!, $c: String!, $d: JSON!) { modificarProducto(producto: $p, clave: $c, datos: $d) }",
          { p: String(identificadorProducto), c: operación.claveIdempotencia, d: cuerpo }, señal)
      : await this.gestion<{ producto: Producto }>(
          "mutation($c: String!, $d: JSON!) { crearProducto(clave: $c, datos: $d) }",
          { c: operación.claveIdempotencia, d: cuerpo }, señal);
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
