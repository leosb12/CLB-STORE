import { Component, DestroyRef, effect, inject, input, output, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Producto } from "../../catalogo/dominio/modelos";
import type { TrabajoFotografico } from "../dominio/trabajo-fotografico";
import type { InformeCalidad } from "../../catalogo/dominio/recurso-probador";
import { ADMINISTRACION_REST } from "../adaptadores/administracion-rest";

const UUID = /^[a-f0-9-]{36}$/;
/** Claves de carga y publicación guardadas juntas por producto; las de una versión anterior (texto suelto) se ignoran. */
function claves(producto: string): { carga: string; publicar: string } | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(`clb_foto_${producto}`) ?? "null");
    return UUID.test(c?.carga) && UUID.test(c?.publicar) ? c : null;
  } catch { return null; }
}
/** Cerrar sesión: el siguiente administrador de esta pestaña no hereda trabajos ni claves. */
export function borrarClavesFotografia(): void {
  for (const k of Object.keys(sessionStorage)) if (k.startsWith("clb_foto_")) sessionStorage.removeItem(k);
}

/** Preparación conectada al servidor local. Nunca sube fotos personales del probador. */
@Component({
  selector: "clb-panel-fotografia",
  imports: [FormsModule],
  template: `<section class="panel-fotografia" aria-labelledby="titulo-fotografia">
    <header>
      <h2 id="titulo-fotografia">Fotografía para el probador</h2>
      <p class="producto-fotografia">{{producto().nombre}} <span>· {{producto().sku}}</span></p>
      <p class="instruccion-fotografia">Cada foto pasa un control de calidad antes de publicarse. Para que la prenda no se deforme al probarla:</p>
      <ul class="guia-fotografia">
        <li>Una sola prenda, extendida y de frente, sin maniquí ni persona.</li>
        <li>Fondo liso de un color distinto al de la prenda y sin sombras.</li>
        <li>Margen alrededor: la prenda no debe tocar el borde de la foto.</li>
        <li>Mangas o perneras separadas del cuerpo de la prenda.</li>
        <li>Al menos 500 px en el lado menor de la prenda.</li>
      </ul>
    </header>
    @if (!categoriaPermitida) {
      <p class="disponibilidad-fotografia" role="status">Selecciona una categoría superior, inferior o de cuerpo completo para preparar esta fotografía.</p>
    } @else if (!habilitado()) {
      <p class="disponibilidad-fotografia" role="status">{{estadoServicio()}}</p>
      <button class="botón-texto" type="button" (click)="consultarServicio()">Comprobar disponibilidad</button>
    }
    <div class="contenido-fotografia">
      <form class="campos-fotografia" (ngSubmit)="preparar()">
        <label for="archivo-fotografia">Fotografía de la prenda</label>
        <input #entradaArchivo id="archivo-fotografia" type="file" accept="image/jpeg,image/png" aria-describedby="ayuda-archivo-fotografia" [disabled]="ocupado() || !habilitado() || !categoriaPermitida" (change)="seleccionar($event)" />
        <p id="ayuda-archivo-fotografia" class="ayuda-fotografia">JPG o PNG · hasta 10 MiB. Se eliminará el fondo automáticamente.</p>
        <div class="color-fotografia">
          <label for="color-fotografia">Color representado</label>
          <input id="color-fotografia" name="colorFotografia" [(ngModel)]="color" maxlength="80" placeholder="Por ejemplo, Rojo" aria-describedby="ayuda-color-fotografia" [disabled]="ocupado() || enviado || !habilitado() || !categoriaPermitida" />
          <p id="ayuda-color-fotografia" class="ayuda-fotografia">Indica el color de la foto. No se aplicará a variantes de otro color.</p>
        </div>
        @if (!trabajo()) { <div class="acciones-fotografia">
          <button class="botón-secundario" type="submit" [disabled]="!archivo || !color.trim() || ocupado() || !habilitado() || !categoriaPermitida">{{ocupado() ? 'Enviando…' : enviado ? 'Reintentar envío' : 'Preparar fotografía'}}</button>
        </div> }
        <p class="ayuda-fotografia">Necesitas conexión con la tienda para prepararla. Las fotografías generadas y guardadas pueden abrirse sin red; una nueva generación requiere conexión al servidor de imágenes.</p>
        @if (trabajo(); as t) {
          <div class="resultado-fotografia" [attr.data-nivel]="t.calidad?.nivel ?? null">
            <!-- Con informe de calidad, los motivos se listan abajo: el mensaje no se repite. -->
            <p role="status"><strong>{{nombreEstado(t.estado)}}</strong>@if (t.mensaje && !(t.calidad && t.estado === 'REQUIERE_REVISION')) { <span>{{t.mensaje}}</span> }</p>
            @if (t.estado === 'PENDIENTE' || t.estado === 'PROCESANDO') {
              <ol class="etapas-fotografia" aria-label="Etapas de la preparación">
                <li [attr.data-hecha]="t.estado === 'PROCESANDO' || null">Foto recibida</li>
                <li [attr.data-actual]="t.estado === 'PROCESANDO' || null">Quitar el fondo y medir la calidad</li>
                <li>Construir el modelo 3D y la espalda</li>
              </ol>
            }
            @if (t.calidad; as c) {
              <section class="informe-calidad" aria-labelledby="titulo-calidad">
                <h3 id="titulo-calidad">Control de calidad: <span class="nivel-calidad">{{nombreNivel(c.nivel)}}</span>
                  @if (c.nivel !== 'no_apta') { <span class="puntuacion-calidad">{{c.puntuacion}}/100</span> }</h3>
                @if (problemas(c).length) {
                  <ul class="comprobaciones">
                    @for (x of problemas(c); track x.codigo) {
                      <li [attr.data-nivel]="x.nivel"><span class="marca" aria-hidden="true"></span>
                        <span><strong>{{x.nivel === 'bloqueo' ? 'Impide publicar' : 'Aviso'}}:</strong> {{x.mensaje}}
                          @if (x.valor !== null) { <small>Medido {{x.valor}} · objetivo {{x.umbral}}</small> }</span></li>
                    }
                  </ul>
                }
                @if (superadas(c).length) {
                  <details><summary>{{superadas(c).length}} comprobaciones superadas</summary>
                    <ul class="comprobaciones">
                      @for (x of superadas(c); track x.codigo) { <li data-nivel="ok"><span class="marca" aria-hidden="true"></span><span>{{x.mensaje}}</span></li> }
                    </ul>
                  </details>
                }
              </section>
            }
            @if (t.estado === 'LISTO') {
              <p>Revisa en la vista previa que la prenda esté completa, sin fondo y con su color ({{t.color}}).
                {{tieneEspalda(t) ? 'Se generó también la espalda para la realidad aumentada.' : 'Esta prenda no tendrá realidad aumentada; sí fotografía con IA.'}}</p>
              @if (t.calidad?.nivel === 'con_avisos') {
                <label class="aceptar-avisos"><input type="checkbox" [(ngModel)]="aceptarAvisos" name="aceptarAvisos" />
                  Entiendo los avisos: la prenda se publicará marcada como de calidad limitada.</label>
              }
              <button class="botón-principal" type="button" [disabled]="ocupado() || (t.calidad?.nivel === 'con_avisos' && !aceptarAvisos)" (click)="publicar()">
                {{t.calidad?.nivel === 'con_avisos' ? 'Publicar con avisos' : 'Publicar fotografía'}}</button>
            }
            @if (t.estado === 'REQUIERE_REVISION' || t.estado === 'ERROR') {
              <p>{{t.calidad ? 'Corrige lo marcado y prepara otra foto: esta no se puede publicar.' : 'Prepara otra fotografía para volver a intentarlo.'}}</p>
              <button class="botón-secundario" type="button" (click)="entradaArchivo.click()">Elegir otra fotografía</button>
            }
            @if (t.estado !== 'PUBLICADO') {
              <button class="botón-texto" type="button" [disabled]="ocupado()" (click)="actualizar()">Actualizar estado</button>
            }
          </div>
        }
        @if (error()) { <p class="aviso-error" role="alert">{{error()}}</p> }
      </form>
      <figure class="vista-fotografia" aria-labelledby="titulo-vista-fotografia">
        <figcaption id="titulo-vista-fotografia">Vista previa</figcaption>
        <div class="marco-fotografia">
          @if (imagenPrevia()) {
            <img [src]="imagenPrevia()" src="/prendas/polera-gris.png" alt="Fotografía preparada de la prenda" width="320" height="360" />
          } @else {
            <p>{{trabajo()?.estado === 'PROCESANDO' ? 'Estamos preparando la prenda…' : 'La prenda sin fondo aparecerá aquí después de prepararla.'}}</p>
          }
        </div>
        <p class="ayuda-fotografia">Revisa que el diseño, el color y la prenda completa se conserven en la referencia preparada.</p>
      </figure>
    </div>
  </section>`,
  styles: [`
    :host { display: block; margin-block: 24px 32px; }
    .panel-fotografia { padding: clamp(20px, 3vw, 32px); border: 1px solid var(--borde); background: #fff; }
    header { display: grid; gap: 12px; margin-bottom: 28px; }
    .panel-fotografia h2 { margin: 0; font: 28px/1.3 Georgia, serif; }
    .panel-fotografia p { margin: 0; max-width: 70ch; font-size: 14px; line-height: 1.6; }
    .producto-fotografia { font-weight: 600; overflow-wrap: anywhere; }
    .producto-fotografia span { font-weight: 400; color: #465948; }
    .instruccion-fotografia { color: #465948; }
    .contenido-fotografia { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, .65fr); gap: 40px; align-items: start; }
    .campos-fotografia { display: grid; gap: 12px; min-width: 0; max-width: 42rem; }
    label, figcaption { font-size: 14px; font-weight: 600; line-height: 1.5; }
    input { width: 100%; min-width: 0; min-height: 48px; padding: 12px; border: 1px solid #b8c5ba; background: #fbfcf8; color: #243d2d; border-radius: 0; font: inherit; }
    input[type=file] { padding: 8px; font-size: 14px; }
    input::file-selector-button { min-height: 40px; margin-right: 12px; padding: 8px 12px; border: 1px solid #b8c5ba; background: white; color: var(--verde); font: inherit; cursor: pointer; }
    input::placeholder { color: #526458; }
    input:focus-visible { outline: 2px solid var(--verde); outline-offset: 3px; }
    .panel-fotografia .ayuda-fotografia { color: #465948; font-size: 13px; }
    .color-fotografia { display: grid; gap: 8px; margin-top: 12px; }
    .acciones-fotografia { margin-top: 12px; }
    button { min-height: 44px; white-space: normal; }
    .resultado-fotografia { display: grid; justify-items: start; gap: 16px; border-top: 1px solid var(--borde); padding-top: 24px; margin-top: 12px; }
    .resultado-fotografia [role=status] { display: grid; gap: 8px; }
    .disponibilidad-fotografia { padding: 16px; background: #f2f4ed; margin-bottom: 20px !important; }
    .guia-fotografia { margin: 0; padding-left: 20px; display: grid; gap: 4px; max-width: 70ch; font-size: 14px; line-height: 1.5; color: #243d2d; }
    .etapas-fotografia { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; font-size: 14px; color: #6b7a6f; }
    .etapas-fotografia li { display: flex; gap: 10px; align-items: center; }
    .etapas-fotografia li::before { content: ""; width: 10px; height: 10px; border: 1px solid #9aa79c; border-radius: 50%; flex: none; }
    .etapas-fotografia li[data-hecha] { color: #243d2d; }
    .etapas-fotografia li[data-hecha]::before { background: var(--verde); border-color: var(--verde); }
    .etapas-fotografia li[data-actual] { color: var(--verde); font-weight: 600; }
    .etapas-fotografia li[data-actual]::before { border: 2px solid var(--verde); animation: latido 1.2s ease-in-out infinite; }
    @keyframes latido { 50% { transform: scale(1.35); } }
    @media (prefers-reduced-motion: reduce) { .etapas-fotografia li[data-actual]::before { animation: none; } }
    .informe-calidad { width: 100%; display: grid; gap: 12px; padding: 16px 18px; border: 1px solid var(--borde); background: #f8f9f5; }
    .informe-calidad h3 { margin: 0; font-size: 15px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
    .nivel-calidad { color: var(--verde); }
    [data-nivel=con_avisos] .nivel-calidad { color: #8a5a12; }
    [data-nivel=no_apta] .nivel-calidad { color: #8a2f22; }
    [data-nivel=con_avisos] .informe-calidad { border-color: #d9b878; background: #fbf6ea; }
    [data-nivel=no_apta] .informe-calidad { border-color: #d7a49b; background: #fbefec; }
    .puntuacion-calidad { font-weight: 400; color: #465948; font-variant-numeric: tabular-nums; }
    .comprobaciones { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
    .comprobaciones li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; font-size: 14px; line-height: 1.5; }
    .comprobaciones small { display: block; color: #465948; font-size: 12px; font-variant-numeric: tabular-nums; }
    .marca { width: 12px; height: 12px; margin-top: 5px; border-radius: 50%; background: var(--verde); }
    li[data-nivel=aviso] .marca { background: #c08a2e; }
    li[data-nivel=bloqueo] .marca { background: #b0412f; border-radius: 2px; }
    .informe-calidad summary { cursor: pointer; color: var(--verde); font-size: 14px; min-height: 32px; display: flex; align-items: center; }
    .informe-calidad details .comprobaciones { margin-top: 8px; }
    .aceptar-avisos { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; max-width: 60ch; }
    .aceptar-avisos input { width: 18px; height: 18px; min-height: 0; margin-top: 3px; padding: 0; accent-color: var(--verde); flex: none; }
    .vista-fotografia { display: grid; gap: 12px; margin: 0; min-width: 0; }
    .marco-fotografia { min-height: 280px; display: grid; place-items: center; padding: 24px; background: #f8f9f5; border: 1px solid var(--borde); }
    .marco-fotografia p { text-align: center; color: #465948; max-width: 28ch; }
    img { display: block; object-fit: contain; width: 100%; max-width: 320px; height: 360px; }
    @media (max-width: 760px) {
      .contenido-fotografia { grid-template-columns: minmax(0, 1fr); gap: 32px; }
      .panel-fotografia h2 { font-size: 24px; }
      .acciones-fotografia button { width: 100%; }
    }
  `],
})
export class PanelFotografia {
  readonly producto = input.required<Producto>();
  readonly publicado = output<void>();
  private readonly remoto = inject(ADMINISTRACION_REST);
  readonly trabajo = signal<TrabajoFotografico | undefined>(undefined);
  readonly imagenPrevia = signal("");
  readonly error = signal("");
  readonly ocupado = signal(false);
  readonly habilitado = signal(false);
  readonly estadoServicio = signal("Comprobando disponibilidad de la preparación…");
  archivo?: File;
  color = "";
  aceptarAvisos = false;
  enviado = false;
  private clave: string = crypto.randomUUID();
  private clavePublicar: string = crypto.randomUUID();
  private turno = 0;
  private cerrado = false;
  private versionCarga = 0;

  constructor() {
    void this.consultarServicio();
    effect(() => {
      const p = this.producto();
      untracked(() => {
      this.turno++; this.ocupado.set(false);
      this.archivo = undefined; this.color = ""; this.enviado = false; this.trabajo.set(undefined); this.error.set("");
      this.liberar();
      // Misma pareja de Idempotency-Key tras recargar: un reintento cuya respuesta se perdió no publica dos veces.
      const guardadas = claves(p.identificador);
      this.clavePublicar = guardadas?.publicar ?? crypto.randomUUID();
      if (guardadas) { this.clave = guardadas.carga; void this.actualizar(); }
      });
    });
    const reloj = setInterval(() => {
      if (["PENDIENTE","PROCESANDO"].includes(this.trabajo()?.estado ?? "") && !this.ocupado()) void this.actualizar();
    },3000);
    inject(DestroyRef).onDestroy(() => { this.cerrado = true; this.turno++; clearInterval(reloj); this.liberar(); });
  }

  get categoriaPermitida(): boolean {
    return ["poleras", "polera", "camisas", "camisa", "camisetas", "camiseta", "chaqueta", "chaquetas", "suéter", "sueter", "suéteres", "sueteres", "buzo", "buzos", "polerón", "poleron", "polerones", "abrigo", "abrigos", "pantalón", "pantalon", "pantalones", "jean", "jeans", "falda", "faldas", "short", "shorts", "vestido", "vestidos", "enterizo", "superior", "inferior", "cuerpo completo"].includes(this.producto()['categoría'].trim().toLocaleLowerCase());
  }

  async consultarServicio(): Promise<void> {
    try {
      const habilitado = await this.remoto.capacidadFotografica();
      if (this.cerrado) return;
      this.habilitado.set(habilitado);
      this.estadoServicio.set(habilitado ? "" : "La preparación de fotografías no está activada en esta tienda. Puedes seguir usando las prendas existentes.");
    } catch {
      if (!this.cerrado) this.estadoServicio.set("No se pudo comprobar la preparación. Verifica la conexión con la tienda y vuelve a intentarlo.");
    }
  }

  nombreEstado(estado: TrabajoFotografico["estado"]): string {
    return { PENDIENTE: "Fotografía recibida", PROCESANDO: "Preparando la prenda…", LISTO: "Lista para revisar", REQUIERE_REVISION: "Necesitamos otra fotografía", ERROR: "No se pudo preparar", PUBLICADO: "Fotografía publicada" }[estado];
  }

  nombreNivel(nivel: InformeCalidad["nivel"]): string {
    return { apta: "cumple el estándar", con_avisos: "cumple con avisos", no_apta: "no cumple el estándar" }[nivel];
  }
  /** Lo que impide publicar primero; después los avisos. */
  problemas(c: InformeCalidad) { return [...c.comprobaciones.filter(x => x.nivel === "bloqueo"), ...c.comprobaciones.filter(x => x.nivel === "aviso")]; }
  tieneEspalda(t: TrabajoFotografico): boolean { const r = t.recurso; return r?.esquema === 2 && !!r.espalda; }
  superadas(c: InformeCalidad) { return c.comprobaciones.filter(x => x.nivel === "ok"); }

  private liberar(): void { if (this.imagenPrevia()) URL.revokeObjectURL(this.imagenPrevia()); this.imagenPrevia.set(""); }
  seleccionar(evento: Event): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    this.error.set("");
    if (!archivo || archivo.size > 10*1024*1024 || !["image/jpeg","image/png"].includes(archivo.type)) {
      this.archivo = undefined; this.error.set("Selecciona JPEG o PNG de hasta 10 MiB."); return;
    }
    this.turno++;
    this.archivo = archivo; this.clave = crypto.randomUUID(); this.clavePublicar = crypto.randomUUID(); this.enviado = false;
    this.versionCarga = this.producto().versión_sincronización;
    this.trabajo.set(undefined); this.liberar(); this.aceptarAvisos = false;
  }
  async preparar(): Promise<void> {
    if (!this.archivo || this.ocupado() || this.trabajo() || !this.habilitado() || !this.categoriaPermitida) return;
    const id = this.producto().identificador, turno = this.turno;
    this.ocupado.set(true); this.error.set(""); this.enviado = true;
    sessionStorage.setItem(`clb_foto_${id}`,JSON.stringify({carga:this.clave,publicar:this.clavePublicar}));
    try {
      const t = await this.remoto.cargarFotografia(id,this.clave,this.versionCarga,this.color,this.archivo);
      if (!this.cerrado && turno === this.turno) this.trabajo.set(t);
    } catch (e) { if (!this.cerrado && turno === this.turno) this.error.set(e instanceof Error ? e.message : "No se pudo enviar; reintenta con la misma fotografía."); }
    finally { if (!this.cerrado && turno === this.turno) this.ocupado.set(false); }
  }
  async actualizar(): Promise<void> {
    const id = this.producto().identificador, turno = this.turno;
    try {
      const t = await this.remoto.consultarFotografia(id,this.clave);
      if (this.cerrado || turno !== this.turno) return;
      this.trabajo.set(t);
      if (["LISTO","PUBLICADO"].includes(t.estado) && !this.imagenPrevia()) {
        const blob = await this.remoto.previsualizarFotografia(id,this.clave);
        if (!this.cerrado && turno === this.turno) this.imagenPrevia.set(URL.createObjectURL(blob));
      }
    } catch (e) { if (!this.cerrado && turno === this.turno) this.error.set(e instanceof Error ? e.message : "No se pudo consultar; vuelve a actualizar."); }
  }
  async publicar(): Promise<void> {
    const id = this.producto().identificador, turno = this.turno;
    this.ocupado.set(true); this.error.set("");
    try {
      const avisos = this.trabajo()?.calidad?.nivel === "con_avisos";
      if (avisos && !this.aceptarAvisos) throw new Error("Marca que entiendes los avisos para publicarla.");
      const t = await this.remoto.publicarFotografia(id,this.clave,this.clavePublicar,this.producto().versión_sincronización,avisos);
      if (t.estado === "PUBLICADO") sessionStorage.removeItem(`clb_foto_${id}`);
      if (!this.cerrado && turno === this.turno) { this.trabajo.set(t); this.publicado.emit(); }
    } catch (e) { if (!this.cerrado && turno === this.turno) this.error.set(e instanceof Error ? e.message : "No se pudo publicar; actualiza el estado."); }
    finally { if (!this.cerrado && turno === this.turno) this.ocupado.set(false); }
  }
}
