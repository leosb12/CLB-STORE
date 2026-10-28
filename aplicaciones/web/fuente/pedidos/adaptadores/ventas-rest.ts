import { InjectionToken } from "@angular/core";
import { ErrorRemoto, type Operacion, type ProcesadorOperacion } from "../../catalogo/dominio/modelos";
import type { CredencialesAdministrativas } from "../../administracion/adaptadores/administracion-rest";

/** Sesión vista por el adaptador: cabecera Authorization y sub del titular actual. */
export interface CredencialesTitular extends CredencialesAdministrativas {
  sub(): Promise<string | null>;
}
import { CONFIRMAR_PEDIDO, pedidoValido, type ConfirmacionPedido, type PedidoVenta } from "../dominio/modelos";

export const VENTAS_REST = new InjectionToken<VentasRest>("CLB Ventas REST");

/** Adaptador REST hacia el microservicio de Ventas (Spring Boot), que orquesta la SAGA de compra. */
export class VentasRest {
  constructor(private readonly url: string, private readonly credenciales: CredencialesTitular = { cabeceras: async () => ({}), sub: async () => null }) {}

  procesadores(): ProcesadorOperacion[] {
    // La SAGA es síncrona en Ventas y puede reintentar participantes: se espera más que el envío normal
    // (por debajo del proxy_read_timeout de 90 s) para no reenviar un pedido que aún se procesa.
    return [{ tipo: CONFIRMAR_PEDIDO, endpoint: this.url + "/pedidos", tiempoMáximo: 80_000, procesar: (operación, señal) => this.confirmar(operación, señal) }];
  }

  async confirmar(operación: Readonly<Operacion>, señal: AbortSignal): Promise<ConfirmacionPedido> {
    // En un navegador compartido, un pedido de A nunca se envía con la sesión de B: espera a que A vuelva.
    const titular = await this.credenciales.sub();
    if (!titular) throw new ErrorRemoto(401, "Inicia sesión para enviar tus pedidos.");
    if (operación.titular !== titular)
      throw new ErrorRemoto(401, "Este pedido pertenece a otra sesión. Se enviará cuando su titular inicie sesión.");
    const { carrito: _soloLocal, ...solicitud } = operación.datos;
    const respuesta = await this.petición<ConfirmacionPedido>("/pedidos", {
      method: "POST", signal: señal,
      // La misma clave en cada reintento: Ventas devuelve el pedido existente y nunca crea otro.
      headers: { "Content-Type": "application/json", "Idempotency-Key": operación.claveIdempotencia },
      body: JSON.stringify(solicitud),
    });
    if (!pedidoValido(respuesta.pedido) || respuesta.pedido.identificador !== solicitud["identificador"])
      throw new Error("Ventas no devolvió una confirmación válida. Se reintentará la misma operación.");
    return respuesta;
  }

  async consultar(identificador: string): Promise<PedidoVenta> {
    const respuesta = await this.petición<ConfirmacionPedido>("/pedidos/" + encodeURIComponent(identificador));
    if (!pedidoValido(respuesta.pedido)) throw new Error("Respuesta de pedido inválida.");
    return respuesta.pedido;
  }

  async historial(titular: string): Promise<PedidoVenta[]> {
    const pedidos = new Map<string, PedidoVenta>(), cursores = new Set<string>();
    let antes: string | null = null;
    for (let pagina = 0; pagina < 10000; pagina++) {
      if (await this.credenciales.sub() !== titular) throw new Error("La sesión cambió durante la consulta.");
      const respuesta: { pedidos: PedidoVenta[]; siguiente: string | null } = await this.petición(
        "/pedidos?limite=100" + (antes ? "&antes=" + encodeURIComponent(antes) : ""));
      if (await this.credenciales.sub() !== titular) throw new Error("La sesión cambió durante la consulta.");
      if (!Array.isArray(respuesta.pedidos) || !("siguiente" in respuesta)) throw new Error("Historial inválido.");
      for (const pedido of respuesta.pedidos) {
        if (!pedidoValido(pedido) || pedido.identificador_cliente !== titular || pedidos.has(pedido.identificador))
          throw new Error("Historial inválido o de otra cuenta.");
        pedidos.set(pedido.identificador, pedido);
      }
      if (respuesta.siguiente === null) return [...pedidos.values()];
      antes = respuesta.siguiente;
      if (typeof antes !== "string" || !/^[a-f0-9-]{36}$/i.test(antes) || cursores.has(antes)
        || respuesta.pedidos.at(-1)?.identificador !== antes) throw new Error("Paginación de historial inválida.");
      cursores.add(antes);
    }
    throw new Error("El historial excede el límite de descarga.");
  }

  /** Comprobante de venta (xlsx) que generó la automatización: solo lo descarga el titular del pedido. */
  async comprobante(identificador: string): Promise<Blob> {
    const credenciales = await this.credenciales.cabeceras();
    if (!credenciales["Authorization"]) throw new ErrorRemoto(401, "Inicia sesión para descargar tu comprobante.");
    const respuesta = await fetch(this.url + "/pedidos/" + encodeURIComponent(identificador) + "/comprobante", { cache: "no-store", headers: credenciales });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => ({}));
      throw new ErrorRemoto(respuesta.status, cuerpo.mensaje ?? "No se pudo descargar el comprobante.", cuerpo);
    }
    return respuesta.blob();
  }

  private async petición<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
    const credenciales = await this.credenciales.cabeceras();
    // El pedido es del titular del token: sin sesión vigente no se envía (queda pendiente y se reintenta).
    if (!credenciales["Authorization"]) throw new ErrorRemoto(401, "Inicia sesión para enviar tus pedidos.");
    const respuesta = await fetch(this.url + ruta, { ...opciones, cache: "no-store", headers: { Accept: "application/json", ...credenciales, ...opciones.headers } });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new ErrorRemoto(respuesta.status, cuerpo.mensaje ?? "Ventas no pudo procesar la solicitud.", cuerpo);
    return cuerpo as T;
  }
}
