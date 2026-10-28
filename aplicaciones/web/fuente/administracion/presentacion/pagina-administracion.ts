import { PanelFotografia } from "./panel-fotografia";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DatePipe, JsonPipe } from "@angular/common";
import { EstadoAdministracion } from "../aplicacion/estado-administracion";
import {
  datosDeProducto,
  type DatosProducto,
} from "../dominio/productos-administrativos";
import type { Operacion, Producto } from "../../catalogo/dominio/modelos";
import { precioEnBob } from "../../catalogo/aplicacion/estado-catalogo";
import { PanelExistencias } from "../../existencias/presentacion/panel-existencias";

@Component({
  selector: "clb-pagina-administracion",
  imports: [FormsModule, DatePipe, JsonPipe, PanelExistencias, PanelFotografia],
  template: ` <section
    class="administracion"
    aria-labelledby="titulo-administracion"
  >
    <div class="aviso-administracion" role="note">
      <strong>PANEL DE ADMINISTRACIÓN · ROL ADMIN</strong>
      <p>
        Sesión única con Keycloak: cada operación se envía con tu token y
        Inventario verifica el rol de administrador antes de aplicarla.
      </p>
    </div>
    <div class="titulo-administracion">
      <div>
        <h1 id="titulo-administracion">Administración de productos</h1>
      </div>
      <button class="botón-secundario" (click)="nuevo()">Nuevo producto</button>
    </div>
    @if (estado.error() || estado["catálogo"].errorAdministracion()) {
      <p class="aviso-error" role="alert">
        {{ estado.error() || estado["catálogo"].errorAdministracion() }}
      </p>
    }
    @if (estado.mensaje()) {
      <p class="mensaje-administracion" role="status">{{ estado.mensaje() }}</p>
    }
    <div class="panel-administracion">
      <section
        class="formulario-administracion"
        aria-labelledby="titulo-formulario"
      >
        <h2 id="titulo-formulario">
          {{ base ? "Editar producto" : "Registrar producto" }}
        </h2>
        @if (base) {
          <p class="nota-local">
            Versión esperada {{ base["versión_sincronización"] }} ·
            {{ base.sku }}
          </p>
        }
        @if (revision) {
          <p class="aviso-favoritos">
            Revisión de {{ revision }}. Al guardar se prepara una nueva
            operación; no se reescribe la anterior.
          </p>
        }
        <form (ngSubmit)="guardar()" novalidate>
          <label
            >SKU<input
              name="sku"
              [(ngModel)]="datos.sku"
              maxlength="64"
              autocomplete="off"
              [attr.aria-invalid]="!!estado.errores()['sku']"
          /></label>
          @if (estado.errores()["sku"]) {
            <small class="error-campo">{{ estado.errores()["sku"] }}</small>
          }
          <label
            >Nombre<input
              name="nombre"
              [(ngModel)]="datos.nombre"
              maxlength="160"
              [attr.aria-invalid]="!!estado.errores()['nombre']"
          /></label>
          @if (estado.errores()["nombre"]) {
            <small class="error-campo">{{ estado.errores()["nombre"] }}</small>
          }
          <label
            >Descripción<textarea
              name="descripcion"
              [(ngModel)]="datos['descripción']"
              rows="3"
              maxlength="10000"
            ></textarea>
          </label>
          @if (estado.errores()["descripción"]) {
            <small class="error-campo">{{
              estado.errores()["descripción"]
            }}</small>
          }
          <div class="campos-dobles">
            <div class="campo-categoria">
              <label for="categoria-producto">Categoría</label>
              <select id="categoria-producto"
                name="categoria"
                [(ngModel)]="datos['categoría']"
                required
                [attr.aria-invalid]="!!estado.errores()['categoría']"
                aria-describedby="ayuda-categoria error-categoria"
              >
                <option value="" disabled>Selecciona una categoría</option>
                @for (categoria of categorias; track categoria) {
                  <option [value]="categoria">{{ categoria }}</option>
                }
              </select>
              <small id="ayuda-categoria" class="nota-local">Elige el tipo de prenda.</small>
              @if (estado.errores()["categoría"]) {
                <small id="error-categoria" class="error-campo" role="alert">{{ estado.errores()["categoría"] }}</small>
              }
            </div>
            <label
              >Precio en BOB<input
                name="precio"
                [(ngModel)]="datos.precio"
                type="text"
                inputmode="decimal"
                placeholder="129.90"
                [attr.aria-invalid]="!!estado.errores()['precio']"
            /></label>
          </div>
          @if (estado.errores()["precio"]) {
            <small class="error-campo">{{ estado.errores()["precio"] }}</small>
          }
          <label class="campo-activo"
            ><input
              type="checkbox"
              name="activo"
              [(ngModel)]="datos.activo"
            />Producto activo en el catálogo público</label
          >
          <p class="nota-local">
            Guardar prepara una propuesta persistente. El catálogo cambia
            únicamente cuando el servidor confirma.
          </p>
          <div class="acciones-formulario">
            <button
              class="botón-principal"
              type="submit"
              [disabled]="estado.guardando()"
            >
              {{ estado.guardando() ? "Guardando…" : "Guardar propuesta" }}
            </button>
            <button type="button" class="botón-texto" (click)="nuevo()">
              Limpiar
            </button>
          </div>
        </form>
      </section>
      <section
        class="listado-administracion"
        aria-labelledby="titulo-confirmados"
      >
        <h2 id="titulo-confirmados">
          Productos confirmados
          <span class="cantidad">{{ estado.productos().length }}</span>
        </h2>
        <p class="nota-local">
          Incluye activos e inactivos descargados del servidor.
        </p>
        <div class="tabla-administracion">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (
                producto of estado.productos();
                track producto.identificador
              ) {
                <tr [attr.data-producto]="producto.identificador">
                  <td>
                    <strong>{{ producto.nombre }}</strong
                    ><small
                      >{{ producto.sku }} · {{ producto["categoría"] }} · v{{
                        producto["versión_sincronización"]
                      }}</small
                    >
                  </td>
                  <td>{{ precio(producto.precio) }}</td>
                  <td>
                    <span
                      class="etiqueta-estado"
                      [class.inactivo]="!producto.activo"
                      >{{ producto.activo ? "Activo" : "Inactivo" }}</span
                    >
                  </td>
                  <td>
                    <button
                      class="botón-texto"
                      (click)="editar(producto)"
                      [attr.aria-label]="'Editar ' + producto.nombre"
                    >
                      Editar
                    </button>
                    <button class="botón-texto" (click)="productoVariantes = producto.identificador" [attr.aria-label]="'Variantes y stock de ' + producto.nombre">Variantes y stock</button>
                    <button
                      class="botón-texto"
                      (click)="alternar(producto)"
                      [disabled]="estado.guardando()"
                      [attr.aria-label]="
                        (producto.activo ? 'Desactivar ' : 'Activar ') +
                        producto.nombre
                      "
                    >
                      {{ producto.activo ? "Desactivar" : "Activar" }}
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4">
                    Aún no hay productos administrativos descargados. Conecta
                    con Inventario y sincroniza.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
    @if (base) { <clb-panel-fotografia [producto]="base" (publicado)="fotografiaPublicada()" /> }
    @if (productoVariantes) { <clb-panel-existencias [producto]="productoVariantes" /> }
    <section
      class="operaciones-administracion"
      aria-labelledby="titulo-operaciones"
    >
      <h2 id="titulo-operaciones">Operaciones del dispositivo</h2>
      <p class="nota-local">
        Las pendientes no son cambios confirmados. Los conflictos se conservan
        para revisión explícita.
      </p>
      @for (operacion of estado.operaciones(); track operacion.identificador) {
        <article
          class="operacion-administrativa"
          [attr.data-operacion]="operacion.identificador"
          [attr.data-estado]="operacion.estado"
        >
          <div class="encabezado-operacion">
            <strong
              >{{
                operacion.tipo === "REGISTRAR_PRODUCTO"
                  ? "Registrar"
                  : "Modificar"
              }}
              · {{ operacion.datos["nombre"] }}</strong
            ><span
              class="etiqueta-estado"
              [class.inactivo]="operacion.estado !== 'CONFIRMADA'"
              >{{ operacion.estado }}</span
            >
          </div>
          <p>
            {{ operacion["fechaCreación"] | date: "dd/MM/yyyy HH:mm" }} ·
            Intentos: {{ operacion.intentos }} · Versión esperada:
            {{ operacion["versiónEsperada"] ?? "producto nuevo" }}
          </p>
          <small class="identificador-operacion"
            >UUID: {{ operacion.identificador }}</small
          >
          @if (operacion.estado === "ERROR_REINTENTABLE") {
            <p>
              Próximo intento:
              {{ operacion["próximoIntento"] | date: "dd/MM/yyyy HH:mm:ss" }}
            </p>
          }
          @if (operacion.error) {
            <p class="error-campo">{{ operacion.error }}</p>
          }
          @if (operacion.detalleError) {
            <details>
              <summary>Respuesta del servidor y versión actual</summary>
              <pre>{{ operacion.detalleError | json }}</pre>
            </details>
          }
          <details>
            <summary>Revisar datos propuestos</summary>
            <pre>{{ operacion.datos | json }}</pre>
          </details>
          @if (operacion.reemplazadaPor) {
            <p>
              Nueva propuesta: {{ operacion.reemplazadaPor }}. Esta operación
              permanece en revisión como antecedente.
            </p>
          } @else if (
            operacion.estado === "REQUIERE_REVISION" &&
            operacion.motivoRevision === "REINTENTOS_AGOTADOS"
          ) {
            <p>
              Confirmación incierta. Conserva la misma solicitud para consultar
              su resultado sin duplicar el cambio.
            </p>
            <button
              class="botón-secundario"
              (click)="estado.reintentar(operacion.identificador)"
            >
              Reintentar misma operación
            </button>
          } @else if (operacion.estado === "REQUIERE_REVISION") {
            <button class="botón-secundario" (click)="revisar(operacion)">
              Preparar corrección
            </button>
          }
        </article>
      } @empty {
        <p class="estado-vacío">
          No hay operaciones administrativas en este dispositivo.
        </p>
      }
    </section>
  </section>`,
})
export class PaginaAdministracion {
  readonly estado = inject(EstadoAdministracion);
  readonly precio = precioEnBob;
  datos: DatosProducto = datosDeProducto();
  base?: Producto;
  revision?: string;
  productoVariantes = "";
  get categorias(): string[] {
    return [...new Set([
      "Poleras", "Camisas", "Chaquetas", "Abrigos", "Buzos", "Suéteres", "Pantalones", "Shorts", "Faldas", "Vestidos",
      ...this.estado.productos().map(producto => producto.categoría),
      this.datos.categoría,
    ].filter(categoria => categoria.trim()))].sort((a, b) => a.localeCompare(b, "es"));
  }
  constructor() {
    void this.estado.iniciar();
  }
  nuevo(): void {
    this.base = undefined;
    this.revision = undefined;
    this.datos = datosDeProducto();
    this.estado.errores.set({});
  }
  async fotografiaPublicada(): Promise<void> {
    const id = this.base?.identificador;
    await this.estado.catalogoFotograficoPublicado();
    this.base = this.estado.productos().find(p => p.identificador === id);
  }

  editar(producto: Producto): void {
    this.base = producto;
    this.revision = undefined;
    this.datos = datosDeProducto(producto);
    this.estado.errores.set({});
  }
  async guardar(): Promise<void> {
    if (
      this.base?.activo &&
      !this.datos.activo &&
      !window.confirm(
        "¿Desactivar este producto? Dejará de mostrarse en el catálogo público cuando el servidor confirme.",
      )
    )
      return;
    if (await this.estado.guardar(this.datos, this.base, this.revision))
      this.nuevo();
  }
  async alternar(producto: Producto): Promise<void> {
    if (
      producto.activo &&
      !window.confirm(
        "¿Desactivar " +
          producto.nombre +
          "? El cambio se aplicará cuando el servidor confirme.",
      )
    )
      return;
    await this.estado.alternarEstado(producto);
  }
  async revisar(operación: Operacion): Promise<void> {
    try {
      const revisión = await this.estado.revisar(operación);
      this.datos = revisión.datos;
      this.base = revisión.base;
      this.revision = operación.identificador;
      this.estado.errores.set({});
    } catch (error) {
      this.estado.error.set(
        error instanceof Error
          ? error.message
          : "No se pudo preparar la revisión.",
      );
    }
  }
}
