import { Injectable, inject, signal } from "@angular/core";
import { GESTION_REST } from "../adaptadores/gestion-rest";
import { GrabadoraVoz } from "../adaptadores/grabadora-voz";
import type {
  Alerta, Auditoria, Destino, Especificacion, Notificacion, Propuesta, Reporte, ResultadoMision, Segmentacion, VarianteStock,
} from "../dominio/modelos";

/** CU05: gestión empresarial construida con agentes. Cada sección del panel es la misión de un agente. */
@Injectable({ providedIn: "root" })
export class EstadoGestion {
  private readonly rest = inject(GESTION_REST);
  private readonly grabadora = new GrabadoraVoz();
  readonly vozDisponible = GrabadoraVoz.disponible();

  readonly mision = signal<ResultadoMision | null>(null);
  readonly reporte = signal<Reporte | null>(null);
  readonly historial = signal<Reporte[]>([]);
  readonly stockBajo = signal<VarianteStock[]>([]);
  readonly alertas = signal<Alerta[]>([]);
  readonly propuestas = signal<Propuesta[]>([]);
  readonly segmentacion = signal<Segmentacion | null>(null);
  readonly auditoria = signal<Auditoria[]>([]);
  readonly notificaciones = signal<Notificacion[]>([]);
  /** Qué está en curso: una sola operación larga a la vez evita misiones duplicadas por doble clic. */
  readonly ocupado = signal<"" | "mision" | "reporte" | "voz" | "grabando" | "datos" | "propuesta">("");
  readonly error = signal("");
  readonly aviso = signal("");

  async ejecutarMision(texto: string): Promise<void> {
    await this.tarea("mision", async () => {
      this.mision.set(await this.rest.mision(texto));
      // La misión puede haber creado propuestas de reposición: se muestran sin recargar la página.
      this.propuestas.set(await this.rest.propuestas());
    });
  }

  async generarReporte(solicitud: { peticion?: string; especificacion?: Especificacion; destino?: Destino }): Promise<Reporte | null> {
    let reporte: Reporte | null = null;
    await this.tarea("reporte", async () => {
      reporte = await this.rest.reporte(solicitud);
      this.reporte.set(reporte);
      this.historial.set(await this.rest.historial());
    });
    return reporte;
  }

  async cargarHistorial(): Promise<void> {
    await this.tarea("datos", async () => this.historial.set(await this.rest.historial()));
  }

  async cargarInventario(): Promise<void> {
    await this.tarea("datos", async () => {
      const [datos, propuestas] = await Promise.all([this.rest.inventario(), this.rest.propuestas()]);
      this.stockBajo.set(datos.stockBajo);
      this.alertas.set(datos.alertas);
      this.propuestas.set(propuestas);
    });
  }

  async cargarSegmentos(): Promise<void> {
    await this.tarea("datos", async () => this.segmentacion.set(await this.rest.segmentos()));
  }

  /** CU05.8: alertas que dejó la automatización n8n; se listan solo las que nadie atendió todavía. */
  async cargarNotificaciones(): Promise<void> {
    await this.tarea("datos", async () => this.notificaciones.set(await this.rest.notificaciones()));
  }

  async atender(notificacion: Notificacion): Promise<void> {
    await this.tarea("datos", async () => {
      await this.rest.atender(notificacion.evento);
      this.notificaciones.update((lista) => lista.filter((n) => n.evento !== notificacion.evento));
      this.aviso.set(`Alerta de ${notificacion.sku} marcada como atendida.`);
    });
  }

  async cargarAuditoria(): Promise<void> {
    await this.tarea("datos", async () => this.auditoria.set(await this.rest.auditoria()));
  }

  /** La única escritura de los agentes: una persona confirma o rechaza la propuesta. */
  async resolver(propuesta: Propuesta, accion: "confirmar" | "rechazar"): Promise<void> {
    await this.tarea("propuesta", async () => {
      await this.rest.resolver(propuesta.identificador, accion);
      this.aviso.set(accion === "confirmar"
        ? `Recepción de mercadería registrada: ${propuesta.cantidad} unidades de ${propuesta.sku} ingresaron físicamente a Inventario. El stock de este panel se actualiza con la próxima copia (unos 2 minutos).`
        : `Propuesta de ${propuesta.sku} rechazada. No se modificó el stock.`);
    });
    await this.cargarInventario();
  }

  async descargarExcel(reporte: Reporte): Promise<void> {
    await this.tarea("datos", async () => {
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(await this.rest.excel(reporte.identificador));
      enlace.download = `clb-reporte-${reporte.identificador.slice(0, 8)}.xlsx`;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
    });
  }

  async reporteGuardado(identificador: string): Promise<void> {
    await this.tarea("datos", async () => this.reporte.set(await this.rest.reporteGuardado(identificador)));
  }

  async empezarGrabacion(): Promise<void> {
    this.error.set("");
    try {
      await this.grabadora.iniciar();
      this.ocupado.set("grabando");
    } catch {
      this.error.set("No se pudo usar el micrófono. Revisa el permiso del navegador o escribe la petición.");
    }
  }

  /** Detiene la grabación y devuelve el texto reconocido por faster-whisper en el servidor. */
  async terminarGrabacion(): Promise<string> {
    const audio = await this.grabadora.detener();
    this.ocupado.set("");
    let texto = "";
    await this.tarea("voz", async () => { texto = await this.rest.transcribir(audio); });
    return texto;
  }

  private async tarea(tipo: Exclude<ReturnType<typeof this.ocupado>, "">, accion: () => Promise<void>): Promise<void> {
    this.ocupado.set(tipo);
    this.error.set("");
    try {
      await accion();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Ocurrió un error inesperado.");
    } finally {
      this.ocupado.set("");
    }
  }
}
