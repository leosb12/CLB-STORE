import { Component, OnInit, inject } from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { EstadoGestion } from "../aplicacion/estado-gestion";
import { PERIODOS } from "../dominio/modelos";
import { GraficoReporte } from "./grafico-reporte";

/** Vista dedicada de un reporte (destino VISTA): el mismo reporte a pantalla completa, con su evidencia y el Excel. */
@Component({
  selector: "clb-pagina-reporte",
  imports: [DatePipe, JsonPipe, RouterLink, GraficoReporte],
  template: `<section class="vista-reporte">
    <a class="volver" routerLink="/gestion" [queryParams]="{ seccion: 'reportes' }">← Volver a Reportes</a>
    @if (estado.error()) { <p class="aviso-error" role="alert">{{ estado.error() }}</p> }
    @if (estado.reporte(); as reporte) {
      <div class="titulo-gestion">
        <h1>{{ reporte.especificacion.titulo }}</h1>
        <p>{{ periodos[reporte.especificacion.periodo] }} · datos al {{ reporte.datos_al | date: "dd/MM/yyyy HH:mm" }}
          @if (reporte.peticion) { · pedido como «{{ reporte.peticion }}» }</p>
      </div>
      <clb-grafico-reporte [datos]="reporte.datos" [visualizacion]="reporte.especificacion.visualizacion" />
      <div class="acciones-especificacion">
        <button class="botón-principal" (click)="estado.descargarExcel(reporte)" [disabled]="!!estado.ocupado()">Exportar a Excel</button>
      </div>
      <details class="evidencia-reporte"><summary>Cómo se generó</summary>
        <p class="nota-agente">{{ reporte.generativa ? "El modelo local tradujo la petición; el validador la aceptó." : (reporte.observacion ?? "Interpretación por palabras clave.") }}</p>
        <pre>{{ reporte.especificacion | json }}</pre>
      </details>
    } @else if (estado.ocupado()) {
      <p class="estado-vacio-gestion">Cargando el reporte…</p>
    }
  </section>`,
})
export class PaginaReporte implements OnInit {
  protected readonly estado = inject(EstadoGestion);
  private readonly ruta = inject(ActivatedRoute);
  protected readonly periodos = PERIODOS;

  ngOnInit(): void {
    const identificador = this.ruta.snapshot.paramMap.get("identificador") ?? "";
    if (this.estado.reporte()?.identificador !== identificador) {
      this.estado.reporte.set(null);
      void this.estado.reporteGuardado(identificador);
    }
  }
}
