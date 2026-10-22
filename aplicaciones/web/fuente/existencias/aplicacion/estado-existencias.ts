import { effect, inject, Injectable, signal } from "@angular/core";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import { ADMINISTRACION_REST } from "../../administracion/adaptadores/administracion-rest";
import type { Operacion } from "../../catalogo/dominio/modelos";
import type { Variante, Movimiento } from "../dominio/modelos";

const tipos = ["CREAR_VARIANTE", "MODIFICAR_VARIANTE", "REGISTRAR_MOVIMIENTO", "CONFIGURAR_MINIMO"];

@Injectable({ providedIn: "root" })
export class EstadoExistencias {
  readonly catálogo = inject(EstadoCatalogo);
  private readonly remoto = inject(ADMINISTRACION_REST);
  readonly producto = signal("");
  readonly variantes = signal<Variante[]>([]);
  readonly propuestas = signal<Operacion[]>([]);
  readonly historial = signal<Movimiento[]>([]);
  readonly error = signal("");
  readonly mensaje = signal("");
  private lectura = 0;
  constructor() {
    effect(() => {
      this.catálogo.revisiónLocal();
      if (this.producto()) void this.cargar(this.producto());
    });
  }
  async cargar(producto: string): Promise<void> {
    const turno = ++this.lectura;
    this.producto.set(producto);
    try {
      const local = this.catálogo.local;
      const almacenadas = await local.variantes(producto, true);
      if (turno !== this.lectura) return;
      this.variantes.set(almacenadas.length ? almacenadas : await local.variantes(producto));
      await this.leerOperaciones();
      if (navigator.onLine && this.catálogo.disponible()) {
        const variantes = await this.remoto.variantes(producto, true);
        if (turno !== this.lectura) return;
        await local.guardarVariantes(producto, variantes, true);
        this.variantes.set(variantes);
      }
    } catch (error) { if (turno === this.lectura) this.error.set(this.texto(error)); }
  }
  private async leerOperaciones(): Promise<void> {
    this.propuestas.set((await this.catálogo.local.operaciones()).filter(op => tipos.includes(op.tipo)));
  }
  async guardar(tipo: string, datos: Record<string, unknown>, base?: Variante, reemplaza?: string): Promise<boolean> {
    this.error.set(""); this.mensaje.set("");
    try {
      const identificador = crypto.randomUUID();
      const operación: Operacion = {
        identificador, tipo, claveIdempotencia: identificador, fechaCreación: new Date().toISOString(),
        estado: "PENDIENTE", intentos: 0, próximoIntento: Date.now(),
        versiónEsperada: base?.versión_sincronización ?? null,
        datos: tipo === "CREAR_VARIANTE" ? { ...datos, identificador_producto: this.producto(), identificador: datos["identificador"] ?? crypto.randomUUID() }
          : { ...datos, identificador_variante: base?.identificador ?? datos["identificador_variante"] },
      };
      await this.catálogo.local.encolarExistencias(operación, reemplaza);
      await this.leerOperaciones();
      this.mensaje.set("Propuesta guardada. El saldo confirmado cambia al recibir respuesta válida del servidor.");
      await this.catálogo.sincronizar(true);
      await this.cargar(this.producto());
      return true;
    } catch (error) { this.error.set(this.texto(error)); return false; }
  }
  async actualizarBase(base?: Variante): Promise<Variante | undefined> {
    // Una recarga del listado puede terminar después del comprobante propio.
    // El siguiente comando usa la confirmación propia más reciente sin degradar
    // la versión cargada expresamente al revisar un conflicto.
    const confirmadas = (await this.catálogo.local.operaciones())
      .filter(op => op.estado === "CONFIRMADA" && op.resultadoExistencias?.identificador === base?.identificador)
      .map(op => op.resultadoExistencias!)
      .sort((a, b) => b.versión_sincronización - a.versión_sincronización);
    const actual = confirmadas[0];
    return actual && base && actual.versión_sincronización > base.versión_sincronización ? actual : base;
  }
  async verHistorial(variante: Variante): Promise<void> {
    this.error.set("");
    try {
      this.historial.set(await this.catálogo.local.movimientos(variante.identificador));
      if (navigator.onLine && this.catálogo.disponible()) {
        const movimientos = await this.remoto.movimientos(variante.identificador);
        await this.catálogo.local.guardarMovimientos(variante.identificador, movimientos);
        this.historial.set(movimientos);
      }
    } catch (error) { this.error.set(this.texto(error)); }
  }
  async revisar(operación: Operacion): Promise<Variante | undefined> {
    if (operación.estado !== "REQUIERE_REVISION" || operación.motivoRevision === "REINTENTOS_AGOTADOS" || operación.reemplazadaPor)
      throw new Error("Esta operación no admite sustitución. Conserva su UUID si la confirmación es incierta.");
    if (operación.tipo === "CREAR_VARIANTE") { await this.cargar(String(operación.datos["identificador_producto"])); return undefined; }
    if (!navigator.onLine || !this.catálogo.disponible()) throw new Error("Conecta con Inventario para revisar el estado actual.");
    const actual = await this.remoto.variante(String(operación.datos["identificador_variante"]));
    await this.cargar(actual.identificador_producto);
    return actual;
  }
  async reintentar(id: string): Promise<void> {
    try {
      await this.catálogo.local.reintentarIncierta(id);
      await this.catálogo.sincronizar(true);
      await this.cargar(this.producto());
    } catch (error) { this.error.set(this.texto(error)); }
  }
  private texto(error: unknown): string { return error instanceof Error ? error.message : "No se pudo gestionar existencias."; }
}
