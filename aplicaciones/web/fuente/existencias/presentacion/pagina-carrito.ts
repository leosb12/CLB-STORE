import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import { EstadoPedidos } from "../../pedidos/aplicacion/estado-pedidos";
import { EstadoSesion } from "../../sesion/aplicacion/estado-sesion";
import { EstadoCarrito } from "../aplicacion/estado-carrito";
import { importe, totalCarrito } from "../dominio/modelos";

@Component({
  selector: "clb-pagina-carrito", imports: [FormsModule, RouterLink],
  template: `<section class="pagina-carrito"><h1>Carrito</h1>
  <p class="aviso-favoritos">Precio y stock son referenciales hasta que confirmes: Ventas fija el precio final y reserva las unidades al recibir el pedido. No hay pagos en línea.</p>
  @if (estado.error() || errorPedido()) { <p class="aviso-error" role="alert">{{estado.error() || errorPedido()}}</p> }
  <div class="rejilla-carrito"><div>
    @for (linea of estado['líneas'](); track linea.identificador) {
      <article class="linea-carrito" [attr.data-carrito]="linea.identificador"><div><a [routerLink]="['/productos',linea.identificadorProducto]"><h2>{{linea.nombre}}</h2></a><p>{{linea.talla}} / {{linea.color}}</p><small>{{linea.sku}}</small><p>{{importe(linea.precioCentavos)}} por unidad · referencia guardada</p></div>
      <div><label>Cantidad de {{linea.sku}}<input type="number" min="1" step="1" [ngModel]="linea.cantidad" (ngModelChange)="estado.cantidad(linea.identificador, $event)" /></label><strong>{{importe(subtotal(linea.precioCentavos, linea.cantidad))}}</strong><button class="botón-texto" (click)="estado.quitar(linea.identificador)">Eliminar {{linea.sku}}</button></div></article>
    } @empty { <p class="estado-vacío">Tu carrito está vacío. Elige talla y color desde una prenda.</p> }
    <a class="botón-texto" routerLink="/catalogo">← Seguir explorando</a>
  </div><aside class="resumen-carrito"><h2>Resumen estimado</h2><p>{{estado['líneas']().length}} variantes</p><strong class="precio-detalle" data-total-carrito>{{importe(total(estado['líneas']()))}}</strong><p>Bolivianos · BOB</p>
    @if (sesion.titular()) {
      <button class="botón-principal confirmar-pedido" data-confirmar-pedido [disabled]="!estado['líneas']().length || confirmando()" (click)="confirmar()">{{ confirmando() ? "Guardando pedido…" : "Confirmar pedido" }}</button>
      <p class="nota-envío" [class.sin-conexión]="!conectado()" role="status">@if (conectado()) { Ventas recalculará el precio y reservará el stock al recibirlo. } @else { Sin conexión: el pedido se guardará como pendiente y se enviará al reconectar. Aún no es una compra. }</p>
    } @else {
      <button class="botón-principal confirmar-pedido" [disabled]="!conectado()" (click)="sesion.iniciar('/carrito')">Inicia sesión para confirmar</button>
      <p class="nota-envío" role="status">El pedido queda a tu nombre: una sola cuenta para la tienda, tus pedidos y la app móvil. Tu carrito se conserva.</p>
    }
    <p class="nota-local">Puedes editar tu selección sin conexión. Se conserva al cerrar el navegador.</p><button class="botón-secundario" [disabled]="!estado['líneas']().length || confirmando()" (click)="estado.vaciar()">Vaciar carrito</button></aside></div></section>`,
})
export class PaginaCarrito {
  readonly estado = inject(EstadoCarrito);
  private readonly pedidos = inject(EstadoPedidos);
  readonly sesion = inject(EstadoSesion);
  private readonly router = inject(Router);
  readonly conectado = inject(EstadoCatalogo).conexión;
  readonly confirmando = signal(false);
  readonly errorPedido = signal("");
  readonly importe = importe;
  readonly total = totalCarrito;
  subtotal(precio: number, cantidad: number): bigint { return BigInt(precio) * BigInt(cantidad); }
  constructor() { void this.estado.cargar(); }

  async confirmar(): Promise<void> {
    this.confirmando.set(true);
    this.errorPedido.set("");
    try {
      const pedido = await this.pedidos.confirmar();
      await this.estado.cargar();
      await this.router.navigate(["/pedidos"], { queryParams: { nuevo: pedido.identificador } });
    } catch (error) {
      this.errorPedido.set(error instanceof Error ? error.message : "No se pudo guardar el pedido. Tu carrito sigue intacto.");
    } finally {
      this.confirmando.set(false);
    }
  }
}
