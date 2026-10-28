/**
 * Entrada del microfrontend: registra <clb-probador> y exporta `precargar()` y `borrarDatosPrivados()`. Es el adaptador de integración con el shell
 * (contrato en `dominio/contrato.ts`); el resto del probador no sabe que vive dentro de Angular.
 */
import { createRoot, type Root } from "react-dom/client";
import { EVENTO_RENDIMIENTO, EVENTO_RESULTADO, type ModoProbador, type RendimientoProbador, type PrendaProbador, type ResultadoProbador } from "../dominio/contrato";
import { ProbarPrenda } from "../aplicacion/casos-de-uso";
import { Probador, type Servicios } from "../presentacion/probador";
import { LimiteDeError } from "../presentacion/limite-de-error";
import { DetectorMoveNet } from "./detector-movenet";
import {SegmentadorCamiseta} from './segmentador-camiseta';
import {VideoMaterialLocal} from './video-material';
import { ModeloTallasRest, RegistroLocal } from "./almacenamiento-local";
import estilos from "../presentacion/estilos.css?inline";
import { ColaFotografica, type SesionProbador } from '../aplicacion/probador-fotografico';
import { huellaSha256, ProbadorFotograficoRest } from './probador-fotografico-rest';
import { AlmacenSolicitudesIndexedDb } from './almacen-solicitudes-indexeddb';
import { DetectorBlazePose } from "./detector-blazepose";
import { MotorRA } from "./motor-ra";
import type { ServiciosRA } from "../presentacion/realidad-aumentada";

// Rutas relativas a este módulo: el probador funciona en cualquier carpeta donde se despliegue (en CLB, /probador/).
const relativa = (ruta: string) => new URL(import.meta.env.DEV ? `/${ruta}` : ruta, import.meta.url).href;
const RUTA_MODELO_POSE = "modelos/movenet-lightning-4/model.json";
const RUTA_MODELOS_BLAZEPOSE = "modelos/blazepose-3d/";
const RUTA_MANIFIESTO = "manifiesto.json";
export const API_TALLAS = "/api/v1/tallas/modelo";

let servicios: Servicios | undefined;
function obtenerServicios(): Servicios {
  if (!servicios) {
    const detector = new DetectorMoveNet(relativa(RUTA_MODELO_POSE));
    const registro = new RegistroLocal();
    servicios = { detector, probar: new ProbarPrenda(detector, registro), modeloTallas: new ModeloTallasRest(API_TALLAS), pruebasRegistradas: () => registro.listar().length,crearSegmentador:()=>new SegmentadorCamiseta(relativa('modelos/selfie-multiclass-1/')),crearCompositorVideo:material=>new VideoMaterialLocal(material) };
  }
  return servicios;
}

let serviciosRA: ServiciosRA | undefined;
function obtenerServiciosRA(): ServiciosRA {
  if (!serviciosRA) {
    serviciosRA = {
      // `full` sigue mejor los giros y el perfil; si el equipo no llega a ~11 img/s se pasa a `lite`.
      seguidor: new DetectorBlazePose(relativa(RUTA_MODELOS_BLAZEPOSE), "full"),
      seguidorLigero: new DetectorBlazePose(relativa(RUTA_MODELOS_BLAZEPOSE), "lite"),
      crearPintor: (lienzo: HTMLCanvasElement) => new MotorRA(lienzo),
    };
  }
  return serviciosRA;
}

/**
 * Descarga (con red) todos los archivos del probador, para que el Service Worker del shell los guarde, y el modelo de
 * tallas, que queda en este dispositivo. No inicia TensorFlow.js. Sin red no hace nada y no falla.
 */
export async function precargar(): Promise<void> {
  try {
    const manifiesto = (await (await fetch(relativa(RUTA_MANIFIESTO), { cache: "no-cache" })).json()) as { archivos?: unknown };
    // Solo archivos de la propia carpeta del probador, aunque el manifiesto traiga otra cosa.
    const base = relativa("./");
    const archivos = Array.isArray(manifiesto.archivos)
      ? manifiesto.archivos.filter((a): a is string => typeof a === "string").map(relativa).filter((url) => url.startsWith(base))
      : [];
    await Promise.allSettled(archivos.map((url) => fetch(url)));
    await obtenerServicios().modeloTallas.obtener();
  } catch {
    /* sin red: se usará lo ya guardado */
  }
}

const solicitudes = new AlmacenSolicitudesIndexedDb();
const colas = new Set<ColaFotografica>();

/** Cierre de sesión del shell: detiene los envíos en curso y retira fotos y resultados de todas las cuentas en este navegador. */
export async function borrarDatosPrivados(): Promise<void> {
  await Promise.all([...colas].map((cola) => cola.borrarDatosLocales()));
  await solicitudes.borrarTodo();
}

/** Una sola pestaña procesa la cola; las demás solo muestran el estado guardado. */
const exclusivo = typeof navigator !== "undefined" && navigator.locks
  ? async (tarea: () => Promise<void>) => { await navigator.locks.request("clb_probador_vton_cola", { ifAvailable: true }, async (bloqueo) => { if (bloqueo) await tarea(); }); }
  : undefined;

class ElementoProbador extends HTMLElement {
  private identidad: SesionProbador = async () => ({titular: null, cabeceras: {}});
  private readonly fotografico = new ColaFotografica(solicitudes, new ProbadorFotograficoRest(), () => this.identidad(),
    { huella: huellaSha256, exclusivo, enLinea: () => navigator.onLine });
  get sesionProbador(): SesionProbador { return this.identidad; }
  set sesionProbador(valor: SesionProbador) { this.identidad = valor; this.pintar(); this.fotografico.sesionCambiada(); }
  private raíz?: Root;
  private datos: PrendaProbador | null = null;
  private lista: PrendaProbador[] = [];
  private permitidos: ModoProbador[] | null = null;

  get prenda(): PrendaProbador | null {
    return this.datos;
  }
  set prenda(valor: PrendaProbador | null) {
    this.datos = valor;
    this.pintar();
  }

  /** Opcional (contrato v1): prendas que se pueden combinar con `prenda` en el probador. */
  get catalogo(): PrendaProbador[] {
    return this.lista;
  }
  set catalogo(valor: PrendaProbador[] | null | undefined) {
    this.lista = Array.isArray(valor) ? valor : [];
    this.pintar();
  }

  /** Opcional (contrato v1): modos que ofrece el probador; sin valor, todos. */
  get modos(): ModoProbador[] | null {
    return this.permitidos;
  }
  set modos(valor: ModoProbador[] | null | undefined) {
    const validos = Array.isArray(valor) ? valor.filter((m): m is ModoProbador => m === "ra" || m === "fotografico" || m === "local") : [];
    this.permitidos = validos.length ? validos : null;
    this.pintar();
  }

  connectedCallback(): void {
    colas.add(this.fotografico);
    if (Object.hasOwn(this, 'sesionProbador')) {
      const valor = this.sesionProbador;
      delete (this as {sesionProbador?: SesionProbador}).sesionProbador;
      this.sesionProbador = valor;
    }
    // Un anfitrión pudo fijar `prenda` o `catalogo` antes de que se definiera el elemento: esa propiedad propia
    // taparía al setter.
    if (Object.hasOwn(this, "prenda")) {
      const valor = (this as { prenda: PrendaProbador | null }).prenda;
      delete (this as { prenda?: unknown }).prenda;
      this.prenda = valor;
    }
    if (Object.hasOwn(this, "catalogo")) {
      const valor = (this as { catalogo: PrendaProbador[] }).catalogo;
      delete (this as { catalogo?: unknown }).catalogo;
      this.catalogo = valor;
    }
    if (Object.hasOwn(this, "modos")) {
      const valor = (this as { modos: ModoProbador[] | null }).modos;
      delete (this as { modos?: unknown }).modos;
      this.modos = valor;
    }
    if (this.raíz) return;
    const sombra = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    const estilo = document.createElement("style");
    estilo.textContent = estilos;
    const contenedor = document.createElement("div");
    sombra.replaceChildren(estilo, contenedor);
    this.raíz = createRoot(contenedor);
    this.pintar();
  }

  disconnectedCallback(): void {
    colas.delete(this.fotografico);
    // Desmontar apaga la cámara (efecto de limpieza del componente).
    this.raíz?.unmount();
    this.raíz = undefined;
  }

  private pintar(): void {
    const emitir = (detalle: ResultadoProbador) => this.dispatchEvent(new CustomEvent(EVENTO_RESULTADO, { detail: detalle, bubbles: true, composed: true }));
    const rendimiento = (detalle: RendimientoProbador) => this.dispatchEvent(new CustomEvent(EVENTO_RENDIMIENTO, { detail: detalle, bubbles: true, composed: true }));
    this.raíz?.render(
      <LimiteDeError>
        <Probador prenda={this.datos} catalogo={this.lista} servicios={obtenerServicios()} serviciosRA={obtenerServiciosRA()} alResultado={emitir} fotografico={this.fotografico} sesionProbador={this.identidad} modos={this.permitidos} alRendimiento={rendimiento} />
      </LimiteDeError>,
    );
  }
}

if (!customElements.get("clb-probador")) customElements.define("clb-probador", ElementoProbador);

/** Diagnóstico de recursos para QA: solo contadores, nunca imágenes ni medidas. */
export function diagnosticoMemoria() { return DetectorMoveNet.diagnosticoMemoria(); }
