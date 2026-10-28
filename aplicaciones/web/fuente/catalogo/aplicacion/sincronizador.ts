import {
  ErrorRemoto,
  type FuenteCatalogo,
  type ProcesadorOperacion,
} from "../dominio/modelos";
import { RepositorioLocal } from "../adaptadores/repositorio-local";

export interface ResultadoSincronizacion {
  disponible: boolean | null;
  actualizado: boolean;
}

export class Sincronizador {
  private ejecución?: Promise<ResultadoSincronizacion>;
  private próximoIntento = 0;
  private fallos = 0;
  private readonly propietario = crypto.randomUUID();

  constructor(
    private readonly local: RepositorioLocal,
    private readonly remoto: FuenteCatalogo,
    private readonly procesadores: readonly ProcesadorOperacion[] = [],
    private readonly reloj = Date.now,
  ) {}

  sincronizar(forzar = false): Promise<ResultadoSincronizacion> {
    if (this.ejecución) return this.ejecución;
    this.ejecución = this.ejecutar(forzar).finally(() => {
      this.ejecución = undefined;
    });
    return this.ejecución;
  }

  private async descargarCatalogo(): Promise<void> {
    const productos = await this.remoto.descargar();
    const texturas = await this.remoto.descargarRecursos?.(productos,await this.local.texturas()) ?? [];
    await this.local.guardarCatalogo(productos,texturas);
  }

  private async ejecutar(forzar: boolean): Promise<ResultadoSincronizacion> {
    if (!forzar && this.reloj() < this.próximoIntento)
      return { disponible: false, actualizado: false };
    if (!(await this.local.tomarTurno(this.propietario, this.reloj())))
      return { disponible: null, actualizado: false };
    const renovación = setInterval(() => {
      void this.local
        .tomarTurno(this.propietario, this.reloj())
        .catch(() => undefined);
    }, 10_000);
    try {
      // La descarga del catálogo y la cola son independientes: si Inventario no responde, los pedidos para Ventas
      // igual se envían. Una descarga fallida nunca reemplaza el catálogo válido.
      let catálogoAlDía = false;
      try {
        if (await this.remoto.disponible()) {
          await this.descargarCatalogo();
          catálogoAlDía = true;
        }
      } catch {
        catálogoAlDía = false;
      }
      if (catálogoAlDía) {
        this.fallos = 0;
        this.próximoIntento = 0;
      } else {
        this.fallos++;
        this.próximoIntento = this.reloj() + Math.min(300_000, 1000 * 2 ** Math.min(this.fallos, 9));
      }
      let huboEscrituras = false;
      const pendientes = (await this.local.operaciones()).sort(
        (uno, otro) =>
          uno.fechaCreación.localeCompare(otro.fechaCreación) ||
          uno.identificador.localeCompare(otro.identificador),
      );
      // Orden topológico estable: una dependencia puede tener la misma fecha que su hija.
      const ordenadas = pendientes.filter(operación => !operación.dependencias?.length);
      const restantes = pendientes.filter(operación => operación.dependencias?.length);
      while (restantes.length) {
        const índice = restantes.findIndex(operación => operación.dependencias?.every(id => ordenadas.some(anterior => anterior.identificador === id)));
        if (índice < 0) break; // Dependencia ausente/cíclica: se conserva pendiente, sin envío.
        ordenadas.push(...restantes.splice(índice, 1));
      }
      for (const pendiente of ordenadas) {
        const procesador = this.procesadores.find(
          (candidato) =>
            candidato.tipo === pendiente.tipo &&
            candidato.endpoint.trim() !== "",
        );
        if (!procesador) continue; // Favoritos permanecen pendientes; no existe su servicio remoto.
        const operación = await this.local.reclamar(
          pendiente.identificador,
          this.propietario,
          this.reloj(),
        );
        if (!operación) continue;
        const cancelación = new AbortController();
        let temporizador: ReturnType<typeof setTimeout> | undefined;
        try {
          const producto = await Promise.race([
            procesador.procesar(operación, cancelación.signal),
            new Promise<never>((_, rechazar) => {
              temporizador = setTimeout(() => {
                cancelación.abort();
                rechazar(new Error("Tiempo de envío agotado."));
              }, procesador.tiempoMáximo ?? 10_000);
            }),
          ]);
          await this.local.finalizar(
            {
              ...operación,
              estado: "CONFIRMADA",
              error: undefined,
              detalleError: undefined,
              motivoRevision: undefined,
            },
            this.propietario,
            producto || undefined,
          );
          huboEscrituras = true;
        } catch (error) {
          const permanente =
            error instanceof ErrorRemoto &&
            error.estado >= 400 &&
            error.estado < 500 &&
            // 401: la sesión venció o aún no existe; al iniciar sesión se reenvía la misma operación.
            ![401, 408, 425, 429].includes(error.estado);
          const revisión = permanente || operación.intentos >= 8;
          await this.local.finalizar(
            {
              ...operación,
              estado: revisión ? "REQUIERE_REVISION" : "ERROR_REINTENTABLE",
              próximoIntento:
                this.reloj() +
                Math.min(300_000, 1000 * 2 ** (operación.intentos - 1)),
              error:
                error instanceof Error
                  ? error.message
                  : "No se pudo procesar la operación.",
              detalleError:
                error instanceof ErrorRemoto ? error.detalles : undefined,
              motivoRevision: revisión
                ? permanente
                  ? "CONFLICTO_PERMANENTE"
                  : "REINTENTOS_AGOTADOS"
                : undefined,
            },
            this.propietario,
          );
        } finally {
          if (temporizador) clearTimeout(temporizador);
        }
      }
      // Tras escrituras confirmadas se relee el catálogo (stock y altas), solo si Inventario respondió en esta pasada.
      if (huboEscrituras && catálogoAlDía)
        await this.descargarCatalogo().catch(() => undefined);
      return { disponible: catálogoAlDía, actualizado: catálogoAlDía };
    } catch (error) {
      this.fallos++;
      this.próximoIntento =
        this.reloj() + Math.min(300_000, 1000 * 2 ** Math.min(this.fallos, 9));
      // Una descarga parcial o una caída del servidor nunca reemplaza el catálogo válido.
      return { disponible: false, actualizado: false };
    } finally {
      clearInterval(renovación);
      await this.local.liberarTurno(this.propietario);
    }
  }
}
