import { DestroyRef, Injectable, effect, inject, signal, untracked } from "@angular/core";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import type { Operacion } from "../../catalogo/dominio/modelos";
import { VENTAS_REST } from "../adaptadores/ventas-rest";
import { CONFIRMAR_PEDIDO, solicitudPedido, type PedidoVenta } from "../dominio/modelos";
import { EstadoSesion } from "../../sesion/aplicacion/estado-sesion";

/** CU03: confirmar el carrito como pedido (también sin conexión) y seguir su estado en la SAGA de Ventas. */
@Injectable({ providedIn: "root" })
export class EstadoPedidos {
  private readonly catálogo = inject(EstadoCatalogo);
  private readonly ventas = inject(VENTAS_REST);
  private readonly sesion = inject(EstadoSesion);
  readonly pedidos = signal<Operacion[]>([]);
  readonly actualizando = signal(false);
  readonly error = signal("");
  readonly historial = signal<PedidoVenta[]>([]);
  readonly fechaHistorial = signal<string | null>(null);
  readonly historialGuardado = signal(true);

  constructor() {
    const recuperar = () => void this.actualizar();
    const desconectar = () => this.historialGuardado.set(true);
    window.addEventListener("online", recuperar);
    window.addEventListener("offline", desconectar);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener("online", recuperar);
      window.removeEventListener("offline", desconectar);
    });
    let cuenta: string | null | undefined;
    effect(() => {
      const nueva = this.sesion.titular()?.sub ?? null;
      if (nueva === cuenta) return;
      cuenta = nueva;
      untracked(() => {
        this.pedidos.set([]); this.historial.set([]); this.fechaHistorial.set(null);
        void this.cargar().then(() => { if (navigator.onLine) void this.actualizar(); })
          .catch(() => this.error.set("No se pudo leer el historial guardado."));
      });
    });
  }

  async cargar(): Promise<void> {
    await this.sesion.cargar();
    const titular = this.sesion.titular()?.sub;
    const operaciones = await this.catálogo.local.operaciones();
    const copia = titular ? await this.catálogo.local.historial(titular) : undefined;
    if (titular !== this.sesion.titular()?.sub) return;
    this.historial.set(copia?.pedidos ?? []);
    this.fechaHistorial.set(copia?.fecha ?? null);
    this.pedidos.set(operaciones.filter(operación => operación.tipo === CONFIRMAR_PEDIDO && !!titular && operación.titular === titular)
      .sort((uno, otro) => otro.fechaCreación.localeCompare(uno.fechaCreación)));
  }

  /** Guarda el pedido en la cola local y vacía el carrito en la misma transacción; el envío lo hace el sincronizador. */
  async confirmar(): Promise<Operacion> {
    // El UUID del pedido lo asigna el dispositivo: reintentos y reenvíos llegan a Ventas como el mismo pedido.
    const identificador = crypto.randomUUID();
    const titular = this.sesion.titular()?.sub;
    if (!titular) throw new Error("Inicia sesión para confirmar tu pedido.");
    const operación = await this.catálogo.local.encolarPedido(líneas => ({
      identificador, tipo: CONFIRMAR_PEDIDO, fechaCreación: new Date().toISOString(), estado: "PENDIENTE",
      intentos: 0, próximoIntento: 0, datos: solicitudPedido(identificador, líneas), claveIdempotencia: crypto.randomUUID(), titular,
    }));
    await this.cargar();
    void this.catálogo.sincronizar(true).then(() => this.cargar());
    return operación;
  }

  /** Envía lo pendiente y consulta en Ventas los pedidos que aún no terminaron su SAGA. */
  async actualizar(): Promise<void> {
    if (this.actualizando()) return;
    const cuentaInicial = this.sesion.titular()?.sub;
    this.actualizando.set(true);
    this.error.set("");
    try {
      await this.catálogo.sincronizar(true);
      await this.cargar();
      const titular = this.sesion.titular()?.sub;
      if (titular) {
        const pedidos = await this.ventas.historial(titular);
        if (this.sesion.titular()?.sub !== titular) return;
        await this.catálogo.local.guardarHistorial(titular, pedidos, new Date().toISOString());
        this.historialGuardado.set(false);
      }
      // También los confirmados cuyo comprobante aún no llegó (lo genera la automatización n8n unos segundos después).
      const abiertos = this.pedidos().filter(op => op.resultadoPedido && (["PENDIENTE", "EN_REVISION"].includes(op.resultadoPedido.estado)
        || (op.resultadoPedido.estado === "CONFIRMADO" && !op.resultadoPedido.comprobante_disponible)));
      // Consultas en paralelo e independientes: una falla no impide actualizar los demás pedidos.
      const resultados = await Promise.allSettled(abiertos.map(async operación =>
        this.catálogo.local.actualizarPedido(operación.identificador, await this.ventas.consultar(operación.identificador))));
      if (resultados.some(resultado => resultado.status === "rejected"))
        this.error.set("Algunos pedidos no se pudieron consultar en Ventas. Se muestra su último estado guardado.");
      await this.cargar();
    } catch {
      this.historialGuardado.set(true);
      this.error.set("No se pudo consultar Ventas. Se muestra el último estado guardado en este dispositivo.");
    } finally {
      try { await this.cargar(); }
      catch { this.error.set("No se pudo leer el historial guardado."); }
      finally { this.actualizando.set(false); }
      if (navigator.onLine && this.sesion.titular()?.sub && cuentaInicial !== this.sesion.titular()?.sub)
        void this.actualizar();
    }
  }

  async descargarComprobante(identificador: string): Promise<void> {
    this.error.set("");
    try {
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(await this.ventas.comprobante(identificador));
      enlace.download = `comprobante-${identificador.slice(0, 8)}.xlsx`;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "No se pudo descargar el comprobante.");
    }
  }

  /** Ventas rechazó el pedido de forma permanente: sus prendas vuelven al carrito para corregir y confirmar de nuevo. */
  async recuperarEnCarrito(identificador: string): Promise<void> {
    await this.catálogo.local.recuperarPedidoEnCarrito(identificador);
    await this.cargar();
  }

  /** Confirmación incierta (reintentos agotados): se reenvía la MISMA operación, con su UUID y su Idempotency-Key. */
  async reintentar(identificador: string): Promise<void> {
    await this.catálogo.local.reintentarIncierta(identificador);
    await this.cargar();
    await this.actualizar();
  }
}
