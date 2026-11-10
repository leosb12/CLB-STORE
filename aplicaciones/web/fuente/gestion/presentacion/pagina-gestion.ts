import { Component, DestroyRef, OnInit, inject, signal } from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { EstadoGestion } from "../aplicacion/estado-gestion";
import { NOMBRES_AGENTE, PERIODOS, minutosDesde, type Especificacion, type Propuesta, type Reporte } from "../dominio/modelos";
import {
  PROCEDENCIAS, SALIDAS, esV2, procedenciaDe, type EspecificacionV2, type Formato,
} from "../dominio/reportes-v2";
import { AjusteReporte } from "./ajuste-reporte";
import { AjusteReporteV2 } from "./ajuste-reporte-v2";
import { GraficoReporte } from "./grafico-reporte";
import { ResultadoReporte } from "./resultado-reporte";

/** La proyección se sincroniza cada 20 s: más de 15 min sin datos nuevos indica una fuente detenida o atrasada. */
const MINUTOS_DESACTUALIZADO = 15;

type Seccion = "monitoreo" | "reportes" | "inventario" | "clientes" | "auditoria";

const SECCIONES: { id: Seccion; nombre: string }[] = [
  { id: "monitoreo", nombre: "Monitoreo" }, { id: "reportes", nombre: "Reportes" }, { id: "inventario", nombre: "Inventario" },
  { id: "clientes", nombre: "Clientes" }, { id: "auditoria", nombre: "Auditoría" },
];

const SUGERENCIAS = [
  "Ventas de esta semana con cliente, producto, cantidad, precio unitario y total comprado",
  "Ventas por producto del mes con gráfico de barras",
  "Top 5 clientes que más compraron este mes",
  "Variantes con stock bajo en Excel",
];

const MISION_REPOSICION = "Revisa el stock bajo y propone reposiciones para las variantes que lo necesiten.";

@Component({
  selector: "clb-pagina-gestion",
  imports: [DatePipe, JsonPipe, RouterLink, GraficoReporte, AjusteReporte, AjusteReporteV2, ResultadoReporte],
  template: `<section class="gestion">
    <div class="titulo-gestion">
      <h1>Gestión del negocio</h1>
      <p>Cada sección es un agente con sus propias herramientas. Las cifras salen de los datos reales de ventas, inventario y
        clientes; el modelo local solo interpreta y redacta.</p>
    </div>

    <div class="pestanas" role="tablist" aria-label="Agentes de gestión">
      @for (s of secciones; track s.id) {
        <button role="tab" [id]="'pestana-' + s.id" [attr.aria-selected]="seccion() === s.id" [attr.aria-controls]="'panel-' + s.id"
          [disabled]="estado.ocupado() === 'microfono' || estado.ocupado() === 'grabando'"
          [class.actual]="seccion() === s.id" (click)="abrir(s.id)">{{ s.nombre }}</button>
      }
    </div>

    @if (estado.error()) { <p class="aviso-error" role="alert">{{ estado.error() }}</p> }
    @if (estado.aviso()) { <p class="mensaje-administracion" role="status">{{ estado.aviso() }}</p> }

    <div class="panel-gestion" role="tabpanel" [id]="'panel-' + seccion()" [attr.aria-labelledby]="'pestana-' + seccion()" aria-live="polite">
    @switch (seccion()) {
      @case ("monitoreo") {
        <form class="mision" (submit)="$event.preventDefault(); misionLibre()">
          <button type="button" class="botón-principal" [disabled]="!!estado.ocupado()" (click)="monitorear()">
            {{ estado.ocupado() === "mision" ? "Los agentes están trabajando…" : "Monitorea mi negocio" }}</button>
          <label for="mision-libre">Otra misión</label>
          <div class="campo-accion">
            <input id="mision-libre" maxlength="500" [value]="misionTexto()" (input)="misionTexto.set(valor($event))"
              placeholder="Ej.: ¿qué segmentos de clientes tengo y cuáles conviene recuperar?" />
            @if (estado.vozDisponible) {
              <button type="button" class="botón-secundario" [class.grabando]="estado.ocupado() === 'grabando'"
                [disabled]="!!estado.ocupado() && estado.ocupado() !== 'grabando'" (click)="voz('mision')"
                [attr.aria-pressed]="estado.ocupado() === 'grabando'">
                {{ etiquetaVoz() }}</button>
            }
            <button type="submit" class="botón-secundario" [disabled]="!!estado.ocupado() || misionTexto().trim().length < 3">Enviar misión</button>
          </div>
          @if (estado.ocupado() === "mision") {
            <p class="progreso">El orquestador eligió a los agentes; cada uno consulta sus herramientas MCP y redacta. Suele tardar entre 10 y 60 segundos.</p>
          }
        </form>
        <h2 class="subtitulo-gestion">Alertas de la automatización</h2>
        <p class="nota-agente">n8n revisa los eventos de Inventario cada 20 segundos y deja aquí cada variante que llegó a su mínimo.</p>
        @for (n of estado.notificaciones(); track n.evento) {
          <div class="propuesta notificacion-n8n">
            <div><strong>{{ n.producto }} · {{ n.talla }} · {{ n.color }}</strong>
              <small>{{ n.sku }} · quedan {{ n.disponible }} (mínimo {{ n.minimo }}) · {{ n.fecha_evento | date: "dd/MM HH:mm" }}</small>
              <small>{{ n.mensaje }}</small>
            </div>
            <div class="acciones-fila">
              <button class="botón-secundario" [disabled]="!!estado.ocupado()" (click)="estado.atender(n)">Marcar atendida</button>
            </div>
          </div>
        } @empty { <p class="estado-vacio-gestion">Sin alertas nuevas de la automatización.</p> }

        @if (estado.mision(); as resultado) {
          <div class="resultado-mision">
            <p class="meta">Misión «{{ resultado.mision }}» · {{ resultado.fecha | date: "dd/MM/yyyy HH:mm" }} · {{ resultado.agentes.length }} agentes</p>
            @for (agente of resultado.agentes; track agente.agente) {
              <article class="respuesta-agente">
                <header>
                  <h2>Agente de {{ nombres[agente.agente] }}</h2>
                  <span class="etiqueta-estado" [attr.data-tono]="agente.generativa ? 'ok' : 'espera'">{{ agente.generativa ? "Redactado por el modelo local" : "Resumen verificado (plantilla)" }}</span>
                </header>
                <p class="texto-agente">{{ agente.respuesta }}</p>
                @if (agente.observacion) { <p class="nota-agente">{{ agente.observacion }}</p> }
                <details class="fuentes-agente">
                  <summary>Fuentes: {{ agente.fuentes.length }} {{ agente.fuentes.length === 1 ? "consulta" : "consultas" }} a herramientas MCP</summary>
                  <p class="nota-agente">Lista blanca de este agente: {{ agente.herramientas_permitidas.join(", ") }}.</p>
                  <ol>
                    @for (fuente of agente.fuentes; track $index) {
                      <li><code>{{ fuente.herramienta }}</code> <small>{{ fuente.argumentos | json }}</small>
                        <pre>{{ fuente.resultado | json }}</pre></li>
                    }
                  </ol>
                  @if (agente.respuesta_descartada) { <p class="nota-agente">Texto descartado por el verificador de cifras: «{{ agente.respuesta_descartada }}»</p> }
                </details>
              </article>
            }
          </div>
        } @else if (estado.ocupado() !== "mision") {
          <p class="estado-vacio-gestion">Pide una misión amplia como «Monitorea mi negocio»: el orquestador la reparte entre los agentes de
            Monitoreo, Reportes, Inventario y Clientes, y cada respuesta indica de qué herramienta salió cada dato.</p>
        }
      }

      @case ("reportes") {
        <form class="formulario-reporte" (submit)="$event.preventDefault(); generar()">
          <label for="peticion">¿Qué quieres ver?</label>
          <textarea id="peticion" rows="2" maxlength="500" [value]="peticion()" (input)="peticion.set(valor($event))"
            placeholder="Escribe o dicta tu petición. Ej.: ventas por talla esta semana, barras en el panel"></textarea>
          <div class="sugerencias">
            @for (s of sugerencias; track s) { <button type="button" class="botón-texto" (click)="peticion.set(s)">{{ s }}</button> }
          </div>
          <div class="acciones-reporte">
            @if (estado.vozDisponible) {
              <button type="button" class="botón-secundario" [class.grabando]="estado.ocupado() === 'grabando'"
                [disabled]="!!estado.ocupado() && estado.ocupado() !== 'grabando'" (click)="voz('reporte')"
                [attr.aria-pressed]="estado.ocupado() === 'grabando'">
                {{ etiquetaVoz() }}</button>
            }
            <label class="destino">Salida
              <select (change)="salida.set(valor($event))">
                @for (s of salidas; track s.id) { <option [value]="s.id" [selected]="s.id === salida()">{{ s.nombre }}</option> }
              </select></label>
            <button type="submit" class="botón-principal" [disabled]="!!estado.ocupado() || peticion().trim().length < 3">
              {{ estado.ocupado() === "reporte" ? "Generando…" : "Generar reporte" }}</button>
          </div>
          @if (estado.ocupado() === "reporte") {
            <p class="progreso" role="status">El modelo de lenguaje del servidor interpreta la petición (suele tardar menos de
              15 s; si no responde, se usan reglas limitadas) y las cifras se calculan con los datos reales.</p>
          }
          @if (estado.noDisponible(); as motivos) {
            <div class="aviso-ambigua" role="alert">
              <p>Ese reporte no se puede armar con los datos que registra la tienda:</p>
              <ul class="notas-reporte">@for (m of motivos; track $index) { <li>{{ m }}</li> }</ul>
              <p class="nota-agente">Los reportes usan ventas (pedidos, clientes, productos y precios históricos) e inventario actual.</p>
            </div>
          }
          @if (estado.ambigua(); as ambigua) {
            <div class="aviso-ambigua" role="alert">
              <p>{{ ambigua.mensaje }}</p>
              @if (ambigua.sugerencias.length) {
                <p class="nota-agente">Por ejemplo:</p>
                <div class="sugerencias">
                  @for (s of ambigua.sugerencias; track s) {
                    <button type="button" class="botón-texto" (click)="peticion.set(s); estado.ambigua.set(null)">{{ s }}</button>
                  }
                </div>
              }
            </div>
          }
        </form>

        @if (estado.reporte(); as reporte) {
          @if (esV2(reporte.especificacion)) {
            <clb-resultado-reporte [reporte]="reporte" [ocupado]="!!estado.ocupado()" (descargar)="descargar(reporte, $event)">
              <a class="botón-texto" [routerLink]="['/gestion/reportes', reporte.identificador]">Abrir en vista dedicada</a>
              <details class="detalle-ajuste" [open]="ajusteAbierto()" (toggle)="ajusteAbierto.set($any($event.target).open)">
                <summary>Ajustar columnas, filtros, periodo y salida</summary>
                <clb-ajuste-reporte-v2 [especificacion]="$any(reporte.especificacion)" [ocupado]="estado.ocupado() === 'reporte'"
                  (actualizar)="ajustar($event)" />
              </details>
              <details><summary>Detalle técnico</summary>
                <h3>Especificación validada</h3>
                <pre>{{ reporte.especificacion | json }}</pre>
                @if (reporte.salida_modelo) { <h3>Salida cruda del modelo</h3><pre>{{ reporte.salida_modelo }}</pre> }
              </details>
            </clb-resultado-reporte>
          } @else if ($any(reporte.especificacion).destino === "HISTORIAL") {
            <p class="mensaje-administracion" role="status">«{{ reporte.especificacion.titulo }}» se guardó en el historial.</p>
          } @else {
            <div class="reporte-panel">
              <div class="reporte-grafico">
                <h2>{{ reporte.especificacion.titulo }}</h2>
                <p class="meta">{{ reporte.interpretacion ?? $any(periodos)[$any(reporte.especificacion).periodo] }}</p>
                <p class="meta">Datos al {{ reporte.datos_al ? (reporte.datos_al | date: "dd/MM/yyyy HH:mm") : "—" }}</p>
                @let minutos = antiguedad(reporte);
                @if (minutos === null) {
                  <p class="aviso-datos" role="status">Todavía no llegaron datos de ventas al modelo de lectura: las cifras pueden estar vacías.</p>
                } @else if (minutos > minutosDesactualizado) {
                  <p class="aviso-datos" role="status">Los datos tienen {{ minutos }} min de antigüedad. La sincronización corre cada 20 s;
                    si Ventas o Inventario están detenidos, las ventas recientes no aparecen todavía.</p>
                }
                @if ($any(reporte.datos).pedidos === 0) {
                  <p class="estado-vacio-gestion">No hubo ventas confirmadas en ese periodo con esos filtros. Amplía el periodo o quita filtros en «Ajustar».</p>
                } @else {
                  <clb-grafico-reporte [datos]="$any(reporte.datos)" [visualizacion]="$any(reporte.especificacion).visualizacion" [grupo]="grupo(reporte)" />
                }
              </div>
              <aside class="reporte-especificacion">
                <span class="etiqueta-estado" [attr.data-tono]="procedencia(reporte).tono">{{ procedencia(reporte).texto }}</span>
                @if (reporte.observacion) { <p class="nota-agente">{{ reporte.observacion }}</p> }
                <div class="acciones-especificacion">
                  <button class="botón-principal" (click)="estado.descargar(reporte, 'excel')" [disabled]="!!estado.ocupado()">Exportar a Excel</button>
                  <button class="botón-secundario" (click)="estado.descargar(reporte, 'pdf')" [disabled]="!!estado.ocupado()">Exportar a PDF</button>
                  <a class="botón-texto" [routerLink]="['/gestion/reportes', reporte.identificador]">Abrir en vista dedicada</a>
                </div>
                <details class="detalle-ajuste" [open]="ajusteAbierto()" (toggle)="ajusteAbierto.set($any($event.target).open)">
                  <summary>Ajustar columnas, filtros y periodo</summary>
                  <clb-ajuste-reporte [especificacion]="$any(reporte.especificacion)" [ocupado]="estado.ocupado() === 'reporte'" (actualizar)="ajustar($event)" />
                </details>
                <details><summary>Detalle técnico</summary>
                  <h3>Especificación validada</h3>
                  <pre>{{ reporte.especificacion | json }}</pre>
                  @if (reporte.salida_modelo) { <h3>Salida cruda del modelo</h3><pre>{{ reporte.salida_modelo }}</pre> }
                </details>
              </aside>
            </div>
          }
        }

        <h2 class="subtitulo-gestion">Historial</h2>
        @if (estado.historial().length) {
          <div class="tabla-administracion"><table>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Reporte</th><th scope="col">Formato</th><th scope="col">Origen</th><th scope="col"><span class="saltar">Acciones</span></th></tr></thead>
            <tbody>
              @for (r of estado.historial(); track r.identificador) {
                <tr>
                  <td class="fecha">{{ r.fecha | date: "dd/MM HH:mm" }}</td>
                  <td><strong>{{ r.especificacion.titulo }}</strong>@if (r.peticion) {<small>«{{ r.peticion }}»</small>}</td>
                  <td>{{ formatoHistorial(r) }}</td>
                  <td>{{ procedencia(r).corto }}</td>
                  <td class="acciones-fila"><a class="botón-texto" [routerLink]="['/gestion/reportes', r.identificador]">Ver</a>
                    @for (f of archivos(r); track f) {
                      <button class="botón-texto" (click)="descargar(r, f)">{{ f === "PDF" ? "PDF" : "Excel" }}</button>
                    }</td>
                </tr>
              }
            </tbody>
          </table></div>
        } @else {
          <p class="estado-vacio-gestion">Todavía no hay reportes. Prueba con una de las sugerencias: el resultado queda guardado aquí con su especificación.</p>
        }
      }

      @case ("inventario") {
        <div class="encabezado-seccion">
          <h2>Stock bajo</h2>
          <button class="botón-secundario" [disabled]="!!estado.ocupado()" (click)="pedirReposicion()">
            {{ estado.ocupado() === "mision" ? "El agente está revisando…" : "Pedir propuestas al agente" }}</button>
        </div>
        @if (estado.stockBajo().length) {
          <div class="tabla-administracion"><table>
            <thead><tr><th scope="col">Variante</th><th scope="col">Talla / color</th><th scope="col" class="numero">Disponible</th><th scope="col" class="numero">Mínimo</th></tr></thead>
            <tbody>@for (v of estado.stockBajo(); track v.identificador) {
              <tr><td><strong>{{ v.nombre }}</strong><small>{{ v.sku }}</small></td><td>{{ v.talla }} · {{ v.color }}</td>
                <td class="numero" [class.agotado]="v.disponible === 0">{{ v.disponible }}</td><td class="numero">{{ v.minimo }}</td></tr>
            }</tbody>
          </table></div>
        } @else { <p class="estado-vacio-gestion">Ninguna variante está en su mínimo o por debajo.</p> }

        <h2 class="subtitulo-gestion">Registrar recepción de mercadería</h2>
        <p class="nota-agente">El agente de Inventario propone cantidades de reposición. Confirma el ingreso físico únicamente cuando hayas recibido esas unidades: se registrará una entrada y aumentará el stock.</p>
        @for (p of estado.propuestas(); track p.identificador) {
          <div class="propuesta">
            <div><strong>+{{ p.cantidad }} unidades · {{ p.sku }}</strong>
              <small>Hoy: {{ p.disponible ?? "—" }} disponibles, mínimo {{ p.minimo ?? "—" }} · propuesta del {{ p.fecha | date: "dd/MM HH:mm" }}</small>
              <small>Motivo (texto del agente, no verificado): «{{ p.motivo }}»</small>
              @if (p.estado === "CONFIRMANDO") { <small>Ingreso físico enviado sin respuesta de Inventario: reintentar consulta la misma entrada sin duplicarla.</small> }
              @if (p.estado === "REQUIERE_REVISION") { <small>Inventario la rechazó (el stock cambió). Recházala y pide una propuesta nueva.</small> }
            </div>
            <div class="acciones-fila">
              @if (p.estado !== "REQUIERE_REVISION") {
                <button class="botón-principal" [disabled]="!!estado.ocupado()" (click)="resolver(p, 'confirmar')">{{ p.estado === "CONFIRMANDO" ? "Reintentar ingreso físico" : "Confirmar ingreso físico" }}</button>
              }
              @if (p.estado !== "CONFIRMANDO") {
                <button class="botón-texto" [disabled]="!!estado.ocupado()" (click)="resolver(p, 'rechazar')">Rechazar</button>
              }
            </div>
          </div>
        } @empty { <p class="estado-vacio-gestion">No hay propuestas pendientes.</p> }

        <h2 class="subtitulo-gestion">Alertas recibidas de Inventario</h2>
        @if (estado.alertas().length) {
          <div class="tabla-administracion"><table>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Variante</th><th scope="col" class="numero">Disponible al cruzar</th><th scope="col" class="numero">Mínimo</th></tr></thead>
            <tbody>@for (a of estado.alertas(); track $index) {
              <tr><td class="fecha">{{ a.fecha | date: "dd/MM HH:mm" }}</td><td><strong>{{ a.nombre }}</strong><small>{{ a.sku }}</small></td>
                <td class="numero">{{ a.disponible }}</td><td class="numero">{{ a.minimo }}</td></tr>
            }</tbody>
          </table></div>
        } @else { <p class="estado-vacio-gestion">Sin alertas de stock bajo.</p> }
      }

      @case ("clientes") {
        @if (estado.segmentacion(); as s) {
          @if (s.segmentos.length) {
            <p class="meta">K-Means sobre {{ s.clientes }} clientes (recencia, frecuencia, gasto y variedad de categorías) ·
              calidad de la separación (silueta) {{ s.silueta ?? "—" }} · datos al {{ s.datosAl | date: "dd/MM/yyyy HH:mm" }}</p>
            <ol class="segmentos">
              @for (g of s.segmentos; track g.grupo) {
                <li><div class="cabecera-segmento"><h2>{{ g.nombre }}</h2><span>{{ g.clientes }} {{ g.clientes === 1 ? "cliente" : "clientes" }}</span></div>
                  <p>{{ g.descripcion }}</p></li>
              }
            </ol>
            <p class="nota-agente">Los grupos no tienen etiquetas previas: el nombre sale de comparar cada centro de grupo con reglas de negocio
              (30 días sin comprar = inactivo; 4 o más pedidos = frecuente; gasto comparado con la mediana).</p>
          } @else {
            <p class="estado-vacio-gestion">Aún no hay suficientes clientes con compras para segmentar ({{ s.clientes }} de 3 como mínimo).</p>
          }
        }
      }

      @case ("auditoria") {
        <p class="nota-agente">Cada misión, cada herramienta invocada y cada intento rechazado (fuera de la lista blanca o con cifras
          no verificadas) queda registrado.</p>
        <div class="tabla-administracion"><table>
          <thead><tr><th scope="col">Fecha</th><th scope="col">Agente</th><th scope="col">Herramienta</th><th scope="col">Resultado</th></tr></thead>
          <tbody>@for (a of estado.auditoria(); track a.identificador) {
            <tr><td class="fecha">{{ a.fecha | date: "dd/MM HH:mm:ss" }}</td><td>{{ a.agente }}</td>
              <td><code>{{ a.herramienta }}</code><small>{{ a.argumentos | json }}</small></td>
              <td><span class="etiqueta-estado" [attr.data-tono]="a.permitido ? 'ok' : 'alerta'">{{ a.permitido ? "Permitida" : "Rechazada" }}</span>
                <small>{{ a.resultado }}</small></td></tr>
          }</tbody>
        </table></div>
      }
    }
    </div>
  </section>`,
})
export class PaginaGestion implements OnInit {
  protected readonly estado = inject(EstadoGestion);
  private readonly ruta = inject(ActivatedRoute);
  private readonly enrutador = inject(Router);
  private readonly cicloVoz = new AbortController();
  protected readonly secciones = SECCIONES;
  protected readonly sugerencias = SUGERENCIAS;
  protected readonly nombres = NOMBRES_AGENTE;
  protected readonly periodos = PERIODOS;
  protected readonly seccion = signal<Seccion>("monitoreo");
  protected readonly misionTexto = signal("");
  protected readonly peticion = signal("");
  protected readonly salidas = SALIDAS;
  /** La última elección explícita de salida en la pantalla prevalece sobre lo que diga la petición. */
  protected readonly salida = signal("auto");
  protected readonly esV2 = esV2;
  protected readonly ajusteAbierto = signal(false);
  protected readonly minutosDesactualizado = MINUTOS_DESACTUALIZADO;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cicloVoz.abort();
      this.estado.cancelarGrabacion();
    });
  }

  ngOnInit(): void {
    const pedida = this.ruta.snapshot.queryParamMap.get("seccion") as Seccion | null;
    void this.abrir(SECCIONES.some(s => s.id === pedida) ? pedida! : "monitoreo");
  }

  protected async abrir(seccion: Seccion): Promise<void> {
    this.seccion.set(seccion);
    this.estado.aviso.set("");
    void this.enrutador.navigate([], { queryParams: { seccion }, replaceUrl: true });
    if (seccion === "monitoreo") await this.estado.cargarNotificaciones();
    if (seccion === "reportes") await this.estado.cargarHistorial();
    if (seccion === "inventario") await this.estado.cargarInventario();
    if (seccion === "clientes") await this.estado.cargarSegmentos();
    if (seccion === "auditoria") await this.estado.cargarAuditoria();
  }

  protected monitorear(): Promise<void> {
    return this.estado.ejecutarMision("Monitorea mi negocio");
  }

  protected misionLibre(): Promise<void> {
    return this.estado.ejecutarMision(this.misionTexto().trim());
  }

  protected async pedirReposicion(): Promise<void> {
    await this.estado.ejecutarMision(MISION_REPOSICION);
    await this.estado.cargarInventario();
  }

  protected async generar(): Promise<void> {
    const formatos = SALIDAS.find(s => s.id === this.salida())?.formatos;
    await this.estado.generarReporte({ peticion: this.peticion().trim(), ...(formatos ? { formatos } : {}) });
  }

  /** Regenera con la especificación editada: el servidor la valida igual que una interpretada y la marca como manual. */
  protected async ajustar(especificacion: Especificacion | EspecificacionV2): Promise<void> {
    await this.estado.generarReporte({ especificacion });
  }

  protected descargar(reporte: Reporte, formato: "PDF" | "EXCEL"): Promise<void> {
    return this.estado.descargar(reporte, formato === "PDF" ? "pdf" : "excel");
  }

  protected procedencia(reporte: Reporte): { texto: string; corto: string; tono: string } {
    return PROCEDENCIAS[procedenciaDe(reporte)];
  }

  /** Solo los archivos que el reporte ofrece (los pedidos; ambos si no se pidió ninguno, también en el historial v1). */
  protected archivos(reporte: Reporte): ("PDF" | "EXCEL")[] {
    if (!esV2(reporte.especificacion)) return ["EXCEL", "PDF"];
    const pedidos = reporte.especificacion.formatos.filter((f): f is "PDF" | "EXCEL" => f !== "PANTALLA");
    return pedidos.length ? pedidos : ["EXCEL", "PDF"];
  }

  protected formatoHistorial(reporte: Reporte): string {
    const e = reporte.especificacion;
    if (!esV2(e)) return `${e.visualizacion.toLowerCase()} · ${e.destino.toLowerCase()}`;
    const nombres: Record<Formato, string> = { PANTALLA: "pantalla", PDF: "PDF", EXCEL: "Excel" };
    return (e.tipo === "DETALLE" ? "detalle" : "totales") + " · " + (e.formatos.length ? e.formatos.map(f => nombres[f]).join(" + ") : "pantalla");
  }

  protected antiguedad(reporte: Reporte): number | null {
    return minutosDesde(reporte.datos_al);
  }

  protected etiquetaVoz(): string {
    switch (this.estado.ocupado()) {
      case "microfono": return "Solicitando micrófono…";
      case "grabando": return "Detener y transcribir";
      case "voz": return "Transcribiendo…";
      default: return "Dictar por voz";
    }
  }

  protected async voz(destino: "mision" | "reporte"): Promise<void> {
    if (this.estado.ocupado() !== "grabando") return this.estado.empezarGrabacion(this.cicloVoz.signal);
    const texto = await this.estado.terminarGrabacion();
    if (!texto.trim() || this.cicloVoz.signal.aborted) return;
    const campo = destino === "mision" ? this.misionTexto : this.peticion;
    campo.set(texto.trim().slice(0, 500));
  }

  protected resolver(propuesta: Propuesta, accion: "confirmar" | "rechazar"): Promise<void> {
    return this.estado.resolver(propuesta, accion);
  }

  protected grupo(reporte: Reporte): string {
    const g = (reporte.especificacion as Especificacion).agrupar_por;
    return g ? g.charAt(0) + g.slice(1).toLowerCase().replace("dia", "día").replace("categoria", "categoría") : "Total";
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }

}
