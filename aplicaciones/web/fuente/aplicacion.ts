import { Component, DestroyRef, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { SwUpdate } from "@angular/service-worker";
import { EstadoCatalogo } from "./catalogo/aplicacion/estado-catalogo";

interface EventoInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

@Component({
  selector: "clb-aplicacion",
  imports: [RouterLink, RouterLinkActive, RouterOutlet, DatePipe],
  template: ` <a class="saltar" href="#contenido">Saltar al contenido</a>
    <div class="franja-superior">
      ESENCIALES QUE VAN CONTIGO <span>·</span> CLB STORE
    </div>
    <header class="encabezado">
      <a class="marca" routerLink="/catalogo" aria-label="CLB Store, inicio"
        ><span class="monograma">CLB<span>®</span></span
        ><span class="nombre-marca"
          >CLB Store<small>VISTE TU ESENCIA</small></span
        ></a
      >
      <nav aria-label="Navegación principal">
        <a routerLink="/catalogo" routerLinkActive="actual">Catálogo</a
        ><a routerLink="/favoritos" routerLinkActive="actual"
          >Favoritos
          <span class="contador-favoritos">{{
            estado.favoritos().size
          }}</span></a
        >
        <a routerLink="/administracion/productos" routerLinkActive="actual"
          >Administración</a
        >
        <a routerLink="/carrito" routerLinkActive="actual">Carrito</a>
      </nav>
      @if (this["instalación"]()) {
        <button class="instalar" (click)="instalar()">
          Instalar aplicación ↗
        </button>
      }
      <div class="estado-conexión" [class.desconectado]="!estado.disponible()">
        <span class="punto"></span
        >{{ estado.disponible() ? "En línea" : "Catálogo local" }}
      </div>
    </header>
    @if (this["actualización"]()) {
      <div class="aviso-actualización" role="status">
        Hay una nueva versión de CLB Store.<button (click)="recargar()">
          Actualizar aplicación
        </button>
      </div>
    }
    <div class="barra-sincronización" role="status" aria-live="polite">
      <div>
        <span aria-hidden="true">{{
          estado.sincronizando() ? "↻" : estado["desdeCaché"]() ? "◷" : "✓"
        }}</span>
        @if (estado.sincronizando()) {
          Sincronizando catálogo…
        } @else if (estado["desdeCaché"]()) {
          {{
            estado["conexión"]()
              ? "Catálogo guardado · puede estar desactualizado"
              : "Sin conexión · explorando tu catálogo guardado"
          }}
        } @else {
          Catálogo actualizado
        }
        @if (estado["últimaSincronización"]()) {
          <small
            >Última descarga:
            {{
              estado["últimaSincronización"]() | date: "dd/MM/yyyy HH:mm"
            }}</small
          >
        }
      </div>
      <button
        (click)="estado.sincronizar(true)"
        [disabled]="estado.sincronizando() || !estado['conexión']()"
      >
        Sincronizar <span aria-hidden="true">↻</span>
      </button>
    </div>
    @if (estado.error()) {
      <div class="aviso-error" role="alert">{{ estado.error() }}</div>
    }
    <main id="contenido"><router-outlet /></main>
    <section class="banda-offline">
      <span class="símbolo-offline" aria-hidden="true">↙</span>
      <div>
        <h2>Tu estilo no necesita conexión.</h2>
        <p>
          Explora las prendas descargadas y guarda tus favoritos, estés donde
          estés.
        </p>
      </div>
      <span class="etiqueta-offline">DISPONIBLE SIN CONEXIÓN</span>
    </section>
    <footer>
      <a routerLink="/catalogo" class="marca-pie"
        >CLB Store<span>Prendas para tu día a día.</span></a
      >
      <p>Catálogo local · Precios en bolivianos (BOB)</p>
      <small>© {{ this["año"] }} CLB Store</small>
    </footer>`,
})
export class Aplicacion {
  readonly estado = inject(EstadoCatalogo);
  readonly actualización = signal(false);
  readonly instalación = signal<EventoInstalacion | undefined>(undefined);
  readonly año = new Date().getFullYear();
  constructor() {
    void this.estado.iniciar();
    const actualizaciones = inject(SwUpdate);
    const suscripción = actualizaciones.versionUpdates.subscribe((evento) => {
      if (evento.type === "VERSION_READY") this.actualización.set(true);
    });
    const capturar = (evento: Event) => {
      evento.preventDefault();
      this.instalación.set(evento as EventoInstalacion);
    };
    window.addEventListener("beforeinstallprompt", capturar);
    const intervalo = setInterval(
      () => {
        if (actualizaciones.isEnabled && navigator.onLine)
          void actualizaciones.checkForUpdate().catch(() => undefined);
      },
      60 * 60 * 1000,
    );
    inject(DestroyRef).onDestroy(() => {
      suscripción.unsubscribe();
      clearInterval(intervalo);
      window.removeEventListener("beforeinstallprompt", capturar);
    });
  }
  recargar(): void {
    location.reload();
  }
  async instalar(): Promise<void> {
    const evento = this.instalación();
    if (!evento) return;
    await evento.prompt();
    await evento.userChoice;
    this.instalación.set(undefined);
  }
}
