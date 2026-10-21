import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { EstadoCatalogo } from "../aplicacion/estado-catalogo";
import { TarjetaProducto } from "./tarjeta-producto";

@Component({
  selector: "clb-pagina-catalogo",
  imports: [FormsModule, TarjetaProducto],
  template: ` @if (!soloFavoritos) {
      <section class="portada" aria-labelledby="titulo-portada">
        <div>
          <p class="antetítulo">LO ESENCIAL, A TU MANERA</p>
          <h1 id="titulo-portada">Prendas para<br />vivir tus días.</h1>
          <p>
            Diseños que van contigo. Descubre tu próximo<br
              class="solo-escritorio"
            />
            favorito y llévalo siempre a mano.
          </p>
          <a class="botón-principal" href="#coleccion"
            >Explorar la colección <span aria-hidden="true">↗</span></a
          >
          <span class="nota-portada"
            ><span aria-hidden="true">◉</span> Tu catálogo, también sin
            conexión</span
          >
        </div>
        <div class="arte-portada" aria-hidden="true">
          <span class="círculo-portada"></span>
          <img
            class="prenda-portada"
            src="/ilustraciones/camisa.svg"
            alt=""
            width="420"
            height="460"
          />
          <span class="sello-portada">CLB<br /><small>ESENCIALES</small></span>
          <span class="texto-portada">MENOS RUIDO. MÁS ESTILO.</span>
        </div>
      </section>
    }
    <section id="coleccion" class="colección" aria-labelledby="titulo-catalogo">
      <div class="encabezado-colección">
        <div>
          <p class="antetítulo">
            {{
              soloFavoritos ? "TU SELECCIÓN PERSONAL" : "ENCUENTRA TU ESTILO"
            }}
          </p>
          <h2 id="titulo-catalogo">
            {{ soloFavoritos ? "Tus favoritos" : "Nuestro catálogo"
            }}<span class="cantidad">{{ filtrados().length }}</span>
          </h2>
        </div>
        <p class="nota-local">
          Guardado en este dispositivo <span aria-hidden="true">↙</span>
        </p>
      </div>
      <div class="herramientas-catálogo">
        <label class="buscador"
          ><svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <input
            type="search"
            placeholder="Busca una prenda…"
            aria-label="Buscar por nombre"
            [ngModel]="this['búsqueda']()"
            (ngModelChange)="buscar($event)"
          />
        </label>
        <label class="selector-categoría"
          >Categoría
          <select
            aria-label="Filtrar por categoría"
            [ngModel]="this['categoría']()"
            (ngModelChange)="filtrar($event)"
          >
            <option value="">Todas las categorías</option>
            @for (nombre of estado["categorías"](); track nombre) {
              <option [value]="nombre">{{ nombre }}</option>
            }
          </select>
        </label>
      </div>
      <div class="resumen-catálogo">
        <p>
          {{ filtrados().length }} prendas
          {{
            this["búsqueda"]() || this["categoría"]()
              ? "en tu búsqueda"
              : "para descubrir"
          }}
        </p>
        <span>Nombre · A — Z</span>
      </div>
      @if (estado.cargando() && !estado.productos().length) {
        <div class="estado-vacío" role="status">Preparando tu catálogo…</div>
      } @else if (!filtrados().length) {
        <div class="estado-vacío">
          <span aria-hidden="true">♡</span>
          <h3>
            {{
              soloFavoritos
                ? "Aquí empieza tu selección"
                : "Aún no hay prendas para mostrar"
            }}
          </h3>
          <p>
            {{
              soloFavoritos
                ? "Toca el corazón de una prenda para guardarla. Tus favoritos funcionan sin conexión."
                : "Prueba otra búsqueda o sincroniza el catálogo cuando Inventario esté disponible."
            }}
          </p>
          <button class="botón-secundario" (click)="limpiar()">
            Limpiar filtros
          </button>
        </div>
      } @else {
        <div class="rejilla-productos">
          @for (producto of visibles(); track producto.identificador) {
            <clb-tarjeta-producto [producto]="producto" />
          }
        </div>
        @if (this["páginas"]() > 1) {
          <nav class="paginación" aria-label="Paginación del catálogo">
            <button
              (click)="this['página'].set(this['página']() - 1)"
              [disabled]="this['página']() === 1"
            >
              ← Anterior
            </button>
            <span
              >Página {{ this["página"]() }} de {{ this["páginas"]() }}</span
            >
            <button
              (click)="this['página'].set(this['página']() + 1)"
              [disabled]="this['página']() >= this['páginas']()"
            >
              Siguiente →
            </button>
          </nav>
        }
      }
      @if (soloFavoritos && estado.pendientes()) {
        <p class="aviso-favoritos">
          Tus cambios están guardados aquí. La sincronización remota de
          favoritos aún no está disponible.
        </p>
      }
    </section>`,
})
export class PaginaCatalogo {
  readonly estado = inject(EstadoCatalogo);
  readonly soloFavoritos =
    inject(ActivatedRoute).snapshot.data["favoritos"] === true;
  readonly búsqueda = signal("");
  readonly categoría = signal("");
  readonly página = signal(1);
  readonly filtrados = computed(() =>
    this.estado
      .productos()
      .filter(
        (producto) =>
          (!this.soloFavoritos ||
            this.estado.favoritos().has(producto.identificador)) &&
          producto.nombre
            .toLocaleLowerCase("es")
            .includes(this.búsqueda().trim().toLocaleLowerCase("es")) &&
          (!this.categoría() || producto.categoría === this.categoría()),
      ),
  );
  readonly páginas = computed(() => Math.ceil(this.filtrados().length / 12));
  readonly visibles = computed(() =>
    this.filtrados().slice(
      (Math.min(this.página(), this.páginas() || 1) - 1) * 12,
      Math.min(this.página(), this.páginas() || 1) * 12,
    ),
  );
  buscar(valor: string): void {
    this.búsqueda.set(valor);
    this.página.set(1);
  }
  filtrar(valor: string): void {
    this.categoría.set(valor);
    this.página.set(1);
  }
  limpiar(): void {
    this.búsqueda.set("");
    this.categoría.set("");
    this.página.set(1);
  }
}
