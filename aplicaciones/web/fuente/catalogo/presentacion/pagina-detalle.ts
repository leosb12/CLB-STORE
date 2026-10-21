import { Component, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Producto } from "../dominio/modelos";
import {
  EstadoCatalogo,
  ilustraciónProducto,
  precioEnBob,
} from "../aplicacion/estado-catalogo";

@Component({
  selector: "clb-pagina-detalle",
  imports: [RouterLink],
  template: ` <a class="volver" routerLink="/catalogo">← Volver al catálogo</a>
    @if (producto(); as prenda) {
      <article class="detalle">
        <div class="imagen-detalle">
          <img
            [src]="this['ilustración'](prenda['categoría'])"
            alt="Ilustración de referencia de la prenda"
            width="420"
            height="460"
          /><span>Ilustración de referencia</span>
        </div>
        <div class="información-detalle">
          <p class="antetítulo">{{ prenda["categoría"] }}</p>
          <h1>{{ prenda.nombre }}</h1>
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
  readonly precio = precioEnBob;
  constructor() {
    const ruta = inject(ActivatedRoute);
    ruta.paramMap.subscribe((parámetros) => {
      this.producto.set(undefined);
      void this.estado
        .consultar(parámetros.get("identificador") ?? "")
        .then((producto) => this.producto.set(producto))
        .catch(() =>
          this.error.set(
            "El producto no existe, no está activo o aún no fue descargado para usarlo sin conexión.",
          ),
        );
    });
  }
}
