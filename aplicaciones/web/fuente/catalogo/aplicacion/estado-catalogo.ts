import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  InjectionToken,
  signal,
} from "@angular/core";
import type { FuenteCatalogo, Producto } from "../dominio/modelos";
import { RepositorioLocal } from "../adaptadores/repositorio-local";
import { Sincronizador } from "./sincronizador";
import { ADMINISTRACION_REST } from "../../administracion/adaptadores/administracion-rest";

export const FUENTE_CATALOGO = new InjectionToken<FuenteCatalogo>(
  "CLB Inventario REST",
);

@Injectable({ providedIn: "root" })
export class EstadoCatalogo {
  readonly local = new RepositorioLocal();
  private readonly remoto = inject(FUENTE_CATALOGO);
  private readonly administración = inject(ADMINISTRACION_REST);
  private readonly motor = new Sincronizador(
    this.local,
    this.remoto,
    this.administración.procesadores(),
  );
  readonly revisiónLocal = signal(0);
  readonly errorAdministracion = signal("");
  readonly productos = signal<Producto[]>([]);
  readonly favoritos = signal<Set<string>>(new Set());
  readonly pendientes = signal(0);
  readonly cargando = signal(true);
  readonly sincronizando = signal(false);
  readonly disponible = signal(false);
  readonly conexión = signal(navigator.onLine);
  readonly desdeCaché = signal(true);
  readonly últimaSincronización = signal("");
  readonly error = signal("");
  readonly categorías = computed(() =>
    [...new Set(this.productos().map((producto) => producto.categoría))].sort(
      (uno, otro) => uno.localeCompare(otro, "es"),
    ),
  );
  private inicialización?: Promise<void>;

  constructor() {
    const recuperar = () => {
      this.conexión.set(navigator.onLine);
      void this.sincronizar(true);
    };
    const desconectar = () => {
      this.conexión.set(false);
      this.disponible.set(false);
      this.desdeCaché.set(true);
    };
    window.addEventListener("online", recuperar);
    window.addEventListener("offline", desconectar);
    const intervalo = setInterval(() => {
      void this.sincronizar();
    }, 15_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(intervalo);
      window.removeEventListener("online", recuperar);
      window.removeEventListener("offline", desconectar);
      void this.local.cerrar();
    });
  }

  iniciar(): Promise<void> {
    return (this.inicialización ??= this.cargarInicial());
  }

  private async cargarInicial(): Promise<void> {
    try {
      await this.leerLocal();
    } catch {
      this.error.set(
        "No se pudo abrir el almacenamiento local. Comprueba los permisos del navegador.",
      );
    }
    await this.sincronizar(true);
    this.cargando.set(false);
  }

  private async leerLocal(): Promise<void> {
    const [productos, favoritos, operaciones, fecha] = await Promise.all([
      this.local.productos(),
      this.local.favoritos(),
      this.local.operaciones(),
      this.local.metadato("última_sincronización"),
    ]);
    this.productos.set(
      productos.sort(
        (uno, otro) =>
          uno.nombre.localeCompare(otro.nombre, "es") ||
          uno.identificador.localeCompare(otro.identificador),
      ),
    );
    this.favoritos.set(
      new Set(favoritos.map((favorito) => favorito.identificador)),
    );
    this.pendientes.set(
      operaciones.filter((operación) => operación.estado !== "CONFIRMADA")
        .length,
    );
    this.últimaSincronización.set(typeof fecha === "string" ? fecha : "");
    this.revisiónLocal.update((valor) => valor + 1);
  }

  async sincronizar(forzar = false): Promise<void> {
    if (this.sincronizando()) return;
    if (!navigator.onLine) {
      this.desdeCaché.set(true);
      this.disponible.set(false);
      return;
    }
    this.sincronizando.set(true);
    try {
      const resultado = await this.motor.sincronizar(forzar);
      if (
        resultado.disponible &&
        (await this.local.metadato("administracion_visitada")) === true
      ) {
        try {
          await this.local.guardarAdministracion(
            await this.administración.descargar(),
          );
          this.errorAdministracion.set("");
        } catch (error) {
          this.errorAdministracion.set(
            error instanceof Error
              ? error.message
              : "No se pudo descargar la administración.",
          );
        }
      }
      if (resultado.disponible !== null)
        this.disponible.set(resultado.disponible);
      this.desdeCaché.set(!resultado.actualizado);
      await this.leerLocal();
      if (resultado.disponible !== null)
        this.error.set(
          resultado.disponible
            ? ""
            : "Inventario no responde. Conservamos tu catálogo descargado; puede estar desactualizado.",
        );
    } catch {
      this.desdeCaché.set(true);
      this.error.set(
        "No se pudo guardar o leer el catálogo local. Inténtalo de nuevo.",
      );
    } finally {
      this.sincronizando.set(false);
    }
  }

  async alternarFavorito(identificador: string): Promise<void> {
    try {
      await this.local.alternarFavorito(identificador);
      await this.leerLocal();
    } catch {
      this.error.set(
        "No se pudo guardar el favorito. Revisa el espacio disponible del navegador.",
      );
    }
  }

  async consultar(identificador: string): Promise<Producto> {
    await this.iniciar();
    if (navigator.onLine && this.disponible()) {
      try {
        const producto = await this.remoto.consultar(identificador);
        await this.local.guardarProducto(producto);
        return producto;
      } catch (error) {
        if (error instanceof Error && "estado" in error && error.estado === 404)
          throw error;
      }
    }
    const producto = await this.local.producto(identificador);
    if (!producto)
      throw new Error(
        "Este producto no está disponible en el catálogo descargado.",
      );
    return producto;
  }
}

export function ilustraciónProducto(categoría: string): string {
  const nombre = categoría.toLocaleLowerCase("es");
  if (nombre.includes("pantal")) return "/ilustraciones/pantalon.svg";
  if (nombre.includes("vestid")) return "/ilustraciones/vestido.svg";
  if (nombre.includes("chaquet")) return "/ilustraciones/chaqueta.svg";
  if (nombre.includes("tejid")) return "/ilustraciones/sueter.svg";
  if (nombre.includes("camiseta")) return "/ilustraciones/camiseta.svg";
  return "/ilustraciones/camisa.svg";
}

export function precioEnBob(precio: string): string {
  return `${precio.replace(".", ",")} Bs`;
}
