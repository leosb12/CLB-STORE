import { Component, effect, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { ADMINISTRACION_REST } from "../../administracion/adaptadores/administracion-rest";
import { EstadoCarrito } from "../../existencias/aplicacion/estado-carrito";
import type { Variante } from "../../existencias/dominio/modelos";
import type { Producto } from "../dominio/modelos";
import { fotografiaPrenda } from "../dominio/imagen-prenda";
import { varianteDeTalla } from "../../probador/aplicacion/talla-sugerida";
import { prepararProbador } from "../../probador/adaptadores/cargador-probador";
import {
  EstadoCatalogo,
  ilustraciónProducto,
  precioEnBob,
} from "../aplicacion/estado-catalogo";

@Component({
  selector: "clb-pagina-detalle",
  imports: [RouterLink, FormsModule],
  template: ` <a class="volver" routerLink="/catalogo">← Volver al catálogo</a>
    @if (producto(); as prenda) {
      <article class="detalle">
        <div class="imagen-detalle" [class.fotografica]="(prenda.recurso_probador || esFoto(prenda.sku))">
          <img
            [src]="estado.imagen(prenda, false, elegida()?.color)"
            [alt]="(prenda.recurso_probador || esFoto(prenda.sku)) ? prenda.nombre : 'Ilustración de referencia de la prenda'"
            width="420"
            height="460"
          /><span>{{ prenda.recurso_probador ? 'Fotografía de la prenda · color ' + prenda.recurso_probador.color : esFoto(prenda.sku) ? 'Fotografía de la colección de demostración' : 'Ilustración de referencia' }}</span>
        </div>
        <div class="información-detalle">
          <span class="categoría-detalle">{{ prenda["categoría"] }}</span>
          <h1>{{ prenda.nombre }}</h1>
          @if (prenda.recurso_probador) { <p>Fotografía disponible en color {{prenda.recurso_probador.color}}. @if (elegida() && elegida()?.color !== prenda.recurso_probador.color) { La variante seleccionada usa una ilustración de referencia. }</p> }
          @if (!prenda.recurso_probador && esFoto(prenda.sku)) {
            <p><a href="/prendas/CREDITOS.txt" target="_blank" rel="noopener">Fotos: PNGimg.com · CC BY-NC 4.0</a></p>
          }
          <p class="precio-detalle">{{ precio(prenda.precio) }}</p>
          <p class="descripción">
            {{
              prenda["descripción"] || "Una prenda de la colección CLB Store."
            }}
          </p>
          <button
            class="botón-principal"
            [attr.aria-pressed]="estado.favoritos().has(prenda.identificador)"
            (click)="estado.alternarFavorito(prenda.identificador)"
          >
            {{
              estado.favoritos().has(prenda.identificador)
                ? "♥ Guardado en favoritos"
                : "♡ Guardar en favoritos"
            }}
          </button>
          <a class="botón-secundario probar-virtualmente" [routerLink]="['/productos', prenda.identificador, 'probador']">Probar virtualmente</a>
          <dl>
            <div>
              <dt>SKU</dt>
              <dd>{{ prenda.sku }}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>Activo</dd>
            </div>
            <div>
              <dt>Moneda</dt>
              <dd>Bolivianos · BOB</dd>
            </div>
          </dl>
          <p class="nota-local">
            Tus favoritos se conservan en este dispositivo.
          </p>
          <section class="seleccion-variante" aria-label="Elegir variante">
            <h2>Encuentra tu combinación</h2>
            @if (variantes().length) {
              <label>Talla y color<select name="varianteCatalogo" [(ngModel)]="seleccion"><option value="">Selecciona una combinación</option>
                @for (variante of variantes(); track variante.identificador) { <option [value]="variante.identificador">{{variante.talla}} / {{variante.color}} · {{variante.sku}}</option> }
              </select></label>
              @if (elegida(); as variante) {
                <p class="disponibilidad" [class.agotado]="variante.disponible === 0" data-disponibilidad>{{variante.disponible === 0 ? 'Agotado' : 'Disponibilidad de referencia: ' + variante.disponible + ' unidades'}}</p>
                <p class="nota-local">SKU de variante {{variante.sku}}</p>
                <label>Cantidad para el carrito<input name="cantidadCarrito" type="number" min="1" step="1" [(ngModel)]="cantidad" /></label>
                <button class="botón-principal" (click)="agregar()">Agregar al carrito</button>
              }
              <p class="nota-local">{{guardadas() || !estado.disponible() ? 'Variantes guardadas: las existencias pueden haber cambiado.' : 'El stock puede cambiar antes de confirmar una compra.'}} Precio y stock referenciales; agregar al carrito no reserva unidades.</p>
            } @else { <p class="nota-local">{{avisoVariantes() || 'Sin variantes registradas. No hay tallas, colores ni existencias confirmadas para elegir.'}}</p> }
            @if (mensajeCarrito()) { <p role="status">{{mensajeCarrito()}} <a routerLink="/carrito">Ver carrito →</a></p> }
          </section>
        </div>
      </article>
    } @else if (error()) {
      <div class="estado-vacío" role="alert">
        <h1>Prenda no disponible</h1>
        <p>{{ error() }}</p>
      </div>
    } @else {
      <p class="estado-vacío" role="status">Buscando tu prenda…</p>
    }`,
})
export class PaginaDetalle {
  readonly estado = inject(EstadoCatalogo);
  readonly producto = signal<Producto | undefined>(undefined);
  readonly error = signal("");
  readonly ilustración = ilustraciónProducto;
  readonly esFoto = fotografiaPrenda;
  readonly precio = precioEnBob;
  private readonly remotoVariantes = inject(ADMINISTRACION_REST);
  private readonly carrito = inject(EstadoCarrito);
  readonly variantes = signal<Variante[]>([]);
  readonly guardadas = signal(true);
  readonly avisoVariantes = signal("");
  readonly mensajeCarrito = signal("");
  seleccion = "";
  cantidad = 1;
  private consulta = 0;
  private productoVariantes = "";
  /** Talla sugerida por el probador (?talla=M): se preselecciona su variante si aún no hay una elegida. */
  private tallaSugerida: string | null = null;
  private colorSugerido: string | null = null;
  private preseleccionar(): void {
    if (this.seleccion) return;
    const variante = varianteDeTalla(this.variantes().filter(v => !this.colorSugerido || v.color === this.colorSugerido), this.tallaSugerida);
    if (variante) this.seleccion = variante.identificador;
  }
  elegida(): Variante | undefined { return this.variantes().find(v => v.identificador === this.seleccion); }
  async agregar(): Promise<void> {
    const producto = this.producto(), variante = this.elegida();
    if (!producto || !variante) return;
    try { await this.carrito.agregar(producto, variante, this.cantidad); this.mensajeCarrito.set("Variante guardada en tu carrito."); }
    catch (error) { this.mensajeCarrito.set(error instanceof Error ? error.message : "No se pudo guardar el carrito."); }
  }
  private async cargarVariantes(id: string): Promise<void> {
    const turno = ++this.consulta;
    if (this.productoVariantes !== id) { this.seleccion = ""; this.variantes.set([]); }
    this.productoVariantes = id; this.guardadas.set(true); this.avisoVariantes.set("");
    try {
      const locales = await this.estado.local.variantes(id);
      if (turno !== this.consulta) return;
      this.variantes.set(locales);
      this.preseleccionar();
      if (!locales.length) this.avisoVariantes.set(navigator.onLine ? "Consultando variantes en Inventario…" : "No hay variantes descargadas. Conéctate para consultar tallas, colores y existencias.");
      if (navigator.onLine) {
        const variantes = await this.remotoVariantes.variantes(id);
        if (turno !== this.consulta) return;
        await this.estado.local.guardarVariantes(id, variantes);
        this.variantes.set(variantes); this.guardadas.set(false); this.avisoVariantes.set("");
        if (!variantes.some(variante => variante.identificador === this.seleccion)) this.seleccion = "";
        this.preseleccionar();
      }
    } catch { this.avisoVariantes.set("No se pudieron consultar variantes actuales. Solo se muestran las descargadas."); }
  }
  constructor() {
    const ruta = inject(ActivatedRoute);
    effect(() => {
      this.estado.revisiónLocal();
      const producto = this.producto();
      if (producto) void this.cargarVariantes(producto.identificador);
    });
    ruta.queryParamMap.subscribe((consulta) => { this.tallaSugerida = consulta.get("talla"); this.colorSugerido = consulta.get("color"); });
    ruta.paramMap.subscribe((parámetros) => {
      this.producto.set(undefined);
      void this.estado
        .consultar(parámetros.get("identificador") ?? "")
        .then((producto) => {
          this.producto.set(producto);
          prepararProbador();
        })
        .catch(() =>
          this.error.set(
            "El producto no existe, no está activo o aún no fue descargado para usarlo sin conexión.",
          ),
        );
    });
  }
}
