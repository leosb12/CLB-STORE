import { Component, computed, inject } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Operacion } from "../../catalogo/dominio/modelos";
import { centavos, importe, type LineaCarrito } from "../../existencias/dominio/modelos";
import { EstadoPedidos } from "../aplicacion/estado-pedidos";
import { fusionarHistorial, type PedidoVenta } from "../dominio/modelos";

type Tono = "ok" | "espera" | "alerta";

interface LineaVista { nombre: string; detalle: string; cantidad: number; importe: string }

// La vista usa nombres ASCII: el lexer de plantillas de Angular no admite tildes en accesos de propiedad.
interface VistaPedido {
  id: string;
  accion: "recuperar" | "reintentar" | null;
  comprobante: "listo" | "generando" | null;
  codigo: string;
  fecha: string;
  etiqueta: string;
  tono: Tono;
  explicacion: string;
  total: string;
  prendas: number;
  lineas: LineaVista[];
  pasos: { paso: string; resultado: string; detalle: string | null; fecha: string }[];
}

const MOTIVOS: Record<string, string> = {
  STOCK_INSUFICIENTE: "No había unidades suficientes. No se reservó ni se cobró nada.",
  RESERVA_RECHAZADA: "Inventario rechazó la reserva. No se reservó ni se cobró nada.",
  CLIENTES_NO_DISPONIBLE: "El servicio de puntos no respondió: se liberó la reserva y se anuló el pedido.",
  FIDELIZACION_RECHAZADA: "El servicio de puntos rechazó el pedido: se liberó la reserva.",
  RESERVA_NO_CONSUMIBLE: "La reserva ya no estaba disponible: se liberaron unidades y se revirtieron los puntos.",
  INVENTARIO_NO_DISPONIBLE: "Inventario no responde. Ventas reintentará automáticamente.",
  CONFIRMACION_PENDIENTE: "Puntos acreditados; falta que Inventario confirme el descuento. Ventas reintentará automáticamente.",
};

const PASOS: Record<string, string> = {
  RESERVAR: "Reserva de stock", ACREDITAR: "Puntos de fidelización", CONSUMIR: "Descuento de stock",
  COMPENSAR_RESERVA: "Liberación de la reserva", COMPENSAR_PUNTOS: "Reversa de puntos", TERMINADA: "Fin",
};

const RESULTADOS: Record<string, string> = {
  INICIADA: "Estado PENDIENTE", OK: "Hecho", FALLO: "Falló", NO_DISPONIBLE: "Sin respuesta, se reintentará",
  RECHAZADO: "Rechazado", SIN_EFECTO: "Sin efecto",
};

@Component({
  selector: "clb-pagina-pedidos", imports: [DatePipe, RouterLink],
  template: `<section class="pagina-pedidos">
    <div class="encabezado-pedidos"><h1>Mis pedidos</h1>
      <button class="botón-secundario" (click)="estado.actualizar()" [disabled]="estado.actualizando()">{{ estado.actualizando() ? "Actualizando…" : "Actualizar estado" }}</button></div>
    <p class="aviso-favoritos">Pedidos de tu cuenta en todos tus dispositivos y pendientes de envío de este navegador. Uno pendiente de envío aún no es una compra: se envía cuando vuelve la conexión, sin duplicarse.</p>
    @if (estado.fechaHistorial()) {
      <p>{{ estado.historialGuardado() ? 'Último historial guardado' : 'Historial actualizado' }}: {{ estado.fechaHistorial() | date: 'dd/MM/yyyy HH:mm' }}</p>
    } @else { <p>Aún no hay una copia del historial de la tienda.</p> }
    @if (estado.error()) { <p class="aviso-error" role="alert">{{ estado.error() }}</p> }
    <ol class="lista-pedidos">
      @for (vista of vistas(); track vista.id) {
        <li class="pedido" [class.reciente]="vista.id === nuevo" [attr.data-pedido]="vista.id">
          <div class="cabecera-pedido">
            <div><h2>Pedido {{ vista.codigo }}</h2><p>{{ vista.fecha | date: "dd/MM/yyyy HH:mm" }} · {{ vista.prendas }} {{ vista.prendas === 1 ? "prenda" : "prendas" }}</p></div>
            <strong class="total-pedido">{{ vista.total }}</strong>
            <span class="etiqueta-estado" [attr.data-tono]="vista.tono" data-estado-pedido>{{ vista.etiqueta }}</span>
          </div>
          <p class="explicación-pedido">{{ vista.explicacion }}</p>
          @if (vista.accion === "recuperar") {
            <button class="botón-secundario acción-pedido" (click)="estado.recuperarEnCarrito(vista.id)">Devolver prendas al carrito</button>
          } @else if (vista.accion === "reintentar") {
            <button class="botón-secundario acción-pedido" (click)="estado.reintentar(vista.id)">Reintentar el mismo pedido</button>
          }
          @if (vista.comprobante === "listo") {
            <button class="botón-secundario acción-pedido" (click)="estado.descargarComprobante(vista.id)">Descargar comprobante (Excel)</button>
          } @else if (vista.comprobante === "generando") {
            <p class="nota-local" data-comprobante-pendiente>El comprobante de venta se está generando. Pulsa «Actualizar estado» en unos segundos.</p>
          }
          <details class="detalle-pedido"><summary>Ver prendas y pasos de la compra</summary>
            <ul class="lineas-pedido">
              @for (linea of vista.lineas; track $index) { <li><span>{{ linea.nombre }} <small>{{ linea.detalle }}</small></span><span>{{ linea.cantidad }} × {{ linea.importe }}</span></li> }
            </ul>
            @if (vista.pasos.length) {
              <h3>Pasos de la compra</h3>
              <ol class="pasos-saga">
                @for (paso of vista.pasos; track $index) {
                  <li [attr.data-resultado]="paso.resultado"><strong>{{ paso.paso }}</strong> · {{ paso.resultado }}<time>{{ paso.fecha | date: "dd/MM HH:mm:ss" }}</time></li>
                }
              </ol>
            }
          </details>
        </li>
      } @empty {
        <li class="estado-vacío"><h2>Aún no hay pedidos</h2><p>Confirma tu carrito para crear uno. Funciona también sin conexión.</p><a class="botón-principal" routerLink="/catalogo">Ir al catálogo</a></li>
      }
    </ol>
  </section>`,
})
export class PaginaPedidos {
  readonly estado = inject(EstadoPedidos);
  readonly nuevo = inject(ActivatedRoute).snapshot.queryParamMap.get("nuevo");
  // Las vistas se recalculan solo cuando cambian los pedidos, no en cada detección de cambios.
  readonly vistas = computed(() => {
    return fusionarHistorial(this.estado.pedidos(), this.estado.historial())
      .map(e => this.describir(e.operacion, e.pedido)).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  });

  constructor() {
    void this.estado.cargar().then(() => this.estado.actualizar());
  }

  describir(operación?: Operacion, remoto?: PedidoVenta): VistaPedido {
    const pedido = remoto ?? operación?.resultadoPedido;
    const carrito = (operación?.datos["carrito"] ?? []) as LineaCarrito[];
    const identificador = pedido?.identificador ?? operación!.identificador;
    const líneas: LineaVista[] = pedido
      ? pedido.líneas.map(l => ({ nombre: l.nombre, detalle: `${l.talla} / ${l.color}`, cantidad: l.cantidad, importe: importe(centavos(l.precio)) }))
      : carrito.map(l => ({ nombre: l.nombre, detalle: `${l.talla} / ${l.color}`, cantidad: l.cantidad, importe: importe(l.precioCentavos) }));
    const estimado = carrito.reduce((total, l) => total + BigInt(l.precioCentavos) * BigInt(l.cantidad), 0n);
    const base = {
      id: identificador, accion: null,
      comprobante: (pedido?.estado === "CONFIRMADO" ? (pedido.comprobante_disponible ? "listo" : "generando") : null) as VistaPedido["comprobante"],
      codigo: identificador.slice(0, 8).toUpperCase(), fecha: pedido?.fecha_creación ?? operación!.fechaCreación, lineas: líneas,
      prendas: líneas.reduce((total, l) => total + l.cantidad, 0),
      total: pedido ? importe(centavos(pedido.total)) : `${importe(estimado)} estimado`,
      pasos: (pedido?.saga?.historial ?? []).map(p => ({
        // El registro inicial marca la creación del pedido, no el resultado de la reserva.
        paso: p.resultado === "INICIADA" ? "Pedido recibido por Ventas" : PASOS[p.paso] ?? p.paso,
        resultado: RESULTADOS[p.resultado] ?? p.resultado, detalle: p.detalle, fecha: p.fecha,
      })),
    };
    if (pedido) {
      if (pedido.estado === "CONFIRMADO") return { ...base, etiqueta: "Confirmado", tono: "ok", explicacion: "Stock descontado y puntos acreditados." };
      if (pedido.estado === "CANCELADO") return { ...base, etiqueta: "Cancelado", tono: "alerta", explicacion: MOTIVOS[pedido.motivo ?? ""] ?? "El pedido se anuló sin cobros." };
      if (pedido.estado === "EN_REVISION") return { ...base, etiqueta: "En revisión", tono: "espera", explicacion: MOTIVOS[pedido.motivo ?? ""] ?? "Ventas reintentará automáticamente." };
      return { ...base, etiqueta: "Procesando", tono: "espera", explicacion: "Ventas está coordinando la reserva y los puntos." };
    }
    if (!operación) throw new Error("Faltan datos del pedido.");
    switch (operación.estado) {
      case "ENVIANDO": return { ...base, etiqueta: "Enviando", tono: "espera", explicacion: "Enviando el pedido a Ventas." };
      case "ERROR_REINTENTABLE": return { ...base, etiqueta: "Reintentando", tono: "espera", explicacion: `${operación.error ?? "Sin respuesta."} Se reintentará con la misma clave, sin duplicar el pedido.` };
      case "REQUIERE_REVISION":
        if (operación.reemplazadaPor === "CARRITO")
          return { ...base, etiqueta: "Devuelto al carrito", tono: "alerta", explicacion: "Las prendas volvieron a tu carrito para corregir y confirmar de nuevo." };
        // Rechazo permanente: se puede corregir desde el carrito. Confirmación incierta: se reintenta la misma operación.
        return operación.motivoRevision === "REINTENTOS_AGOTADOS"
          ? { ...base, accion: "reintentar", etiqueta: "Sin confirmar", tono: "alerta", explicacion: "No sabemos si Ventas recibió el pedido. Reintentarlo no lo duplica." }
          : { ...base, accion: "recuperar", etiqueta: "Requiere revisión", tono: "alerta", explicacion: operación.error ?? "Ventas rechazó el pedido." };
      default: return { ...base, etiqueta: "Pendiente de envío", tono: "espera", explicacion: "Guardado en este dispositivo. Aún no es una compra: se enviará al recuperar la conexión." };
    }
  }
}
