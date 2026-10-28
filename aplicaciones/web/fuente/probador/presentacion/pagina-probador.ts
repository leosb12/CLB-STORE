import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import type { Producto } from "../../catalogo/dominio/modelos";
import { fotografiaPrenda, recursoFotografia } from "../../catalogo/dominio/imagen-prenda";
import { cargarProbador } from "../adaptadores/cargador-probador";
import { VERSION_CONTRATO, type PrendaProbador, type ResultadoProbador } from "../dominio/contrato";
import { SESION } from '../../sesion/adaptadores/sesion-oidc';

interface Sugerencia { identificador: string; nombre: string; talla: string; disponible: boolean | null; color?: string }

/**
 * Aloja el microfrontend React <clb-probador>. Desde una prenda (`/productos/:id/probador`) la abre ya puesta; desde la
 * navegación (`/probador`) empieza vacío. En ambos casos ofrece el catálogo guardado para combinar arriba y abajo, y
 * convierte cada resultado en «Elegir talla» de esa prenda.
 */
@Component({
  selector: "clb-pagina-probador",
  imports: [RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `@if (id) {
      <a class="volver" [routerLink]="['/productos', id]">← Volver a la prenda</a>
    } @else {
      <a class="volver" routerLink="/catalogo">← Volver al catálogo</a>
    }
    @if (error()) {
      <div class="estado-vacío" role="alert">
        <h1>Probador no disponible</h1>
        <p>{{ error() }}</p>
      </div>
    } @else if (listo()) {
      <clb-probador class="probador-virtual" [prenda]="prenda() ?? null" [catalogo]="catalogo()" [sesionProbador]="sesionProbador" (probador-resultado)="recibir($event)"></clb-probador>
      @if (conFotos()) {
        <p class="nota-local"><a href="/prendas/CREDITOS.txt" target="_blank" rel="noopener">Fotografías: PNGimg.com · CC BY-NC 4.0</a></p>
      }
      @if (sugerencias().length) {
        <div class="salida-probador" role="status">
          @for (s of sugerencias(); track s.identificador) {
            <p>
              Para {{ s.nombre }} el probador sugiere la talla <strong>{{ s.talla }}</strong
              >{{ s.disponible === false ? ", pero esta prenda no tiene esa talla." : "." }}
            </p>
            @if (s.disponible !== false) {
              <a class="botón-principal" [routerLink]="['/productos', s.identificador]" [queryParams]="{ talla: s.talla, color: s.color }">Elegir talla {{ s.talla }}</a>
            }
          }
        </div>
      }
    } @else {
      <p class="estado-vacío" role="status">Abriendo el probador…</p>
    }`,
})
export class PaginaProbador {
  private readonly sesion = inject(SESION);
  readonly sesionProbador = async () => ({titular: await this.sesion.sub(), cabeceras: await this.sesion.cabeceras()});
  private readonly estado = inject(EstadoCatalogo);
  id = "";
  readonly prenda = signal<PrendaProbador | undefined>(undefined);
  readonly catalogo = signal<PrendaProbador[]>([]);
  readonly listo = signal(false);
  readonly error = signal("");
  readonly sugerencias = signal<Sugerencia[]>([]);
  readonly conFotos = () => [this.prenda(), ...this.catalogo()].some((p) => p && fotografiaPrenda(p.sku));

  constructor() {
    // Angular reutiliza el componente si solo cambia la prenda en la URL: se vuelve a abrir con la nueva.
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe((parámetros) => {
      this.id = parámetros.get("identificador") ?? "";
      this.prenda.set(undefined);
      this.listo.set(false);
      this.error.set("");
      this.sugerencias.set([]);
      void this.abrir(this.id);
    });
  }

  /** Producto → contrato del probador. Con foto publicada, solo las tallas del color de esa foto. */
  private async aPrenda(producto: Producto): Promise<PrendaProbador> {
    const variantes = await this.estado.local.variantes(producto.identificador).catch(() => []);
    return {
      identificador: producto.identificador,
      sku: producto.sku,
      nombre: producto.nombre,
      categoría: producto["categoría"],
      imagen: this.estado.imagen(producto, true),
      imagenFotografica: this.estado.tieneTextura(producto) ? this.estado.imagen(producto, true) : producto.recurso_probador ? undefined : recursoFotografia(producto.sku),
      recurso: this.estado.tieneTextura(producto) ? producto.recurso_probador : undefined,
      modelo3d: this.estado.tieneTextura(producto) ? this.estado.modelo3d(producto) : undefined,
      tallas: [...new Set(variantes.filter((v) => v.activo !== false && (!producto.recurso_probador || v.color === producto.recurso_probador.color)).map((v) => v.talla))],
    };
  }

  private async abrir(id: string): Promise<void> {
    let producto: Producto | undefined;
    try {
      producto = id ? await this.estado.consultar(id) : (await this.estado.iniciar(), undefined);
    } catch {
      this.error.set("La prenda no existe o aún no fue descargada para usarla sin conexión.");
      return;
    }
    try {
      await cargarProbador();
    } catch {
      this.error.set(
        navigator.onLine
          ? "El probador no responde en este momento. El catálogo y el carrito siguen funcionando."
          : "El probador todavía no está guardado en este dispositivo. Ábrelo una vez con conexión para usarlo sin red.",
      );
      return;
    }
    // Para combinar: prendas activas con foto (publicada o de la colección), leídas del catálogo local (sirve sin red).
    const combinables = this.estado.productos().filter((p) => p.activo !== false && p.identificador !== id && (this.estado.tieneTextura(p) || fotografiaPrenda(p.sku)));
    const [prenda, catalogo] = await Promise.all([producto && this.aPrenda(producto), Promise.all(combinables.map((p) => this.aPrenda(p)))]);
    if (id !== this.id) return;
    this.prenda.set(prenda);
    this.catalogo.set(catalogo);
    this.listo.set(true);
  }

  recibir(evento: Event): void {
    const resultado = (evento as CustomEvent<ResultadoProbador>).detail;
    if (resultado?.contrato !== VERSION_CONTRATO || !resultado.talla) return;
    const p = [this.prenda(), ...this.catalogo()].find((x) => x?.identificador === resultado.prenda.identificador);
    if (!p) return;
    const sugerencia: Sugerencia = { identificador: p.identificador, nombre: p.nombre, talla: resultado.talla, disponible: resultado.tallaDisponible, color: p.recurso?.color };
    // Una por prenda: la medida más reciente reemplaza a la anterior.
    this.sugerencias.update((lista) => [...lista.filter((s) => s.identificador !== p.identificador), sugerencia]);
  }
}
