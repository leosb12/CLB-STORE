import { Injectable, inject, signal } from "@angular/core";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import type { Producto } from "../../catalogo/dominio/modelos";
import { centavos, type Variante, type LineaCarrito } from "../dominio/modelos";

@Injectable({ providedIn: "root" })
export class EstadoCarrito {
  private readonly local = inject(EstadoCatalogo).local;
  readonly líneas = signal<LineaCarrito[]>([]);
  readonly error = signal("");
  async cargar(): Promise<void> { this.líneas.set(await this.local.carrito()); }
  async agregar(producto: Producto, variante: Variante, cantidad: number): Promise<void> {
    await this.local.agregarCarrito({ identificador: variante.identificador, identificadorProducto: producto.identificador,
      sku: variante.sku, nombre: producto.nombre, talla: variante.talla, color: variante.color, precioCentavos: centavos(producto.precio), cantidad });
    await this.cargar();
  }
  async cantidad(id: string, cantidad: number): Promise<void> {
    try { await this.local.cantidadCarrito(id, cantidad); await this.cargar(); this.error.set(""); }
    catch (error) { this.error.set(error instanceof Error ? error.message : "Cantidad inválida."); }
  }
  async quitar(id: string): Promise<void> { await this.local.quitarCarrito(id); await this.cargar(); }
  async vaciar(): Promise<void> { await this.local.vaciarCarrito(); await this.cargar(); }
}
