import { Component, computed, effect, input, output, signal } from "@angular/core";
import {
  CATALOGO_REPORTES, OPERADORES, OPERADORES_POR_TIPO, PERIODOS_V2,
  type EspecificacionV2, type FiltroV2, type Formato, type FuenteReporte, type Operador, type PeriodoV2,
} from "../dominio/reportes-v2";

const FORMATOS: { id: Formato; nombre: string }[] = [{ id: "PANTALLA", nombre: "Pantalla" }, { id: "PDF", nombre: "PDF" },
  { id: "EXCEL", nombre: "Excel" }];

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Edición manual de un reporte v2: solo nombres del catálogo, en combinaciones que el servidor acepta (en un detalle,
 * datos de cada fila; en totales, agrupaciones y sumas). El servidor vuelve a validar todo y lo marca como «editado».
 */
@Component({
  selector: "clb-ajuste-reporte-v2",
  template: `
    <form class="ajuste-reporte" (submit)="$event.preventDefault(); enviar()">
      <fieldset>
        <legend>Qué datos</legend>
        <div class="campo"><label for="v2-fuente">Fuente</label>
          <select id="v2-fuente" (change)="cambiarFuente($any(valor($event)))">
            <option value="VENTAS" [selected]="fuente() === 'VENTAS'">Ventas (pedidos)</option>
            <option value="INVENTARIO" [selected]="fuente() === 'INVENTARIO'">Inventario actual</option>
          </select></div>
        <div class="campo"><label for="v2-tipo">Filas</label>
          <select id="v2-tipo" (change)="cambiarTipo($any(valor($event)))">
            <option value="DETALLE" [selected]="tipo() === 'DETALLE'">{{ fuente() === "VENTAS" ? "Una por línea de venta" : "Una por variante" }}</option>
            <option value="AGREGADO" [selected]="tipo() === 'AGREGADO'">Totales agrupados</option>
          </select></div>
        @if (fuente() === "VENTAS") {
          <div class="campo"><label for="v2-periodo">Periodo</label>
            <select id="v2-periodo" (change)="periodo.set($any(valor($event)))">
              @for (p of periodos; track p[0]) { <option [value]="p[0]" [selected]="p[0] === periodo()">{{ p[1] }}</option> }
            </select></div>
          @if (periodo() === "RANGO") {
            <div class="campo"><label for="v2-desde">Desde</label>
              <input id="v2-desde" type="date" [max]="hoy" [value]="desde()" (input)="desde.set(valor($event))" /></div>
            <div class="campo"><label for="v2-hasta">Hasta</label>
              <input id="v2-hasta" type="date" [max]="hoy" [value]="hasta()" (input)="hasta.set(valor($event))" /></div>
          }
        }
      </fieldset>

      <fieldset class="columnas-v2" role="group" aria-labelledby="v2-columnas">
        <legend id="v2-columnas">Columnas <span class="opcional">(en el orden en que las marques)</span></legend>
        @for (c of disponibles(); track c[0]) {
          <label class="casilla"><input type="checkbox" [checked]="columnas().includes(c[0])" (change)="alternar(c[0])" />{{ c[1].etiqueta }}</label>
        }
      </fieldset>

      <fieldset>
        <legend>Filtros <span class="opcional">(opcional)</span></legend>
        @for (f of filtros(); track $index; let i = $index) {
          <div class="campo"><label [for]="'v2-fc-' + i">Campo</label>
            <select [id]="'v2-fc-' + i" (change)="cambiarFiltro(i, { campo: valor($event), operador: operadoresDe(valor($event))[0] })">
              @for (c of filtrables(); track c[0]) { <option [value]="c[0]" [selected]="c[0] === f.campo">{{ c[1].etiqueta }}</option> }
            </select></div>
          <div class="campo"><label [for]="'v2-fo-' + i">Condición</label>
            <select [id]="'v2-fo-' + i" (change)="cambiarFiltro(i, { operador: $any(valor($event)) })">
              @for (o of operadoresDe(f.campo); track o) { <option [value]="o" [selected]="o === f.operador">{{ operadores[o] }}</option> }
            </select></div>
          <div class="campo"><label [for]="'v2-fv-' + i">Valor</label>
            <input [id]="'v2-fv-' + i" maxlength="60" [value]="f.valor" (input)="cambiarFiltro(i, { valor: valor($event) })"
              [placeholder]="ejemplo(f.campo)" /></div>
          <button type="button" class="botón-texto" (click)="quitarFiltro(i)">Quitar</button>
        }
        @if (filtros().length < 6) { <button type="button" class="botón-texto" (click)="agregarFiltro()">Añadir filtro</button> }
      </fieldset>

      <fieldset>
        <legend>Orden, gráfico y salida</legend>
        <div class="campo"><label for="v2-orden">Ordenar por</label>
          <select id="v2-orden" (change)="ordenCampo.set(valor($event))">
            <option value="" [selected]="!ordenCampo()">Predeterminado</option>
            @for (c of columnas(); track c) { <option [value]="c" [selected]="c === ordenCampo()">{{ etiqueta(c) }}</option> }
          </select></div>
        <div class="campo"><label for="v2-dir">Dirección</label>
          <select id="v2-dir" (change)="ordenDir.set($any(valor($event)))" [disabled]="!ordenCampo()">
            <option value="DESC" [selected]="ordenDir() === 'DESC'">De mayor a menor</option>
            <option value="ASC" [selected]="ordenDir() === 'ASC'">De menor a mayor</option>
          </select></div>
        <div class="campo"><label for="v2-limite">Máximo de filas</label>
          <input id="v2-limite" type="number" min="1" max="500" [value]="limite()" (input)="limite.set(+valor($event))" /></div>
        <div class="campo"><label for="v2-grafico">Gráfico</label>
          <select id="v2-grafico" (change)="graficoTipo.set($any(valor($event)))">
            <option value="NINGUNO" [selected]="graficoTipo() === 'NINGUNO'">Sin gráfico</option>
            <option value="BARRAS" [selected]="graficoTipo() === 'BARRAS'">Barras</option>
            @if (fuente() === "VENTAS") { <option value="LINEAS" [selected]="graficoTipo() === 'LINEAS'">Líneas (por fecha)</option> }
          </select></div>
        @if (graficoTipo() !== "NINGUNO") {
          <div class="campo"><label for="v2-eje">Por</label>
            <select id="v2-eje" (change)="graficoEje.set(valor($event))" [disabled]="graficoTipo() === 'LINEAS'">
              @for (c of dimensiones(); track c[0]) { <option [value]="c[0]" [selected]="c[0] === ejeEfectivo()">{{ c[1].etiqueta }}</option> }
            </select></div>
          <div class="campo"><label for="v2-valor">Valor</label>
            <select id="v2-valor" (change)="graficoValor.set(valor($event))">
              @for (c of metricas(); track c[0]) { <option [value]="c[0]" [selected]="c[0] === graficoValor()">{{ c[1].etiqueta }}</option> }
            </select></div>
        }
        <div class="columnas-extra" role="group" aria-label="Salida">
          @for (f of formatos; track f.id) {
            <label class="casilla"><input type="checkbox" [checked]="salida().includes(f.id)" (change)="alternarFormato(f.id)" />{{ f.nombre }}</label>
          }
        </div>
      </fieldset>

      @if (problema(); as p) { <p class="aviso-ajuste" role="alert">{{ p }}</p> }
      <div class="acciones-ajuste">
        <button type="submit" class="botón-principal" [disabled]="ocupado() || !!problema()">{{ ocupado() ? "Actualizando…" : "Actualizar reporte" }}</button>
      </div>
    </form>`,
})
export class AjusteReporteV2 {
  readonly especificacion = input.required<EspecificacionV2>();
  readonly ocupado = input(false);
  readonly actualizar = output<EspecificacionV2>();

  protected readonly periodos = Object.entries(PERIODOS_V2) as [PeriodoV2, string][];
  protected readonly operadores = OPERADORES;
  protected readonly formatos = FORMATOS;
  protected readonly hoy = hoy();

  protected readonly fuente = signal<FuenteReporte>("VENTAS");
  protected readonly tipo = signal<"DETALLE" | "AGREGADO">("DETALLE");
  protected readonly columnas = signal<string[]>([]);
  protected readonly periodo = signal<PeriodoV2>("ESTE_MES");
  protected readonly desde = signal("");
  protected readonly hasta = signal("");
  protected readonly filtros = signal<FiltroV2[]>([]);
  protected readonly ordenCampo = signal("");
  protected readonly ordenDir = signal<"ASC" | "DESC">("DESC");
  protected readonly limite = signal(200);
  protected readonly graficoTipo = signal<"NINGUNO" | "BARRAS" | "LINEAS">("NINGUNO");
  protected readonly graficoEje = signal("");
  protected readonly graficoValor = signal("");
  protected readonly salida = signal<Formato[]>([]);

  private readonly catalogo = computed(() => Object.entries(CATALOGO_REPORTES[this.fuente()]));
  protected readonly disponibles = computed(() => this.catalogo().filter(([, c]) =>
    c.clase === "DIMENSION" || c.clase === (this.tipo() === "DETALLE" ? "VALOR" : "METRICA")));
  protected readonly dimensiones = computed(() => this.catalogo().filter(([n, c]) => c.clase === "DIMENSION" && n !== "PEDIDO"));
  protected readonly metricas = computed(() => this.catalogo().filter(([, c]) => c.clase === "METRICA"));
  protected readonly filtrables = computed(() => this.catalogo().filter(([, c]) =>
    c.tipo !== "FECHA" && (c.clase !== "METRICA" || this.tipo() === "AGREGADO")));
  protected readonly ejeEfectivo = computed(() => this.graficoTipo() === "LINEAS" ? "FECHA" : this.graficoEje());

  protected readonly problema = computed(() => {
    if (!this.columnas().length) return "Marca al menos una columna.";
    const clases = this.columnas().map(c => CATALOGO_REPORTES[this.fuente()][c]?.clase);
    if (this.tipo() === "AGREGADO" && !clases.includes("METRICA")) return "Los totales necesitan al menos una suma (unidades, ventas…).";
    if (this.periodo() === "RANGO" && (!this.desde() || !this.hasta())) return "Indica las fechas desde y hasta.";
    if (this.periodo() === "RANGO" && this.desde() > this.hasta()) return "La fecha desde no puede ser posterior a hasta.";
    if (this.filtros().some(f => !f.valor.trim())) return "Completa el valor de cada filtro o quítalo.";
    if (!(this.limite() >= 1 && this.limite() <= 500)) return "El máximo de filas va de 1 a 500.";
    return "";
  });

  constructor() {
    effect(() => {
      const e = this.especificacion();
      this.fuente.set(e.fuente);
      this.tipo.set(e.tipo);
      this.columnas.set([...e.columnas]);
      this.periodo.set(e.periodo);
      this.desde.set(e.desde ?? "");
      this.hasta.set(e.hasta ?? "");
      this.filtros.set(e.filtros.map(f => ({ ...f })));
      this.ordenCampo.set(e.orden[0]?.campo ?? "");
      this.ordenDir.set(e.orden[0]?.direccion ?? "DESC");
      this.limite.set(e.limite);
      this.graficoTipo.set(e.grafico.tipo);
      this.graficoEje.set(e.grafico.eje ?? "");
      this.graficoValor.set(e.grafico.valor ?? "");
      this.salida.set([...e.formatos]);
    });
  }

  protected cambiarFuente(fuente: FuenteReporte): void {
    this.fuente.set(fuente);
    this.columnas.set([]);
    this.filtros.set([]);
    this.ordenCampo.set("");
    this.graficoTipo.set("NINGUNO");
    if (fuente === "INVENTARIO") this.periodo.set("TODO");
  }

  /** Al cambiar el tipo se conservan las columnas que siguen teniendo sentido. */
  protected cambiarTipo(tipo: "DETALLE" | "AGREGADO"): void {
    this.tipo.set(tipo);
    const validas = new Set(this.disponibles().map(([n]) => n));
    this.columnas.update(c => c.filter(n => validas.has(n)));
    if (!this.columnas().includes(this.ordenCampo())) this.ordenCampo.set("");
  }

  protected alternar(campo: string): void {
    this.columnas.update(c => c.includes(campo) ? c.filter(x => x !== campo) : [...c, campo]);
    if (!this.columnas().includes(this.ordenCampo())) this.ordenCampo.set("");
  }

  protected alternarFormato(formato: Formato): void {
    this.salida.update(f => f.includes(formato) ? f.filter(x => x !== formato) : [...f, formato]);
  }

  protected operadoresDe(campo: string): Operador[] {
    const c = CATALOGO_REPORTES[this.fuente()][campo];
    return c ? OPERADORES_POR_TIPO[c.tipo] : [];
  }

  protected etiqueta(campo: string): string {
    return CATALOGO_REPORTES[this.fuente()][campo]?.etiqueta ?? campo;
  }

  protected ejemplo(campo: string): string {
    const c = CATALOGO_REPORTES[this.fuente()][campo];
    if (campo === "ESTADO") return "CONFIRMADO o CANCELADO";
    if (campo === "STOCK_BAJO") return "SI o NO";
    return c?.tipo === "DINERO" ? "150.00" : c?.tipo === "ENTERO" ? "5" : "Texto";
  }

  protected agregarFiltro(): void {
    const [campo] = this.filtrables()[0] ?? ["PRODUCTO"];
    this.filtros.update(f => [...f, { campo, operador: this.operadoresDe(campo)[0] ?? "IGUAL", valor: "" }]);
  }

  protected quitarFiltro(i: number): void {
    this.filtros.update(f => f.filter((_, j) => j !== i));
  }

  protected cambiarFiltro(i: number, cambios: Partial<FiltroV2>): void {
    this.filtros.update(f => f.map((x, j) => j === i ? { ...x, ...cambios } : x));
  }

  protected enviar(): void {
    if (this.problema()) return;
    const conGrafico = this.graficoTipo() !== "NINGUNO";
    this.actualizar.emit({
      version: 2, titulo: this.especificacion().titulo, fuente: this.fuente(), tipo: this.tipo(), columnas: this.columnas(),
      // El ajuste nunca cambia de conjunto: un reporte del dataset de demostración sigue siéndolo al regenerarse.
      ...(this.especificacion().conjunto ? { conjunto: this.especificacion().conjunto } : {}),
      filtros: this.filtros().map(f => ({ ...f, valor: f.valor.trim() })),
      periodo: this.fuente() === "INVENTARIO" ? "TODO" : this.periodo(),
      desde: this.periodo() === "RANGO" ? this.desde() : null, hasta: this.periodo() === "RANGO" ? this.hasta() : null,
      orden: this.ordenCampo() ? [{ campo: this.ordenCampo(), direccion: this.ordenDir() }] : [],
      limite: this.limite(),
      grafico: conGrafico ? { tipo: this.graficoTipo(), eje: this.ejeEfectivo() || null, valor: this.graficoValor() || null }
        : { tipo: "NINGUNO", eje: null, valor: null },
      formatos: this.salida(),
    });
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }
}
