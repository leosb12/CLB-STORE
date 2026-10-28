import { Component, OnInit, inject, signal } from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { EstadoGestion } from "../aplicacion/estado-gestion";
import { NOMBRES_AGENTE, PERIODOS, type Destino, type Propuesta, type Reporte } from "../dominio/modelos";
import { GraficoReporte } from "./grafico-reporte";

type Seccion = "monitoreo" | "reportes" | "inventario" | "clientes" | "auditoria";

const SECCIONES: { id: Seccion; nombre: string }[] = [
  { id: "monitoreo", nombre: "Monitoreo" }, { id: "reportes", nombre: "Reportes" }, { id: "inventario", nombre: "Inventario" },
  { id: "clientes", nombre: "Clientes" }, { id: "auditoria", nombre: "Auditoría" },
];

const SUGERENCIAS = [
  "Ventas por talla esta semana, barras en el panel",
  "Monto vendido por categoría del mes en una tabla",
  "Evolución diaria de pedidos del mes en líneas",
  "¿Cuánto dinero ingresó hoy?",
];

const MISION_REPOSICION = "Revisa el stock bajo y propone reposiciones para las variantes que lo necesiten.";

@Component({
  selector: "clb-pagina-gestion",
  imports: [DatePipe, JsonPipe, RouterLink, GraficoReporte],
  template: `<section class="gestion">
    <div class="titulo-gestion">
      <h1>Gestión del negocio</h1>
      <p>Cada sección es un agente con sus propias herramientas. Las cifras salen de los datos reales de ventas, inventario y
        clientes; el modelo local solo interpreta y redacta.</p>
    </div>

    <div class="pestanas" role="tablist" aria-label="Agentes de gestión">
      @for (s of secciones; track s.id) {
        <button role="tab" [id]="'pestana-' + s.id" [attr.aria-selected]="seccion() === s.id" [attr.aria-controls]="'panel-' + s.id"
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
                [disabled]="!!estado.ocupado() && estado.ocupado() !== 'grabando'" (click)="voz()"
                [attr.aria-pressed]="estado.ocupado() === 'grabando'">
                {{ estado.ocupado() === "grabando" ? "Detener y transcribir" : estado.ocupado() === "voz" ? "Transcribiendo…" : "Dictar por voz" }}</button>
            }
            <label class="destino">Destino
              <select [value]="destino()" (change)="destino.set(valorDestino($event))">
                <option value="">El que diga la petición</option>
                <option value="PANEL">Panel</option><option value="VISTA">Vista dedicada</option><option value="HISTORIAL">Solo historial</option>
              </select></label>
            <button type="submit" class="botón-principal" [disabled]="!!estado.ocupado() || peticion().trim().length < 3">
              {{ estado.ocupado() === "reporte" ? "Generando…" : "Generar reporte" }}</button>
          </div>
        </form>

        @if (estado.reporte(); as reporte) {
          @if (reporte.especificacion.destino === "HISTORIAL") {
            <p class="mensaje-administracion" role="status">«{{ reporte.especificacion.titulo }}» se guardó en el historial.</p>
          } @else {
            <div class="reporte-panel">
              <div class="reporte-grafico">
                <h2>{{ reporte.especificacion.titulo }}</h2>
                <p class="meta">{{ periodos[reporte.especificacion.periodo] }} · datos al {{ reporte.datos_al | date: "dd/MM/yyyy HH:mm" }}</p>
                <clb-grafico-reporte [datos]="reporte.datos" [visualizacion]="reporte.especificacion.visualizacion" [grupo]="grupo(reporte)" />
              </div>
              <aside class="reporte-especificacion">
                <span class="etiqueta-estado" [attr.data-tono]="reporte.generativa ? 'ok' : 'espera'">{{ reporte.generativa ? "Interpretado por el modelo local" : "Interpretación por palabras clave" }}</span>
                @if (reporte.observacion) { <p class="nota-agente">{{ reporte.observacion }}</p> }
                <h3>Especificación validada</h3>
                <pre>{{ reporte.especificacion | json }}</pre>
                @if (reporte.salida_modelo) {
                  <details><summary>Salida cruda del modelo</summary><pre>{{ reporte.salida_modelo }}</pre></details>
                }
                <div class="acciones-especificacion">
                  <button class="botón-principal" (click)="estado.descargarExcel(reporte)" [disabled]="!!estado.ocupado()">Exportar a Excel</button>
                  <a class="botón-secundario" [routerLink]="['/gestion/reportes', reporte.identificador]">Abrir en vista dedicada</a>
                </div>
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
                  <td>{{ r.especificacion.visualizacion.toLowerCase() }} · {{ r.especificacion.destino.toLowerCase() }}</td>
                  <td>{{ r.generativa ? "Modelo local" : "Palabras clave" }}</td>
                  <td class="acciones-fila"><a class="botón-texto" [routerLink]="['/gestion/reportes', r.identificador]">Ver</a>
                    <button class="botón-texto" (click)="estado.descargarExcel(r)">Excel</button></td>
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
  protected readonly secciones = SECCIONES;
  protected readonly sugerencias = SUGERENCIAS;
  protected readonly nombres = NOMBRES_AGENTE;
  protected readonly periodos = PERIODOS;
  protected readonly seccion = signal<Seccion>("monitoreo");
  protected readonly misionTexto = signal("");
  protected readonly peticion = signal("");
  protected readonly destino = signal<Destino | "">("");

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
    const reporte = await this.estado.generarReporte({ peticion: this.peticion().trim(), ...(this.destino() ? { destino: this.destino() as Destino } : {}) });
    if (reporte?.especificacion.destino === "VISTA") await this.enrutador.navigate(["/gestion/reportes", reporte.identificador]);
  }

  protected async voz(): Promise<void> {
    if (this.estado.ocupado() !== "grabando") return this.estado.empezarGrabacion();
    const texto = await this.estado.terminarGrabacion();
    if (texto) this.peticion.set(texto);
  }

  protected resolver(propuesta: Propuesta, accion: "confirmar" | "rechazar"): Promise<void> {
    return this.estado.resolver(propuesta, accion);
  }

  protected grupo(reporte: Reporte): string {
    const g = reporte.especificacion.agrupar_por;
    return g ? g.charAt(0) + g.slice(1).toLowerCase().replace("dia", "día").replace("categoria", "categoría") : "Total";
  }

  protected valor(evento: Event): string {
    return (evento.target as HTMLInputElement).value;
  }

  protected valorDestino(evento: Event): Destino | "" {
    return (evento.target as HTMLSelectElement).value as Destino | "";
  }
}
