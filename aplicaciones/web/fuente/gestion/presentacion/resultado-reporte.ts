import { Component, computed, input, output } from "@angular/core";
import { DatePipe } from "@angular/common";
import { minutosDesde, type DatosReporte, type Reporte } from "../dominio/modelos";
import {
  PROCEDENCIAS, esNumerico, formatoCelda, procedenciaDe, salidaDe, type DatosReporteV2, type EspecificacionV2,
} from "../dominio/reportes-v2";
import { GraficoReporte } from "./grafico-reporte";

/** La proyección se sincroniza cada 20 s: más de 15 min sin datos nuevos indica una fuente detenida o atrasada. */
const MINUTOS_DESACTUALIZADO = 15;
const NOMBRE_ARCHIVO = { PDF: "PDF", EXCEL: "Excel" } as const;

/**
 * Resultado de un reporte v2. Respeta la salida pedida: con «solo PDF» o «solo Excel» muestra la interpretación y la
 * descarga de ese archivo, sin la tabla ni otros formatos; con pantalla, la tabla con las columnas pedidas y su gráfico.
 * La procedencia dice la verdad: modelo del servidor, reglas limitadas o edición manual.
 */
@Component({
  selector: "clb-resultado-reporte",
  imports: [DatePipe, GraficoReporte],
  template: `
    <div class="reporte-panel">
      <div class="reporte-grafico">
        <h2>{{ datos().titulo }}</h2>
        @if (reporte().interpretacion) { <p class="meta">{{ reporte().interpretacion }}</p> }
        <p class="meta">{{ datos().periodo.texto }} · datos al {{ datos().datos_al ? (datos().datos_al | date: "dd/MM/yyyy HH:mm") : "—" }}</p>
        @if (minutos() === null) {
          <p class="aviso-datos" role="status">Todavía no llegaron datos al modelo de lectura: las cifras pueden estar vacías.</p>
        } @else if (minutos()! > minutosDesactualizado) {
          <p class="aviso-datos" role="status">Los datos tienen {{ minutos() }} min de antigüedad. La sincronización corre cada 20 s;
            si Ventas o Inventario están detenidos, lo más reciente no aparece todavía.</p>
        }
        @if (salida().pantalla) {
          @if (graficoV1(); as g) {
            <clb-grafico-reporte [datos]="g" [visualizacion]="datos().grafico!.tipo" [grupo]="datos().grafico!.etiqueta_eje" [tabla]="false" />
          }
          @if (datos().filas.length) {
            <div class="tabla-administracion tabla-reporte-v2"><table>
              <caption class="saltar">{{ datos().titulo }}</caption>
              <thead><tr>
                @for (c of datos().columnas; track c.campo) { <th scope="col" [class.numero]="numerico(c.tipo)">{{ c.etiqueta }}</th> }
              </tr></thead>
              <tbody>
                @for (fila of datos().filas; track $index) {
                  <tr>@for (c of datos().columnas; track c.campo; let i = $index) {
                    <td [class.numero]="numerico(c.tipo)">{{ celda(fila[i], c.tipo) }}</td>
                  }</tr>
                }
                @if (hayTotales()) {
                  <tr class="total">@for (c of datos().columnas; track c.campo; let i = $index) {
                    <td [class.numero]="numerico(c.tipo)">{{ c.campo in datos().totales ? celda(datos().totales[c.campo], c.tipo) : (i === 0 ? "Total" : "") }}</td>
                  }</tr>
                }
              </tbody>
            </table></div>
          } @else {
            <p class="estado-vacio-gestion">No hay datos para este periodo y filtros. Amplía el periodo o quita filtros en «Ajustar».</p>
          }
        } @else {
          <div class="archivo-listo" role="status">
            <p>Pediste {{ textoSalida() }}: el reporte está listo para descargar
              ({{ datos().total_filas }} {{ datos().total_filas === 1 ? "fila" : "filas" }}{{ datos().grafico ? ", con gráfico" : "" }}).</p>
            <div class="acciones-especificacion">
              @for (f of salida().archivos; track f) {
                <button class="botón-principal" (click)="descargar.emit(f)" [disabled]="ocupado()">Descargar {{ nombres[f] }}</button>
              }
            </div>
          </div>
        }
      </div>
      <aside class="reporte-especificacion">
        <span class="etiqueta-estado" [attr.data-tono]="procedencia().tono">{{ procedencia().texto }}</span>
        @if (reporte().observacion) { <p class="nota-agente">{{ reporte().observacion }}</p> }
        @if (datos().notas.length) {
          <ul class="notas-reporte">@for (n of datos().notas; track $index) { <li>{{ n }}</li> }</ul>
        }
        @if (salida().pantalla) {
          <div class="acciones-especificacion">
            @for (f of salida().archivos; track f; let primero = $first) {
              <button [class]="primero ? 'botón-principal' : 'botón-secundario'" (click)="descargar.emit(f)" [disabled]="ocupado()">
                {{ salida().pedidos ? "Descargar" : "Exportar a" }} {{ nombres[f] }}</button>
            }
          </div>
        }
        <ng-content />
      </aside>
    </div>`,
})
export class ResultadoReporte {
  readonly reporte = input.required<Reporte>();
  readonly ocupado = input(false);
  readonly descargar = output<"PDF" | "EXCEL">();
  protected readonly nombres = NOMBRE_ARCHIVO;
  protected readonly minutosDesactualizado = MINUTOS_DESACTUALIZADO;

  protected readonly datos = computed(() => this.reporte().datos as DatosReporteV2);
  protected readonly salida = computed(() => salidaDe(this.reporte().especificacion as EspecificacionV2));
  protected readonly procedencia = computed(() => PROCEDENCIAS[procedenciaDe(this.reporte())]);
  protected readonly minutos = computed(() => minutosDesde(this.datos().datos_al));
  protected readonly hayTotales = computed(() => Object.keys(this.datos().totales).length > 0);
  protected readonly textoSalida = computed(() => {
    const archivos = this.salida().archivos.map(f => NOMBRE_ARCHIVO[f]);
    return archivos.length === 1 ? `solo ${archivos[0]}` : archivos.join(" y ");
  });

  /** El gráfico existente dibuja una serie: los puntos del servidor en Bs (dinero) o unidades, fechas legibles en barras. */
  protected readonly graficoV1 = computed<DatosReporte | null>(() => {
    const g = this.datos().grafico;
    if (!g || !g.puntos.length) return null;
    const dinero = g.tipo_valor === "DINERO";
    const filas = g.puntos.map(p => ({
      clave: g.eje === "FECHA" && g.tipo === "BARRAS" ? formatoCelda(p.clave, "FECHA") : String(p.clave),
      valor: dinero ? p.valor / 100 : p.valor,
    }));
    return { titulo: `${g.etiqueta_valor} por ${g.etiqueta_eje.toLowerCase()}`, unidad: dinero ? "Bs" : "",
      total: filas.reduce((t, f) => t + f.valor, 0), filas, pedidos: 0, unidades: 0, monto: "", datos_al: this.datos().datos_al };
  });

  protected celda = formatoCelda;
  protected numerico = esNumerico;
}
