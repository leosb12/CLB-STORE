import { Component, computed, input } from "@angular/core";
import { METRICAS, compacto, formatoValor, marcasEje, type DatosReporte, type Metrica, type Visualizacion } from "../dominio/modelos";

const ANCHO = 680;
const ETIQUETAS = 190;    // columna de nombres en barras horizontales
const FILA = 34;
const GROSOR = 18;        // ≤ 24 px: la banda sobrante es aire
const ALTO_LINEAS = 260;
const MARGEN = { arriba: 16, derecha: 64, abajo: 34, izquierda: 52 };

/**
 * Gráfico de un reporte: una sola serie, así que no lleva leyenda (el título la nombra). Barras horizontales (los nombres de
 * prenda son largos), líneas para la evolución diaria, KPI como cifra única y siempre una vista de tabla.
 */
@Component({
  selector: "clb-grafico-reporte",
  template: `
    @switch (visualizacion()) {
      @case ("KPI") {
        <div class="kpi-reporte"><strong>{{ total() }}</strong><span>{{ datos().titulo }}</span></div>
      }
      @case ("BARRAS") {
        <svg class="grafico" role="img" [attr.viewBox]="'0 0 ' + ancho + ' ' + barras().alto" [attr.aria-label]="descripcion()">
          @for (marca of barras().marcas; track marca.x) {
            <line class="rejilla" [attr.x1]="marca.x" [attr.x2]="marca.x" y1="0" [attr.y2]="barras().alto - 22" />
            <text class="eje" [attr.x]="marca.x" [attr.y]="barras().alto - 6" text-anchor="middle">{{ marca.texto }}</text>
          }
          @for (barra of barras().barras; track barra.clave) {
            <g class="marca">
              <rect class="zona" x="0" [attr.y]="barra.y - 8" [attr.width]="ancho" [attr.height]="fila"><title>{{ barra.clave }}: {{ barra.texto }}</title></rect>
              <text class="etiqueta" [attr.x]="etiquetas - 12" [attr.y]="barra.y + grosor / 2 + 4" text-anchor="end">{{ barra.corta }}</text>
              <path class="dato" [attr.d]="barra.trazo" />
              <text class="valor" [attr.x]="etiquetas + barra.ancho + 8" [attr.y]="barra.y + grosor / 2 + 4">{{ barra.texto }}</text>
            </g>
          }
        </svg>
      }
      @case ("LINEAS") {
        <svg class="grafico" role="img" [attr.viewBox]="'0 0 ' + ancho + ' ' + altoLineas" [attr.aria-label]="descripcion()">
          @for (marca of lineas().marcas; track marca.y) {
            <line class="rejilla" [attr.x1]="margen.izquierda" [attr.x2]="ancho - margen.derecha" [attr.y1]="marca.y" [attr.y2]="marca.y" />
            <text class="eje" [attr.x]="margen.izquierda - 8" [attr.y]="marca.y + 4" text-anchor="end">{{ marca.texto }}</text>
          }
          <path class="area" [attr.d]="lineas().area" />
          <path class="linea" [attr.d]="lineas().trazo" />
          @for (punto of lineas().puntos; track punto.clave) {
            <g class="marca">
              <circle class="zona" [attr.cx]="punto.x" [attr.cy]="punto.y" r="14"><title>{{ punto.clave }}: {{ punto.texto }}</title></circle>
              <circle class="punto" [attr.cx]="punto.x" [attr.cy]="punto.y" r="4" />
              @if (punto.eje) { <text class="eje" [attr.x]="punto.x" [attr.y]="altoLineas - 10" text-anchor="middle">{{ punto.eje }}</text> }
            </g>
          }
          @if (lineas().ultimo; as ultimo) {
            <text class="valor" [attr.x]="ultimo.x + 10" [attr.y]="ultimo.y + 4">{{ ultimo.texto }}</text>
          }
        </svg>
      }
    }
    @if (tabla() && (datos().filas.length || visualizacion() === "TABLA")) {
      <details class="tabla-reporte" [open]="visualizacion() === 'TABLA'">
        <summary>{{ visualizacion() === "TABLA" ? "Tabla del reporte" : "Ver como tabla" }}</summary>
        <div class="tabla-administracion"><table>
          <thead><tr><th scope="col">{{ grupo() }}</th>
            @for (m of columnas(); track m) { <th scope="col" class="numero">{{ nombres[m] }}</th> }</tr></thead>
          <tbody>
            @for (fila of datos().filas; track fila.clave) {
              <tr><td>{{ fila.clave }}</td>
                @for (m of columnas(); track m) { <td class="numero">{{ cifra(fila.valores?.[m] ?? (m === columnas()[0] ? fila.valor : 0), m) }}</td> }</tr>
            }
            <tr class="total"><td>Total del periodo</td>
              @for (m of columnas(); track m) { <td class="numero">{{ cifra(datos().totales?.[m] ?? (m === columnas()[0] ? datos().total : 0), m) }}</td> }</tr>
          </tbody>
        </table></div>
      </details>
    }`,
})
export class GraficoReporte {
  readonly datos = input.required<DatosReporte>();
  readonly visualizacion = input.required<Visualizacion>();
  readonly grupo = input("Grupo");
  /** Los reportes v2 dibujan su propia tabla con las columnas pedidas: aquí solo el gráfico. */
  readonly tabla = input(true);
  protected readonly ancho = ANCHO;
  protected readonly etiquetas = ETIQUETAS;
  protected readonly fila = FILA;
  protected readonly grosor = GROSOR;
  protected readonly altoLineas = ALTO_LINEAS;
  protected readonly margen = MARGEN;

  protected readonly total = computed(() => this.texto(this.datos().total));
  protected readonly nombres = METRICAS;
  /** Columnas pedidas; un reporte anterior a la ampliación solo trae la métrica principal. */
  protected readonly columnas = computed<Metrica[]>(() => this.datos().columnas ?? [this.metricaPrincipal()]);

  private metricaPrincipal(): Metrica {
    return this.datos().unidad === "Bs" ? "MONTO" : this.datos().unidad === "pedidos" ? "PEDIDOS" : "UNIDADES";
  }

  protected cifra(valor: number, metrica: Metrica): string {
    return formatoValor(valor, metrica === "MONTO" ? "Bs" : "");
  }
  protected readonly descripcion = computed(() => `${this.datos().titulo}: ` +
    this.datos().filas.map(f => `${f.clave} ${this.texto(f.valor)}`).join(", "));

  protected readonly barras = computed(() => {
    const filas = this.datos().filas;
    const marcas = marcasEje(Math.max(...filas.map(f => f.valor), 0));
    const tope = marcas[marcas.length - 1] || 1;
    const util = ANCHO - ETIQUETAS - 70;
    const escala = (v: number) => (v / tope) * util;
    return {
      alto: filas.length * FILA + 30,
      marcas: marcas.map(m => ({ x: ETIQUETAS + escala(m), texto: compacto(m) })),
      barras: filas.map((f, i) => {
        const ancho = Math.max(escala(f.valor), 2), y = i * FILA + 8;
        const r = Math.min(4, ancho / 2);
        // Extremo de dato redondeado (4 px), base recta sobre el eje.
        const trazo = `M${ETIQUETAS},${y} h${ancho - r} a${r},${r} 0 0 1 ${r},${r} v${GROSOR - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(ancho - r)} z`;
        return { clave: f.clave, corta: f.clave.length > 26 ? f.clave.slice(0, 25) + "…" : f.clave, y, ancho, trazo, texto: this.texto(f.valor) };
      }),
    };
  });

  protected readonly lineas = computed(() => {
    const filas = this.datos().filas;
    const marcas = marcasEje(Math.max(...filas.map(f => f.valor), 0));
    const tope = marcas[marcas.length - 1] || 1;
    const alto = ALTO_LINEAS - MARGEN.arriba - MARGEN.abajo;
    const ancho = ANCHO - MARGEN.izquierda - MARGEN.derecha;
    const y = (v: number) => MARGEN.arriba + alto - (v / tope) * alto;
    const x = (i: number) => MARGEN.izquierda + (filas.length > 1 ? (i / (filas.length - 1)) * ancho : ancho / 2);
    const cada = Math.max(1, Math.ceil(filas.length / 6));
    const puntos = filas.map((f, i) => ({ clave: f.clave, x: x(i), y: y(f.valor), texto: this.texto(f.valor),
      eje: i % cada === 0 || i === filas.length - 1 ? f.clave.slice(5) : "" }));
    const trazo = puntos.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
    const base = MARGEN.arriba + alto;
    return {
      marcas: marcas.map(m => ({ y: y(m), texto: compacto(m) })),
      puntos, trazo,
      area: puntos.length ? `${trazo} L${puntos[puntos.length - 1].x},${base} L${puntos[0].x},${base} Z` : "",
      ultimo: puntos[puntos.length - 1] ?? null,
    };
  });

  protected texto(valor: number): string {
    return formatoValor(valor, this.datos().unidad === "Bs" ? "Bs" : "");
  }
}
