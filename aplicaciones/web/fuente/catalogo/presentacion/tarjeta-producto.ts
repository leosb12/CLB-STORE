import { Component, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { Producto } from "../dominio/modelos";
import { fotografiaPrenda } from "../dominio/imagen-prenda";
import {
  EstadoCatalogo,
  ilustraciónProducto,
  precioEnBob,
} from "../aplicacion/estado-catalogo";

@Component({
  selector: "clb-tarjeta-producto",
  imports: [RouterLink],
  template: ` <article class="tarjeta" data-testid="producto">
    <div class="imagen-producto">
      <a
        [routerLink]="['/productos', producto().identificador]"
        [attr.aria-label]="'Ver ' + producto().nombre"
      >
        <img
          [src]="estado.imagen(producto())"
          [alt]="(producto().recurso_probador || esFoto(producto().sku)) ? producto().nombre : 'Ilustración de referencia de la prenda'"
          width="420"
          height="460"
        />
      </a>
      <button
        class="botón-favorito"
        [class.seleccionado]="estado.favoritos().has(producto().identificador)"
        [attr.aria-pressed]="estado.favoritos().has(producto().identificador)"
        [attr.aria-label]="
          (estado.favoritos().has(producto().identificador)
            ? 'Quitar de favoritos: '
            : 'Guardar favorito: ') + producto().nombre
        "
        (click)="estado.alternarFavorito(producto().identificador)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"
          />
        </svg>
      </button>
      <span class="etiqueta-imagen">{{ (producto().recurso_probador || esFoto(producto().sku)) ? 'Fotografía' : 'Ilustración' }}</span>
    </div>
    <div class="datos-producto">
      <span class="categoría-producto">{{ producto()["categoría"] }}</span>
      <a [routerLink]="['/productos', producto().identificador]"
        ><h3>{{ producto().nombre }}</h3></a
      >
      <p class="precio">{{ precio(producto().precio) }}</p>
    </div>
  </article>`,
})
export class TarjetaProducto {
  readonly producto = input.required<Producto>();
  readonly estado = inject(EstadoCatalogo);
  readonly ilustración = ilustraciónProducto;
  readonly esFoto = fotografiaPrenda;
  readonly precio = precioEnBob;
}
