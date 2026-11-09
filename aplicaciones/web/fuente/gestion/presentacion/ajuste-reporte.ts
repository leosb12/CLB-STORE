import { Component, computed, effect, input, output, signal } from "@angular/core";
import {
  AGRUPACIONES, METRICAS, ORDENES, PERIODOS,
  type Agrupacion, type Especificacion, type Filtros, type Metrica, type Orden, type Visualizacion,
} from "../dominio/modelos";

const FILTROS: { clave: keyof Filtros; nombre: string; ejemplo: string }[] = [
  { clave: "categoria", nombre: "Categoría", ejemplo: "Poleras" },
  { clave: "talla", nombre: "Talla", ejemplo: "M" },
  { clave: "color", nombre: "Color", ejemplo: "Negro" },
  { clave: "producto", nombre: "Producto contiene", ejemplo: "buzo" },
];
const GRAFICOS: Record<Visualizacion, string> = { TABLA: "Solo tabla", BARRAS: "Barras", LINEAS: "Líneas (por día)", KPI: "Cifra única" };

/** Fecha local AAAA-MM-DD (el servidor valida con el día de Bolivia; aquí solo limita el selector). */
function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Ajuste manual de un reporte: parte de la especificación que interpretó el servidor y produce otra, igual de cerrada.
 * Solo ofrece combinaciones válidas (KPI sin agrupación, líneas solo por día); el servidor vuelve a validar todo.
 */
@Component({
  selector: "clb-ajuste-reporte",
  template: `
    <form class="ajuste-reporte" (submit)="$event.preventDefault(); enviar()">
      <fieldset>
        <legend>Qué medir</legend>
        <div class="campo"><label for="ajuste-metrica">Métrica principal</label>
          <select id="ajuste-metrica" (change)="cambiarMetrica(valor($event))">
            @for (m of metricas; track m) { <option [value]="m" [selected]="m === metrica()">{{ nombresMetrica[m] }}</option> }
          </select></div>
        <div class="columnas-extra" role="group" aria-label="Columnas adicionales">
          @for (m of metricas; track m) {
            @if (m !== metrica()) {
              <label class="casilla"><input type="checkbox" [checked]="extra().includes(m)" (change)="alternarExtra(m)" />
                {{ nombresMetrica[m] }}</label>
            }
          }
        </div>
      </fieldset>

      <fieldset>
        <legend>Cómo agrupar</legend>
        <div class="campo"><label for="ajuste-agrupar">Agrupar por</label>
          <select id="ajuste-agrupar" (change)="cambiarAgrupacion(valor($event))">
            <option value="" [selected]="!agrupar()">Sin agrupar (total)</option>
            @for (a of agrupaciones; track a) { <option [value]="a" [selected]="a === agrupar()">{{ nombresGrupo[a] }}</option> }
          </select></div>
        <div class="campo"><label for="ajuste-orden">Orden</label>
          <select id="ajuste-orden" (change)="orden.set($any(valor($event)))" [disabled]="!agrupar() || agrupar() === 'DIA'">
            @for (o of ordenes; track o) { <option [value]="o" [selected]="o === orden()">{{ nombresOrden[o] }}</option> }
          </select></div>
        <div class="campo"><label for="ajuste-grafico">Mostrar</label>
          <select id="ajuste-grafico" (change)="visualizacion.set($any(valor($event)))">
            @for (g of graficos(); track g) { <option [value]="g" [selected]="g === visualizacion()">{{ nombresGrafico[g] }}</option> }
          </select></div>
        <div class="campo"><label for="ajuste-limite">Cuántos grupos</label>
          <input id="ajuste-limite" type="number" min="1" max="50" inputmode="numeric" [value]="limite()" (input)="limite.set(numero($event))" [disabled]="!agrupar()" /></div>
      </fieldset>

      <fieldset>
        <legend>Periodo</legend>
        <div class="campo"><label for="ajuste-periodo">Ventana</label>
          <select id="ajuste-periodo" (change)="periodo.set($any(valor($event)))">
            @for (p of periodos; track p) { <option [value]="p" [selected]="p === periodo()">{{ nombresPeriodo[p] }}</option> }
          </select></div>
        @if (periodo() === "RANGO") {
          <div class="campo"><label for="ajuste-desde">Desde</label>
            <input id="ajuste-desde" type="date" [max]="maximo" [value]="desde()" (input)="desde.set(valor($event))" required /></div>
          <div class="campo"><label for="ajuste-hasta">Hasta</label>
            <input id="ajuste-hasta" type="date" [max]="maximo" [min]="desde()" [value]="hasta()" (input)="hasta.set(valor($event))" required /></div>
        }
      </fieldset>

      <fieldset>
        <legend>Filtros <span class="opcional">opcionales</span></legend>
        @for (f of filtros; track f.clave) {
          <div class="campo"><label [for]="'ajuste-filtro-' + f.clave">{{ f.nombre }}</label>
            <input [id]="'ajuste-filtro-' + f.clave" maxlength="60" [value]="filtro()[f.clave] ?? ''" (input)="cambiarFiltro(f.clave, valor($event))" [placeholder]="'Ej.: ' + f.ejemplo" /></div>
        }
      </fieldset>

      @if (problema(); as texto) { <p class="aviso-ajuste" role="status">{{ texto }}</p> }
      <div class="acciones-ajuste">
        <button type="submit" class="botón-principal" [disabled]="ocupado() || !!problema()">{{ ocupado() ? "Actualizando…" : "Actualizar reporte" }}</button>
        <button type="button" class="botón-texto" (click)="cargar(especificacion())">Deshacer cambios</button>
      </div>
    </form>`,
})
export class AjusteReporte {
  readonly especificacion = input.required<Especificacion>();
  readonly ocupado = input(false);
  readonly actualizar = output<Especificacion>();

  protected readonly metricas = Object.keys(METRICAS) as Metrica[];
  protected readonly agrupaciones = Object.keys(AGRUPACIONES) as Agrupacion[];
  protected readonly ordenes = Object.keys(ORDENES) as Orden[];
  protected readonly periodos = Object.keys(PERIODOS) as Especificacion["periodo"][];
  protected readonly filtros = FILTROS;
  protected readonly nombresMetrica = METRICAS;
  protected readonly nombresGrupo = AGRUPACIONES;
  protected readonly nombresOrden = ORDENES;
  protected readonly nombresPeriodo = { ...PERIODOS, RANGO: "Entre dos fechas" };
  protected readonly nombresGrafico = GRAFICOS;
  protected readonly maximo = hoy();

  protected readonly metrica = signal<Metrica>("UNIDADES");
  protected readonly extra = signal<Metrica[]>([]);
  protected readonly agrupar = signal<Agrupacion | null>(null);
  protected readonly orden = signal<Orden>("METRICA_DESC");
  protected readonly visualizacion = signal<Visualizacion>("TABLA");
  protected readonly limite = signal(10);
  protected readonly periodo = signal<Especificacion["periodo"]>("SEMANA");
  protected readonly desde = signal("");
  protected readonly hasta = signal("");
  protected readonly filtro = signal<Filtros>({});

  /** Gráficos coherentes con la agrupación elegida (las mismas reglas que valida el servidor). */
  protected readonly graficos = computed<Visualizacion[]>(() =>
    !this.agrupar() ? ["KPI", "TABLA"] : this.agrupar() === "DIA" ? ["LINEAS", "BARRAS", "TABLA"] : ["BARRAS", "TABLA"]);

  protected readonly problema = computed(() => {
    if (this.periodo() !== "RANGO") return "";
    if (!this.desde() || !this.hasta()) return "Elige las dos fechas del rango.";
    if (this.desde() > this.hasta()) return "La fecha «desde» es posterior a «hasta».";
    if ((Date.parse(this.hasta()) - Date.parse(this.desde())) / 86_400_000 >= 366) return "El rango puede abarcar hasta 366 días.";
    return "";
  });

  constructor() {
    effect(() => this.cargar(this.especificacion()));
  }

  protected cargar(e: Especificacion): void {
    this.metrica.set(e.metrica);
    this.extra.set([...(e.metricas_extra ?? [])]);
    this.agrupar.set(e.agrupar_por);
    this.orden.set(e.orden ?? "METRICA_DESC");
    this.visualizacion.set(e.visualizacion);
    this.limite.set(e.limite);
    this.periodo.set(e.periodo);
    this.desde.set(e.desde ?? "");
    this.hasta.set(e.hasta ?? "");
    this.filtro.set({ ...(e.filtros ?? {}) });
  }

  protected cambiarMetrica(m: string): void {
    this.metrica.set(m as Metrica);
    this.extra.update(lista => lista.filter(x => x !== m));
  }

  protected alternarExtra(m: Metrica): void {
    this.extra.update(lista => lista.includes(m) ? lista.filter(x => x !== m) : [...lista, m].slice(0, 2));
  }

  protected cambiarAgrupacion(a: string): void {
    this.agrupar.set((a || null) as Agrupacion | null);
    if (!this.graficos().includes(this.visualizacion())) this.visualizacion.set(this.graficos()[0]);
  }

  protected cambiarFiltro(clave: keyof Filtros, texto: string): void {
    this.filtro.update(f => ({ ...f, [clave]: texto }));
  }

  protected enviar(): void {
    const filtros = Object.fromEntries(Object.entries(this.filtro()).map(([k, v]) => [k, v?.trim() || null]).filter(([, v]) => v));
    const base = this.especificacion();
    this.actualizar.emit({
      titulo: base.titulo, destino: base.destino === "HISTORIAL" ? "PANEL" : base.destino,
      metrica: this.metrica(), metricas_extra: this.extra(), agrupar_por: this.agrupar(),
      orden: this.orden(), visualizacion: this.visualizacion(), limite: Math.min(50, Math.max(1, this.limite() || 10)),
      periodo: this.periodo(),
      desde: this.periodo() === "RANGO" ? this.desde() : null, hasta: this.periodo() === "RANGO" ? this.hasta() : null,
      filtros: Object.keys(filtros).length ? filtros : null,
    });
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected numero(evento: Event): number {
    return Number((evento.target as HTMLInputElement).value);
  }
}
