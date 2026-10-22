import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { EstadoCarrito } from "../aplicacion/estado-carrito";
import { importe, totalCarrito } from "../dominio/modelos";

@Component({
  selector: "clb-pagina-carrito", imports: [FormsModule, RouterLink],
  template: `<section class="pagina-carrito"><p class="antetítulo">TU SELECCIÓN · EN ESTE DISPOSITIVO</p><h1>Carrito</h1>
  <p class="aviso-favoritos">Precio y stock referenciales hasta la confirmación del servidor. Este carrito no reserva unidades ni genera pedidos o pagos.</p>
  @if (estado.error()) { <p class="aviso-error" role="alert">{{estado.error()}}</p> }
  <div class="rejilla-carrito"><div>
    @for (linea of estado['líneas'](); track linea.identificador) {
      <article class="linea-carrito" [attr.data-carrito]="linea.identificador"><div><a [routerLink]="['/productos',linea.identificadorProducto]"><h2>{{linea.nombre}}</h2></a><p>{{linea.talla}} / {{linea.color}}</p><small>{{linea.sku}}</small><p>{{importe(linea.precioCentavos)}} por unidad · referencia guardada</p></div>
      <div><label>Cantidad de {{linea.sku}}<input type="number" min="1" step="1" [ngModel]="linea.cantidad" (ngModelChange)="estado.cantidad(linea.identificador, $event)" /></label><strong>{{importe(subtotal(linea.precioCentavos, linea.cantidad))}}</strong><button class="botón-texto" (click)="estado.quitar(linea.identificador)">Eliminar {{linea.sku}}</button></div></article>
    } @empty { <p class="estado-vacío">Tu carrito está vacío. Elige talla y color desde una prenda.</p> }
    <a class="botón-texto" routerLink="/catalogo">← Seguir explorando</a>
  </div><aside class="resumen-carrito"><h2>Resumen estimado</h2><p>{{estado['líneas']().length}} variantes</p><strong class="precio-detalle" data-total-carrito>{{importe(total(estado['líneas']()))}}</strong><p>Bolivianos · BOB</p><p class="nota-local">Puedes editar tu selección sin conexión. Se conserva al cerrar el navegador.</p><button class="botón-secundario" [disabled]="!estado['líneas']().length" (click)="estado.vaciar()">Vaciar carrito</button></aside></div></section>`,
})
export class PaginaCarrito {
  readonly estado = inject(EstadoCarrito);
  readonly importe = importe;
  readonly total = totalCarrito;
  subtotal(precio: number, cantidad: number): bigint { return BigInt(precio) * BigInt(cantidad); }
  constructor() { void this.estado.cargar(); }
}
