import { Component, Input, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, JsonPipe } from "@angular/common";
import { EstadoExistencias } from "../aplicacion/estado-existencias";
import type { Variante } from "../dominio/modelos";
import type { Operacion } from "../../catalogo/dominio/modelos";

@Component({
  selector: "clb-panel-existencias",
  imports: [FormsModule, DatePipe, JsonPipe],
  template: `<section class="panel-existencias" aria-label="Variantes y existencias">
    <div class="titulo-administracion"><div><h2>Variantes y stock</h2></div><button class="botón-texto" (click)="nuevo()">Nueva variante</button></div>
    <p class="nota-local">SKU del producto: referencia comercial. Cada variante tiene su propio SKU. Los saldos descargados pueden cambiar.</p>
    @if (estado.error()) { <p class="aviso-error" role="alert">{{estado.error()}}</p> }
    @if (estado.mensaje()) { <p class="mensaje-administracion" role="status">{{estado.mensaje()}}</p> }
    <div class="rejilla-existencias">
      <section class="formulario-administracion">
        <h3>{{base ? 'Editar variante' : 'Registrar variante'}}</h3>
        @if (revision) { <p class="nota-local">Corrección explícita de {{revision}}. Se conservará la solicitud anterior.</p> }
        <form (ngSubmit)="guardarVariante()">
          <label>SKU de variante<input name="skuVariante" [(ngModel)]="datos.sku" required maxlength="64" /></label>
          <div class="campos-dobles"><label>Talla<input name="talla" [(ngModel)]="datos.talla" required maxlength="32" /></label><label>Color<input name="color" [(ngModel)]="datos.color" required maxlength="80" /></label></div>
          <label class="campo-activo"><input type="checkbox" name="varianteActiva" [(ngModel)]="datos.activo" />Variante activa</label>
          <button class="botón-principal" [disabled]="guardando()">Guardar variante</button>
        </form>
      </section>
      <section class="listado-administracion">
        <h3>Existencias confirmadas</h3>
        <div class="tabla-administracion"><table><thead><tr><th>Variante</th><th>Física</th><th>Reservada</th><th>Disponible</th><th>Mínimo</th><th>Acciones</th></tr></thead><tbody>
          @for (variante of estado.variantes(); track variante.identificador) {
            <tr [attr.data-variante]="variante.identificador"><td><strong>{{variante.talla}} / {{variante.color}}</strong><small>{{variante.sku}} · v{{variante['versión_sincronización']}} · {{variante.activo ? 'Activa' : 'Inactiva'}}</small>
              @if (variante.stock_bajo) { <span class="etiqueta-estado inactivo">Stock bajo</span> }
            </td><td>{{variante['física']}}</td><td>{{variante.reservada}}</td><td>{{variante.disponible}}</td><td>{{variante['mínimo']}}</td><td><button class="botón-texto" (click)="editar(variante)">Editar variante</button><button class="botón-texto" (click)="seleccionar(variante)">Gestionar stock</button></td></tr>
          } @empty { <tr><td colspan="6">Sin variantes confirmadas. No se han supuesto tallas, colores ni existencias.</td></tr> }
        </tbody></table></div>
        @for (op of creacionesPendientes(); track op.identificador) {
          <p class="propuesta-variante">Propuesta: {{op.datos['sku']}} · {{op.estado}} <button class="botón-texto" (click)="seleccionarPropuesta(op)">Preparar stock dependiente</button></p>
        }
      </section>
    </div>
    @if (seleccionada; as variante) {
      <section class="gestion-stock formulario-administracion">
        <h3>Gestionar stock · {{variante.sku}}</h3>
        @if (variante['versión_sincronización'] === 0) { <p class="nota-local">La variante aún es una propuesta. El movimiento esperará su creación confirmada.</p> }
        <form (ngSubmit)="guardarMovimiento()" class="formulario-stock">
          <label>Tipo de movimiento<select name="tipoMovimiento" [(ngModel)]="movimiento.tipo"><option>ENTRADA</option><option>SALIDA</option><option>AJUSTE</option></select></label>
          @if (movimiento.tipo === 'AJUSTE') { <label>Sentido del ajuste<select name="sentido" [(ngModel)]="movimiento.sentido"><option value="INCREMENTO">Incremento</option><option value="DISMINUCION">Disminución</option></select></label> }
          <label>Cantidad del movimiento<input type="number" min="1" step="1" name="cantidadMovimiento" [(ngModel)]="movimiento.cantidad" required /></label>
          <label>Motivo del movimiento<input name="motivo" [(ngModel)]="movimiento.motivo" required maxlength="500" /></label>
          <button class="botón-principal" [disabled]="guardando()">Guardar movimiento</button>
        </form>
        <form (ngSubmit)="guardarMinimo()" class="formulario-stock"><label>Stock mínimo<input name="minimo" type="number" min="0" step="1" [(ngModel)]="minimo" required /></label><button class="botón-secundario" [disabled]="guardando()">Guardar mínimo</button></form>
        <button class="botón-texto" (click)="estado.verHistorial(variante)">Consultar historial</button>
        <div class="tabla-administracion"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Operación</th></tr></thead><tbody>
        @for (fila of estado.historial(); track fila.identificador) { <tr><td>{{fila.fecha | date:'dd/MM/yyyy HH:mm'}}</td><td>{{fila.tipo}} {{fila.sentido}}</td><td>{{fila.cantidad}}</td><td>{{fila.motivo}}</td><td><small>{{fila.identificador_operacion}}</small></td></tr> }
        </tbody></table></div>
      </section>
    }
    <section class="operaciones-administracion"><h3>Propuestas de variantes y stock</h3>
    @for (op of estado.propuestas(); track op.identificador) {
      <article class="operacion-administrativa" [attr.data-operacion-stock]="op.identificador" [attr.data-estado]="op.estado"><strong>{{op.tipo}}</strong> <span class="etiqueta-estado">{{op.estado}}</span><small class="identificador-operacion">{{op.identificador}} · Intentos {{op.intentos}} · Versión {{op['versiónEsperada'] ?? 'pendiente de creación'}}</small>
        @if (op.dependencias?.length) { <p class="nota-local">Espera confirmación de: {{op.dependencias?.join(', ')}}</p> }
        @if (op.error) { <p class="error-campo">{{op.error}}</p> }
        <details><summary>Datos y respuesta del servidor</summary><pre>{{op.datos | json}} {{op.detalleError | json}}</pre></details>
        @if (op.reemplazadaPor) { <p>Corrección: {{op.reemplazadaPor}}</p> }
        @else if (op.estado === 'REQUIERE_REVISION') {
          @if (op.motivoRevision === 'REINTENTOS_AGOTADOS') { <button class="botón-secundario" (click)="estado.reintentar(op.identificador)">Reintentar misma operación</button> }
          @else { <button class="botón-secundario" [disabled]="guardando()" (click)="revisar(op)">Revisar conflicto de stock</button> }
        }
      </article>
    } @empty { <p class="nota-local">No hay propuestas de stock en este dispositivo.</p> }
    </section>
  </section>`,
})
export class PanelExistencias {
  readonly estado = inject(EstadoExistencias);
  @Input({ required: true }) set producto(id: string) { void this.estado.cargar(id); this.nuevo(); this.seleccionada = undefined; }
  base?: Variante;
  seleccionada?: Variante;
  revision?: string;
  tipoRevision?: string;
  identificadorRevision?: string;
  datos = { sku: "", talla: "", color: "", activo: true };
  movimiento = { tipo: "ENTRADA", cantidad: 1, motivo: "", sentido: "INCREMENTO" };
  minimo = 0;
  readonly guardando = signal(false);
  nuevo(): void { this.base = undefined; this.revision = undefined; this.tipoRevision = undefined; this.identificadorRevision = undefined; this.datos = { sku: "", talla: "", color: "", activo: true }; }
  editar(variante: Variante): void { this.nuevo(); this.base = variante; this.datos = { sku: variante.sku, talla: variante.talla, color: variante.color, activo: variante.activo }; }
  seleccionar(variante: Variante): void { this.revision = undefined; this.tipoRevision = undefined; this.seleccionada = variante; this.minimo = variante.mínimo; this.estado.historial.set([]); }
  creacionesPendientes(): Operacion[] { return this.estado.propuestas().filter(op => op.tipo === "CREAR_VARIANTE" && op.datos["identificador_producto"] === this.estado.producto() && ["PENDIENTE", "ENVIANDO", "ERROR_REINTENTABLE"].includes(op.estado)); }
  seleccionarPropuesta(op: Operacion): void {
    this.seleccionar({ identificador: String(op.datos["identificador"]), identificador_producto: this.estado.producto(), sku: String(op.datos["sku"]), talla: String(op.datos["talla"]), color: String(op.datos["color"]), activo: Boolean(op.datos["activo"]), física: 0, reservada: 0, disponible: 0, mínimo: 0, fecha_creación: op.fechaCreación, fecha_actualización: op.fechaCreación, versión_sincronización: 0 });
  }
  async guardarVariante(): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try { if (await this.estado.guardar(this.base ? "MODIFICAR_VARIANTE" : "CREAR_VARIANTE", { ...this.datos, ...(this.identificadorRevision ? { identificador: this.identificadorRevision } : {}) }, this.base, this.tipoRevision?.includes("VARIANTE") ? this.revision : undefined)) this.nuevo(); }
    finally { this.guardando.set(false); }
  }
  async guardarMovimiento(): Promise<void> {
    if (!this.seleccionada || this.guardando()) return;
    this.guardando.set(true);
    const { sentido, ...datos } = this.movimiento;
    try { await this.estado.guardar("REGISTRAR_MOVIMIENTO", { ...datos, ...(datos.tipo === "AJUSTE" ? { sentido } : {}) }, this.seleccionada, this.tipoRevision === "REGISTRAR_MOVIMIENTO" ? this.revision : undefined); await this.actualizarSeleccion(); }
    finally { this.guardando.set(false); }
  }
  async guardarMinimo(): Promise<void> {
    if (!this.seleccionada || this.guardando()) return;
    this.guardando.set(true);
    try { await this.estado.guardar("CONFIGURAR_MINIMO", { mínimo: this.minimo }, this.seleccionada, this.tipoRevision === "CONFIGURAR_MINIMO" ? this.revision : undefined); await this.actualizarSeleccion(); }
    finally { this.guardando.set(false); }
  }
  private async actualizarSeleccion(): Promise<void> {
    this.seleccionada = await this.estado.actualizarBase(this.seleccionada);
    this.revision = undefined; this.tipoRevision = undefined;
  }
  async revisar(op: Operacion): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      const base = await this.estado.revisar(op);
      if (op.tipo === "CREAR_VARIANTE" || op.tipo === "MODIFICAR_VARIANTE") {
        this.nuevo(); this.base = base;
        this.datos = { sku: String(op.datos["sku"]), talla: String(op.datos["talla"]), color: String(op.datos["color"]), activo: Boolean(op.datos["activo"]) };
      } else if (base) {
        this.seleccionar(base);
        if (op.tipo === "CONFIGURAR_MINIMO") this.minimo = Number(op.datos["mínimo"]);
        else this.movimiento = { tipo: String(op.datos["tipo"]), cantidad: Number(op.datos["cantidad"]), motivo: String(op.datos["motivo"]), sentido: String(op.datos["sentido"] ?? "INCREMENTO") };
      }
      this.revision = op.identificador; this.tipoRevision = op.tipo;
      if (op.tipo === "CREAR_VARIANTE") this.identificadorRevision = String(op.datos["identificador"]);
      this.estado.mensaje.set("Compara la propuesta con el estado actual y guarda explícitamente la corrección.");
    } catch (error) { this.estado.error.set(error instanceof Error ? error.message : "No se pudo revisar."); }
    finally { this.guardando.set(false); }
  }
}
