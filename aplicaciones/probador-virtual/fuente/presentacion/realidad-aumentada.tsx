import { useEffect, useRef, useState } from "react";
import type { PintorRA, SeguidorCuerpo } from "../aplicacion/casos-de-uso";
import type { PrendaProbador, RendimientoProbador } from "../dominio/contrato";
import { medirCuerpo } from "../dominio/ra/cuerpo";
import { construirEscena } from "../dominio/ra/malla-ra";
import { validarModelo3D, type ModeloPrenda3D } from "../dominio/ra/modelo-prenda";
import { SuavizadorCuerpo } from "../dominio/ra/suavizado";

export interface ServiciosRA {
  seguidor: SeguidorCuerpo;
  /** Respaldo más liviano si el seguidor principal no llega a un ritmo usable en este equipo. */
  seguidorLigero?: SeguidorCuerpo;
  crearPintor(lienzo: HTMLCanvasElement): PintorRA;
}

type Origen = "ninguno" | "camara" | "foto";
export type EstadoRA =
  | { fase: "esperando" }
  | { fase: "preparando" }
  | { fase: "sin-cuerpo" }
  | { fase: "listo"; fps?: number };

const cargar = (src: string) => new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src; });
const MAXIMO = 960;
/** Por encima de esta mediana (ms por estimación, ~11 img/s) se pasa al seguidor ligero. */
const LENTO_MS = 90;

const ARCHIVOS_POR_SKU: Record<string, string> = {
  "CLB-FOTO-POL-GRI": "polera-gris",
  "CLB-FOTO-POL-ROJ": "polera-roja",
  "CLB-FOTO-CAM-NEG": "camisa",
  "CLB-FOTO-CHA-ROJ": "chaqueta-roja",
  "CLB-FOTO-CHA-AZU": "chaqueta-azul",
  "CLB-FOTO-VES-BUR": "vestido",
};

function deducirBasePrenda(prenda: PrendaProbador): string {
  if (prenda.sku && ARCHIVOS_POR_SKU[prenda.sku]) return ARCHIVOS_POR_SKU[prenda.sku];
  for (const c of [prenda.imagenFotografica, prenda.imagen]) {
    const m = c?.match(/([^/]+)\.(png|svg|webp|jpe?g)/i);
    if (m && m[1] && !m[1].startsWith("blob:")) return m[1];
  }
  const nom = (prenda.nombre + " " + prenda.categoría).toLowerCase();
  if (nom.includes("chaqueta") && nom.includes("roja")) return "chaqueta-roja";
  if (nom.includes("chaqueta")) return "chaqueta-azul";
  if (nom.includes("camisa")) return "camisa";
  if (nom.includes("vestido")) return "vestido";
  if (nom.includes("polera") && nom.includes("roja")) return "polera-roja";
  return "polera-gris";
}

interface Recurso3D { modelo: ModeloPrenda3D; frente: HTMLImageElement; espalda: HTMLImageElement }

/** Modelo 3D, frente y espalda de una prenda: el publicado con el recurso o, si no, el del catálogo de demostración. */
async function cargarRecurso(prenda: PrendaProbador): Promise<Recurso3D | null> {
  let modelo = prenda.modelo3d ? validarModelo3D(prenda.modelo3d.modelo) : null;
  let espalda = prenda.modelo3d?.espalda, frente = prenda.imagenFotografica ?? prenda.imagen;
  const base = deducirBasePrenda(prenda);
  if (!modelo) {
    const r = await fetch(`/prendas/${base}.modelo.json`).catch(() => null);
    modelo = r?.ok ? validarModelo3D(await r.json().catch(() => null)) : null;
    espalda = `/prendas/${base}.espalda.png`;
  }
  if (!modelo || !espalda) return null;
  // Si el blob del shell falla, se usa el frente publicado junto al modelo.
  const imagenFrente = await cargar(frente).catch(() => cargar(`/prendas/${base}.png`));
  return { modelo, frente: imagenFrente, espalda: await cargar(espalda) };
}

/**
 * Probador con realidad aumentada: el conjunto de prendas 3D sobre la persona en el video o en una foto, sin enviar
 * imágenes. Un único lienzo WebGL; la cámara se apaga al salir, al ocultar la pestaña o al cambiar el conjunto.
 */
export function usarRealidadAumentada(prendas: PrendaProbador[], servicios: ServiciosRA | undefined, alRendimiento?: (r: RendimientoProbador) => void) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pintor = useRef<PintorRA | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const turno = useRef(0);
  const informar = useRef(alRendimiento);
  informar.current = alRendimiento;
  const seguidor = useRef(servicios?.seguidor);
  const [origen, setOrigen] = useState<Origen>("ninguno");
  const [estado, setEstado] = useState<EstadoRA>({ fase: "esperando" });
  const [aviso, setAviso] = useState("");
  const [recursos, setRecursos] = useState<Recurso3D[] | null>(null);
  /** Última foto analizada: si cambia el conjunto se vuelve a dibujar con las prendas nuevas, sin volver a analizarla. */
  const fotoActual = useRef<{ c: HTMLCanvasElement; obs: NonNullable<Awaited<ReturnType<SeguidorCuerpo["estimar"]>>> } | null>(null);
  const clave = prendas.map((p) => `${p.identificador}:${p.imagenFotografica ?? p.imagen}`).join("|");

  useEffect(() => {
    let vigente = true;
    setRecursos(null);
    setAviso("");
    if (!prendas.length) return;
    void Promise.all(prendas.map((p) => cargarRecurso(p).catch(() => null))).then((lista) => {
      if (!vigente) return;
      const listos = lista.filter((r): r is Recurso3D => !!r);
      if (listos.length < lista.length) setAviso("Alguna prenda todavía no tiene modelo 3D en este dispositivo; se muestran las demás.");
      setRecursos(listos.length ? listos : null);
    });
    // Calentar el seguimiento solo si la vista RA está montada (compila shaders unos segundos).
    if (servicios) void (seguidor.current ?? servicios.seguidor).preparar().catch(() => vigente && setAviso("No se pudo preparar el seguimiento corporal."));
    return () => { vigente = false; };
  }, [clave, servicios]);

  const apagar = () => {
    turno.current++;
    fotoActual.current = null;
    flujo.current?.getTracks().forEach((p) => p.stop());
    flujo.current = null;
    setOrigen("ninguno");
    setEstado({ fase: "esperando" });
  };

  /**
   * Pintor del lienzo visible. Al cambiar de modo React monta otro <canvas>: un pintor del lienzo anterior dibujaría
   * fuera de la página (lienzo negro), así que se rehace y recibe las prendas ya cargadas.
   */
  const lienzoPintor = useRef<HTMLCanvasElement | null>(null);
  const prendasPintadas = useRef<unknown>(null);
  const asegurarPintor = (): PintorRA | null => {
    const c = lienzo.current;
    if (!c || !servicios) return null;
    if (pintor.current && lienzoPintor.current !== c) { pintor.current.destruir(); pintor.current = null; }
    if (!pintor.current) { pintor.current = servicios.crearPintor(c); lienzoPintor.current = c; prendasPintadas.current = null; }
    if (recursos && prendasPintadas.current !== recursos) { pintor.current.ponerPrendas(recursos); prendasPintadas.current = recursos; }
    return pintor.current;
  };
  const modelos = recursos?.map((r) => r.modelo) ?? [];

  useEffect(() => {
    const f = fotoActual.current;
    if (origen !== "foto" || !f || !recursos) return;
    const cuerpo = medirCuerpo(f.obs.puntos, f.obs.mascara);
    if (cuerpo) asegurarPintor()?.dibujar(f.c, f.c.width, f.c.height, f.obs.mascara, construirEscena(recursos.map((r) => r.modelo), cuerpo, f.obs.puntos));
  }, [recursos]);

  useEffect(() => () => { apagar(); pintor.current?.destruir(); pintor.current = null; }, []);
  useEffect(() => {
    const alOcultar = () => { if (document.hidden && flujo.current) apagar(); };
    document.addEventListener("visibilitychange", alOcultar);
    return () => document.removeEventListener("visibilitychange", alOcultar);
  }, []);

  // Bucle de cámara: un análisis a la vez; la prenda se redibuja con el último cuerpo medido en cada cuadro.
  useEffect(() => {
    if (origen !== "camara" || !servicios || !recursos) return;
    let vivo = true;
    const mio = turno.current;
    let animacion = 0, enCurso = false;
    let ultimo: Awaited<ReturnType<SeguidorCuerpo["estimar"]>> = null;
    let escena: ReturnType<typeof construirEscena> | null = null;
    const suavizador = new SuavizadorCuerpo();
    const tiempos: number[] = [], duraciones: number[] = [];
    let recientes: number[] = [], informado = false, medido = seguidor.current ?? servicios.seguidor;
    let ultimoEstado = 0;

    const ciclo = () => {
      if (!vivo || mio !== turno.current) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const escala = Math.min(1, MAXIMO / Math.max(v.videoWidth, v.videoHeight));
        const ancho = Math.round(v.videoWidth * escala), alto = Math.round(v.videoHeight * escala);
        asegurarPintor()?.dibujar(v, ancho, alto, ultimo?.mascara ?? null, escena);
        const activo = seguidor.current ?? servicios.seguidor;
        if (!enCurso) {
          enCurso = true;
          const inicio = performance.now();
          void activo.estimar(v, ancho, alto, inicio).then((obs) => {
            enCurso = false;
            if (!vivo || mio !== turno.current) return;
            const ahora = performance.now();
            if (duraciones.length < 20) duraciones.push(ahora - inicio);
            // Rendimiento del modelo definitivo de la sesión (tras el posible cambio a `lite`), informado una sola vez.
            if (activo !== medido) { medido = activo; recientes = []; }
            recientes.push(ahora - inicio);
            if (!informado && recientes.length === 30 && informar.current) {
              informado = true;
              const mediana = [...recientes].sort((a, b) => a - b)[15]!;
              informar.current({ contrato: 1, modo: "ra", imagenesPorSegundo: Math.round(10000 / mediana) / 10,
                modelo: activo === servicios.seguidorLigero ? "blazepose-lite" : "blazepose-full" });
            }
            if (duraciones.length === 20 && servicios.seguidorLigero && activo !== servicios.seguidorLigero) {
              duraciones.push(0); // Se decide una sola vez por sesión de cámara.
              const mediana = [...duraciones].sort((a, b) => a - b)[10]!;
              if (mediana > LENTO_MS) {
                seguidor.current = servicios.seguidorLigero;
                void servicios.seguidorLigero.preparar();
                activo.destruir?.(); // Libera la GPU del modelo full.
              }
            }
            // Un cuadro sin cuerpo conserva el anterior un instante (la prenda no parpadea).
            if (obs) ultimo = obs;
            const cuerpo = suavizador.filtrar(obs && medirCuerpo(obs.puntos, obs.mascara, suavizador.referencia), ahora);
            escena = cuerpo && ultimo ? construirEscena(modelos, cuerpo, ultimo.puntos) : null;
            tiempos.push(ahora); if (tiempos.length > 15) tiempos.shift();
            if (ahora - ultimoEstado > 500) {
              ultimoEstado = ahora;
              setEstado(escena ? { fase: "listo", fps: tiempos.length > 1 ? ((tiempos.length - 1) * 1000) / (ahora - tiempos[0]!) : undefined } : { fase: "sin-cuerpo" });
            }
          }, (err) => {
            enCurso = false;
            console.warn("BlazePose estimación:", err);
          });
        }
      }
      animacion = requestAnimationFrame(ciclo);
    };
    animacion = requestAnimationFrame(ciclo);
    return () => {
      vivo = false;
      cancelAnimationFrame(animacion);
    };
  }, [origen, recursos, servicios]);

  async function encenderCamara() {
    const mio = ++turno.current;
    setAviso("");
    if (!navigator.mediaDevices?.getUserMedia) { setAviso("Este navegador no permite usar la cámara aquí. Sube una foto."); return; }
    try {
      setEstado({ fase: "preparando" });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false });
      if (mio !== turno.current) { stream.getTracks().forEach((p) => p.stop()); return; }
      flujo.current?.getTracks().forEach((p) => p.stop());
      flujo.current = stream;
      if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      setOrigen("camara");
    } catch (error) {
      if (mio !== turno.current) return;
      // Si play() falla con el flujo ya abierto, la cámara no puede quedar encendida sin forma de apagarla.
      flujo.current?.getTracks().forEach((p) => p.stop());
      flujo.current = null;
      setEstado({ fase: "esperando" });
      const nombre = (error as DOMException | undefined)?.name;
      setAviso(nombre === "NotAllowedError" ? "No diste permiso para usar la cámara. Puedes subir una foto en su lugar." : "No se pudo abrir la cámara. Sube una foto.");
    }
  }

  async function usarFoto(archivo: File | undefined) {
    if (!archivo || !servicios) return;
    if (!recursos) { setAviso("Las prendas 3D todavía se están cargando. Prueba de nuevo en unos segundos."); return; }
    const mio = ++turno.current;
    flujo.current?.getTracks().forEach((p) => p.stop());
    flujo.current = null;
    setAviso("");
    setOrigen("foto");
    setEstado({ fase: "preparando" });
    const url = URL.createObjectURL(archivo);
    try {
      const imagen = await cargar(url);
      const escala = Math.min(1, 1280 / Math.max(imagen.naturalWidth, imagen.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(imagen.naturalWidth * escala); c.height = Math.round(imagen.naturalHeight * escala);
      c.getContext("2d")!.drawImage(imagen, 0, 0, c.width, c.height);
      const obs = await (seguidor.current ?? servicios.seguidor).estimar(c, c.width, c.height);
      if (mio !== turno.current) return;
      const cuerpo = obs && medirCuerpo(obs.puntos, obs.mascara);
      if (!obs || !cuerpo) { setEstado({ fase: "sin-cuerpo" }); setAviso("No encontramos hombros y torso en la foto. Prueba con otra de cuerpo entero."); return; }
      fotoActual.current = { c, obs };
      asegurarPintor()?.dibujar(c, c.width, c.height, obs.mascara, construirEscena(modelos, cuerpo, obs.puntos));
      setEstado({ fase: "listo" });
    } catch {
      if (mio !== turno.current) return;
      setEstado({ fase: "esperando" }); setOrigen("ninguno");
      setAviso("No pudimos leer esa imagen. Prueba con una foto JPG o PNG.");
    } finally { URL.revokeObjectURL(url); }
  }

  return { disponible: !!servicios, origen, estado, aviso, lienzo, video, encenderCamara, usarFoto, apagar, listo: !!recursos };
}

export function textoRA(estado: EstadoRA, origen: Origen): string {
  if (estado.fase === "preparando") return origen === "foto" ? "Analizando tu foto en este dispositivo…" : "Preparando el seguimiento corporal…";
  if (estado.fase === "sin-cuerpo") return "Colócate con hombros y cadera dentro de la imagen y buena luz.";
  if (estado.fase === "listo") return origen === "camara"
    ? `Prendas 3D sobre ti en tiempo real${estado.fps ? ` · ${estado.fps.toFixed(0)} imágenes/s` : ""}. Gira despacio para ver el costado y la espalda; de perfil la prenda es aproximada.`
    : "Prendas 3D sobre tu foto. Todo se calculó en este dispositivo.";
  return "Enciende la cámara o sube una foto de cuerpo entero.";
}
