import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PrendaProbador, RendimientoProbador, ResultadoProbador } from "../dominio/contrato";
import { calcularAjuste, suavizar, suavizarPose, tipoDePrenda, type Ajuste, type Pose, type TipoPrenda, type Transformacion } from "../dominio/pose";
import { conjuntoInicial, opciones, prendasDe, type Conjunto } from "../dominio/conjunto";
import { SelectorPrendas } from "./selector-prendas";
import { CARACTERISTICAS, LIMITES, TABLA_REFERENCIA, type Caracteristica, type Medidas, type RecomendacionTalla } from "../dominio/tallas";
import { MedidasInvalidas,FotogramaNoApto, type DetectorPose, type FuenteModeloTallas, type ModeloObtenido, type ProbarPrenda,type SegmentadorTejido,type CompositorVideo } from "../aplicacion/casos-de-uso";
import { cargarImagen, dibujar, medidaAjustada, prepararArticulacion, type Capa } from "./lienzo";
import {prepararMaterial,transferirMaterial,type Material} from '../dominio/material-camiseta';
import {FotoGenerativa} from './foto-generativa';
import type {ColaFotografica, SesionProbador} from '../aplicacion/probador-fotografico';
import { usarRealidadAumentada, textoRA, type ServiciosRA } from './realidad-aumentada';

export interface Servicios {
  detector: DetectorPose;
  probar: ProbarPrenda;
  modeloTallas: FuenteModeloTallas;
  pruebasRegistradas(): number;
  crearSegmentador?(): SegmentadorTejido;
  crearCompositorVideo?(material:Material):CompositorVideo;
}

type Origen = "ninguno" | "camara" | "foto";
type Estado = { fase: "esperando" } | { fase: "analizando" } | { fase: "listo"; ajuste: Ajuste; codos?: number; material?: boolean; fps?: number };

const ZONAS: Record<TipoPrenda, string> = { superior: "hombros y cadera", vestido: "hombros y rodillas", pantalon: "cadera y tobillos" };
const ETIQUETAS: Record<Caracteristica, string> = {
  altura_cm: "Altura (cm)",
  peso_kg: "Peso (kg)",
  pecho_cm: "Contorno de pecho (cm)",
  cintura_cm: "Contorno de cintura (cm)",
};
const porcentaje = new Intl.NumberFormat("es-BO", { style: "percent", maximumFractionDigits: 0 });
const exactitud = new Intl.NumberFormat("es-BO", { style: "percent", maximumFractionDigits: 1 });
const fecha = new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short" });
const sinMovimiento = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function mensajeCámara(error: unknown): string {
  const nombre = error instanceof DOMException ? error.name : "";
  if (nombre === "NotAllowedError") return "No diste permiso para usar la cámara. Puedes subir una foto en su lugar.";
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError") return "No encontramos una cámara en este dispositivo. Sube una foto.";
  if (nombre === "NotReadableError") return "Otra aplicación está usando la cámara. Ciérrala o sube una foto.";
  return "No se pudo abrir la cámara. Sube una foto.";
}

/** Resumen para lectores de pantalla: cambia solo con la fase, no con cada cuadro de la cámara. */
function resumenEstado(estado: Estado, falloModelo: boolean): string {
  if (falloModelo) return "No se pudo preparar el modelo de pose.";
  if (estado.fase !== "listo") return estado.fase === "analizando" ? "Analizando…" : "";
  return estado.ajuste.ajustado ? "Prenda colocada sobre tu pose." : "No se detecta bien la pose.";
}

function textoEstado(estado: Estado, tipo: TipoPrenda, preparando: boolean,origen:Origen): string {
  if (estado.fase === "esperando") return preparando ? "Preparando el probador en este dispositivo…" : "Elige una foto o enciende la cámara.";
  if (estado.fase === "analizando") return origen==='camara'?'Preparando el tejido en la cámara de este dispositivo…':"Analizando tu foto en este dispositivo…";
  const { ajuste } = estado;
  if(estado.material)return `Tejido ${estado.fps===undefined?'aplicado':'en cámara: '+estado.fps.toFixed(1)+' imágenes/s'} sobre tu camiseta base. Se conservan su silueta e iluminación; no representa el corte ni la talla real del producto. Confianza de la pose: ${porcentaje.format(ajuste.puntuación)}.${estado.fps!==undefined&&estado.fps<3?' Actualización lenta; usa una fotografía para mayor detalle.':''}`;
  if (ajuste.ajustado) {
    return `${estado.codos === undefined ? "Vista aproximada" : estado.codos === 2 ? "Torso y mangas adaptados a tu pose" : "Ajuste de mangas parcial: una manga conserva la colocación aproximada para evitar deformarla; muestra los codos con los brazos algo más separados"}. Confianza de la pose: ${porcentaje.format(ajuste.puntuación)}; no mide el encaje de la ropa` +
      (ajuste.largoEstimado ? ". El largo es aproximado: no se ve el final de la prenda en la imagen." : "");
  }
  if (ajuste.motivo === "PERSONA_MUY_PEQUEÑA") return "Estás muy lejos. Acércate hasta que tu torso ocupe buena parte de la imagen.";
  if (ajuste.motivo === "POSE_DE_PERFIL") return "La inclinación es excesiva. Mantén el torso erguido y de frente a la cámara.";
  return `No logramos ver tus ${ZONAS[tipo]}. Ponte de frente, con el cuerpo dentro de la imagen y luz de frente; evita contraluces.`;
}

const Icono = {
  cámara: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
  ),
  foto: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="m4 16 5-5 4 4 2-2 5 5" /><circle cx="15.5" cy="9" r="1.5" /></svg>
  ),
  candado: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9H6z" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>
  ),
};

type Modo = "ra" | "fotografico" | "local";
const MODOS: { modo: Modo; nombre: string; descripción: string }[] = [
  { modo: "ra", nombre: "Realidad aumentada 3D", descripción: "Cámara o foto. Se calcula en este dispositivo, también sin conexión." },
  { modo: "fotografico", nombre: "Fotografía con IA", descripción: "Imagen realista generada en el servidor de CLB. Necesita conexión y sesión." },
  { modo: "local", nombre: "Vista rápida", descripción: "Superposición aproximada en este dispositivo; la más liviana." },
];

export function Probador({ prenda: prendaInicial, catalogo = [], servicios, serviciosRA, alResultado, fotografico, sesionProbador, modos, alRendimiento }: { prenda: PrendaProbador | null; catalogo?: PrendaProbador[]; servicios: Servicios; serviciosRA?: ServiciosRA; alResultado: (r: ResultadoProbador) => void; fotografico?: ColaFotografica; sesionProbador?: SesionProbador; modos?: Modo[] | null; alRendimiento?: (r: RendimientoProbador) => void }) {
  const disponibles = MODOS.filter((m) => (m.modo === "ra" ? !!serviciosRA : m.modo === "fotografico" ? !!fotografico : true) && (!modos || modos.includes(m.modo)));
  const permitido = (m: string): m is Modo => disponibles.some((d) => d.modo === m);
  /** Conjunto que se prueba: una prenda de arriba y una de abajo (un vestido ocupa ambas). */
  const [conjunto, setConjunto] = useState<Conjunto>(() => conjuntoInicial(prendaInicial));
  useEffect(() => setConjunto(conjuntoInicial(prendaInicial)), [prendaInicial?.identificador]);
  const prendas = prendasDe(conjunto);
  /** Prenda principal (la de arriba si hay dos): la que se ajusta con la pose y define el estado; la otra la acompaña. */
  const prenda = conjunto.superior ?? conjunto.inferior ?? null;
  const acompañante = conjunto.superior && conjunto.inferior ? conjunto.inferior : null;
  /** Conjunto vigente: una animación empezada con otro conjunto no debe pintar encima del nuevo. */
  const claveConjunto = useRef("");
  claveConjunto.current = prendas.map((p) => p.identificador).join("|");
  const entradaFotoRA = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<Modo>(() => {
    try {
      const guardado = localStorage.getItem("clb_probador_modo");
      if (guardado && permitido(guardado)) return guardado;
    } catch { /* Sin preferencia guardada. */ }
    return disponibles[0]?.modo ?? "local";
  });
  // Si el anfitrión cambia los modos permitidos, el actual puede dejar de estarlo.
  useEffect(() => { if (!permitido(modo) && disponibles[0]) setModo(disponibles[0].modo); }, [modos?.join()]);
  // La RA solo descarga modelos y calienta BlazePose (shaders, memoria GPU) mientras es el modo activo.
  const ra = usarRealidadAumentada(prendas, modo === "ra" ? serviciosRA : undefined, alRendimiento);
  const cambiarModo = (nuevo: Modo) => {
    volverAlInicio();
    ra.apagar();
    setModo(nuevo);
    try { localStorage.setItem("clb_probador_modo", nuevo); } catch { /* Preferencia solo en memoria. */ }
  };
  const vistaGenerativa = modo === "fotografico";
  const lienzo = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const entradaFoto = useRef<HTMLInputElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  /** Última foto analizada (lienzo propio por foto): se redibuja y se reajusta si cambia la prenda. */
  const último = useRef<{ pose: Pose; fuente: HTMLCanvasElement; ancho: number; alto: number;mascara?:Float32Array;analisis?:Promise<Float32Array> } | null>(null);
  const segmentador=useRef<ReturnType<NonNullable<Servicios['crearSegmentador']>>|null>(null);
  const materiales=useRef(new WeakMap<HTMLImageElement,Material>());
  const [usarMaterial,setUsarMaterial]=useState(()=>{try{return localStorage.getItem('clb_probador_material')!=='false';}catch{return true;}});
  const [revisionFoto,setRevisionFoto]=useState(0);
  const materialDisponible=!!prenda?.recurso?.anclas&&Array.isArray(prenda.recurso.anclas.estampados)&&prenda.categoría.toLowerCase().includes('polera')&&!!servicios.crearSegmentador;
  /** Cada foto, cámara o salida invalida lo que estuviera en curso: un resultado tardío de otro turno se descarta. */
  const turno = useRef(0);
  const montado = useRef(true);
  const verPuntosRef = useRef(false);
  const modeloRef = useRef<ModeloObtenido | null>(null);

  const [backend, setBackend] = useState<string | null>(null);
  const [falloModelo, setFalloModelo] = useState(false);
  const [ilustración, setIlustración] = useState<HTMLImageElement | null>(null);
  const [origen, setOrigen] = useState<Origen>("ninguno");
  const [estado, setEstado] = useState<Estado>({ fase: "esperando" });
  const [ocupado, setOcupado] = useState(false);
  const [verPuntos, setVerPuntos] = useState(false);
  const [aviso, setAviso] = useState("");
  const [modelo, setModelo] = useState<ModeloObtenido | null | undefined>(undefined);
  const [valores, setValores] = useState<Record<Caracteristica, string>>({ altura_cm: "", peso_kg: "", pecho_cm: "", cintura_cm: "" });
  const [recomendación, setRecomendación] = useState<RecomendacionTalla | null>(null);
  /** Disponibilidad de la talla recomendada, por prenda del conjunto. */
  const [disponible, setDisponible] = useState<{ prenda: PrendaProbador; hay: boolean | null }[]>([]);
  const [complemento, setComplemento] = useState<{ prenda: PrendaProbador; imagen: HTMLImageElement } | null>(null);
  const [registradas, setRegistradas] = useState(() => servicios.pruebasRegistradas());

  const tipo = tipoDePrenda(prenda?.categoría ?? "");
  useEffect(() => {
    verPuntosRef.current = verPuntos;
    modeloRef.current = modelo ?? null;
  }, [verPuntos, modelo]);
  const emitir = (resultado: ResultadoProbador) => {
    setRegistradas(servicios.pruebasRegistradas());
    alResultado(resultado);
  };

  /** MoveNet solo hace falta en la vista rápida: un anfitrión que la excluye (Android) no lo descarga. */
  const conVistaRapida = disponibles.some((d) => d.modo === "local");
  useEffect(() => {
    let vigente = true;
    if (conVistaRapida) {
      servicios.detector.preparar().then(
        (b) => vigente && setBackend(b),
        () => vigente && setFalloModelo(true),
      );
    }
    servicios.modeloTallas.obtener().then((m) => vigente && setModelo(m));
    return () => {
      vigente = false;
    };
  }, [servicios, conVistaRapida]);

  useEffect(() => {
    setIlustración(null);
    if (!prenda?.imagen) return;
    let vigente = true;
    cargarImagen(prenda.imagen).then(
      (img) => { if(vigente){
        try { if(localStorage.getItem("clb_probador_regiones")!=="false")prepararArticulacion(img,prenda.recurso?.anclas); }
        catch { setAviso("No se pudo preparar el ajuste por regiones. Se muestra la vista aproximada anterior."); }
        setIlustración(img);
      } },
      () => vigente && setAviso("No se pudo cargar la ilustración de la prenda en este dispositivo."),
    );
    return () => {
      vigente = false;
    };
  }, [prenda?.imagen]);

  useEffect(() => {
    setComplemento(null);
    if (!acompañante) return;
    let vigente = true;
    cargarImagen(acompañante.imagen).then((img) => {
      if (!vigente) return;
      try { prepararArticulacion(img, acompañante.recurso?.anclas); } catch { /* Se dibuja con el ajuste afín. */ }
      setComplemento({ prenda: acompañante, imagen: img });
    }, () => vigente && setAviso("No se pudo cargar la ilustración de la segunda prenda en este dispositivo."));
    return () => { vigente = false; };
  }, [acompañante?.identificador, acompañante?.imagen]);

  /** Capas de la vista rápida: la principal con su ajuste (suavizado en cámara) y la acompañante ajustada a la misma pose. */
  const capasCon = (pose: Pose | null, t: Transformacion | null): Capa[] => {
    const capas: Capa[] = ilustración ? [{ prenda: ilustración, transformación: t, tipo }] : [];
    if (complemento && pose) {
      const tipoC = tipoDePrenda(complemento.prenda.categoría);
      const a = calcularAjuste(pose, tipoC, complemento.imagen.naturalWidth, complemento.imagen.naturalHeight, complemento.prenda.recurso?.anclas);
      capas.push({ prenda: complemento.imagen, transformación: a.ajustado ? a.transformación : null, tipo: tipoC });
    }
    return capas;
  };

  const apagarCámara = () => {
    flujo.current?.getTracks().forEach((pista) => pista.stop());
    flujo.current = null;
  };
  const volverAlInicio = () => {
    turno.current++;
    apagarCámara();
    setOcupado(false);
    setOrigen("ninguno");
    setEstado({ fase: "esperando" });
  };
  // Al desmontar (salir del probador) o al ocultar la pestaña, la cámara se apaga y cualquier espera en curso se anula.
  useEffect(() => {
    montado.current = true;
    const alOcultar = () => {
      if (document.hidden && flujo.current) volverAlInicio();
    };
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      montado.current = false;
      turno.current++;
      apagarCámara();
      segmentador.current?.cerrar();segmentador.current=null;
      document.removeEventListener("visibilitychange", alOcultar);
    };
  }, []);

  // Foto: al cambiar la vista de puntos o la prenda se redibuja y se recalcula el ajuste con las anclas de la prenda actual.
  useEffect(() => {
    const ú = último.current;
    if (origen !== "foto" || !ú || !lienzo.current || !ilustración) return;
    let vigente=true;
    const ajuste = calcularAjuste(ú.pose, tipo, ilustración.naturalWidth, ilustración.naturalHeight, prenda?.recurso?.anclas);
    const t = ajuste.ajustado ? ajuste.transformación : null;
    if(usarMaterial&&materialDisponible&&prenda?.recurso?.anclas&&ajuste.ajustado){
      setOcupado(true);setEstado({fase:'analizando'});
      const anclas=prenda.recurso.anclas;
      void(async()=>{
        try{
          segmentador.current??=servicios.crearSegmentador!();
          ú.analisis??=segmentador.current.segmentar(ú.fuente);
          try{ú.mascara??=await ú.analisis;}catch(e){ú.analisis=undefined;throw e;}
          if(!vigente)return;
          let material=materiales.current.get(ilustración);
          if(!material){const c=document.createElement('canvas');c.width=ilustración.naturalWidth;c.height=ilustración.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(ilustración,0,0);material=prepararMaterial({ancho:c.width,alto:c.height,rgba:ctx.getImageData(0,0,c.width,c.height).data},anclas);materiales.current.set(ilustración,material);}
          const ctx=ú.fuente.getContext('2d',{willReadFrequently:true})!;
          const resultado=transferirMaterial({ancho:ú.ancho,alto:ú.alto,rgba:ctx.getImageData(0,0,ú.ancho,ú.alto).data},ú.mascara,ú.pose,material);
          if(!vigente||!lienzo.current)return;
          const c=document.createElement('canvas');c.width=ú.ancho;c.height=ú.alto;c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(resultado.rgba),ú.ancho,ú.alto),0,0);
          dibujar(lienzo.current,{fuente:c,ancho:ú.ancho,alto:ú.alto,capas:[],pose:ú.pose,verPuntos});
          lienzo.current.dataset.render='material';setAviso('');setEstado({fase:'listo',ajuste,material:true});
        }catch(e){if(vigente&&lienzo.current){dibujar(lienzo.current,{fuente:ú.fuente,ancho:ú.ancho,alto:ú.alto,capas:[],pose:ú.pose,verPuntos});setEstado({fase:'esperando'});setAviso(e instanceof Error?e.message:'No se pudo preparar la camiseta base.');}}
        finally{if(vigente)setOcupado(false);}
      })();
      return()=>{vigente=false;};
    }
    dibujar(lienzo.current, { fuente: ú.fuente, ancho: ú.ancho, alto: ú.alto, capas: capasCon(ú.pose, t), pose: ú.pose, verPuntos });
    setEstado({ fase: "listo", ajuste, codos: lienzo.current.dataset.codos === undefined ? undefined : Number(lienzo.current.dataset.codos) });
    setOcupado(false);
    return()=>{vigente=false;};
  }, [verPuntos, ilustración, origen, tipo,usarMaterial,materialDisponible,revisionFoto,complemento]);

  // Cámara: cada cuadro se copia, se analiza y se dibuja con la prenda; el estado visible se actualiza dos veces por segundo.
  useEffect(() => {
    if (origen !== "camara" || !prenda || !ilustración) return;
    let vivo = true;
    if(usarMaterial&&materialDisponible){
      let compositor:CompositorVideo|undefined,red:SegmentadorTejido|undefined;
      let cuadro=0,animacion=0,proximo=0,registrada=false;
      const completados:number[]=[];
      const grande=document.createElement('canvas'),pequeno=document.createElement('canvas');
      const ctxGrande=grande.getContext('2d')!,ctxPequeno=pequeno.getContext('2d',{willReadFrequently:true})!;
      setEstado({fase:'analizando'});
      const cicloMaterial=async()=>{
        const v=video.current,l=lienzo.current;
        if(!vivo||!v||!l)return;
        if(v.readyState<2||!v.videoWidth||performance.now()<proximo){animacion=requestAnimationFrame(()=>void cicloMaterial());return;}
        const inicio=performance.now(),{ancho,alto}=medidaAjustada(v.videoWidth,v.videoHeight);
        const escala=Math.min(1,256/Math.max(ancho,alto));
        if(grande.width!==ancho||grande.height!==alto){grande.width=ancho;grande.height=alto;pequeno.width=Math.round(ancho*escala);pequeno.height=Math.round(alto*escala);}
        // La pose, máscara, luz y resultado pertenecen siempre a esta captura.
        ctxGrande.drawImage(v,0,0,ancho,alto);ctxPequeno.drawImage(grande,0,0,pequeno.width,pequeno.height);
        try{
          if(!compositor){
            if(!servicios.crearCompositorVideo)throw new Error('El material en cámara no está disponible. Usa una fotografía.');
            let material=materiales.current.get(ilustración);
            if(!material){const c=document.createElement('canvas');c.width=ilustración.naturalWidth;c.height=ilustración.naturalHeight;const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(ilustración,0,0);material=prepararMaterial({ancho:c.width,alto:c.height,rgba:ctx.getImageData(0,0,c.width,c.height).data},prenda.recurso!.anclas!);materiales.current.set(ilustración,material);}
            compositor=servicios.crearCompositorVideo(material);red=servicios.crearSegmentador!();
          }
          const r=await servicios.probar.ajustar(pequeno,pequeno.width,pequeno.height,prenda,{ancho:ilustración.naturalWidth,alto:ilustración.naturalHeight});
          if(!vivo)return;
          if(!r.ajuste.ajustado)throw new FotogramaNoApto('Muestra hombros y cadera de frente, con luz suficiente.');
          const probabilidades=await red!.segmentar(pequeno);if(!vivo)return;
          const resultado=await compositor.componer(grande,pequeno,probabilidades,r.pose);if(!vivo)return;
          const poseCompleta=r.pose.map(p=>({...p,x:p.x/escala,y:p.y/escala}));
          dibujar(l,{fuente:resultado,ancho,alto,capas:[],pose:poseCompleta,verPuntos:verPuntosRef.current});
          const ahora=performance.now();completados.push(ahora);if(completados.length>20)completados.shift();
          const fps=completados.length>1?(completados.length-1)*1000/(ahora-completados[0]):0;
          l.dataset.render='material-vivo';l.dataset.cuadros=String(++cuadro);l.dataset.latencia=String(Math.round(ahora-inicio));l.dataset.fps=fps.toFixed(2);
          setAviso('');setEstado({fase:'listo',ajuste:r.ajuste,material:true,fps});
          if(!registrada){registrada=true;emitir(servicios.probar.registrarPrueba(prenda,r.ajuste,modeloRef.current));}
          proximo=inicio+125;
        }catch(e){
          if(!vivo)return;
          if(!(e instanceof FotogramaNoApto)){volverAlInicio();setAviso(e instanceof Error?e.message:'No se pudo preparar el tejido en cámara. Usa una fotografía.');return;}
          dibujar(l,{fuente:grande,ancho,alto,capas:[],pose:null,verPuntos:false});
          l.dataset.render='sin-material';setEstado({fase:'esperando'});setAviso(e.message);completados.length=0;proximo=performance.now()+250;
        }
        animacion=requestAnimationFrame(()=>void cicloMaterial());
      };
      animacion=requestAnimationFrame(()=>void cicloMaterial());
      return()=>{vivo=false;cancelAnimationFrame(animacion);compositor?.cerrar();red?.cerrar();};
    }
    let anterior: Transformacion | undefined;
    let registrada = false;
    let últimoEstado = 0;
    let ultimoAnalisis = -Infinity;
    let ultimaPose: Pose | null = null;
    const lienzoCrudo = document.createElement("canvas");
    const ciclo = async () => {
      const v = video.current, l = lienzo.current;
      if (!vivo || !v || !l) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const { ancho, alto } = medidaAjustada(v.videoWidth, v.videoHeight);
        if (performance.now()-ultimoAnalisis < 100) {
          dibujar(l,{fuente:v,ancho,alto,capas: capasCon(ultimaPose, anterior ?? null), pose: ultimaPose, verPuntos: verPuntosRef.current});
          requestAnimationFrame(() => void ciclo()); return;
        }
        ultimoAnalisis = performance.now();
        Object.assign(lienzoCrudo, { width: ancho, height: alto });
        lienzoCrudo.getContext("2d")?.drawImage(v, 0, 0, ancho, alto);
        try {
          const r = await servicios.probar.ajustar(lienzoCrudo, ancho, alto, prenda, { ancho: ilustración.naturalWidth, alto: ilustración.naturalHeight });
          if (!vivo) return;
          ultimaPose = suavizarPose(ultimaPose,r.pose,sinMovimiento()?1:.45);
          anterior = r.ajuste.ajustado ? suavizar(anterior, r.ajuste.transformación, sinMovimiento() ? 1 : 0.45) : undefined;
          dibujar(l, { fuente: lienzoCrudo, ancho, alto, capas: capasCon(ultimaPose, anterior ?? null), pose: ultimaPose, verPuntos: verPuntosRef.current });
          if (performance.now() - últimoEstado > 500) {
            últimoEstado = performance.now();
            setEstado({ fase: "listo", ajuste: r.ajuste, codos: l.dataset.codos === undefined ? undefined : Number(l.dataset.codos) });
          }
          if (!registrada && r.ajuste.ajustado) {
            registrada = true;
            emitir(servicios.probar.registrarPrueba(prenda, r.ajuste, modeloRef.current));
          }
        } catch {
          if (!vivo) return;
          // Sin análisis no tiene sentido mantener la cámara encendida.
          volverAlInicio();
          setAviso("El análisis de la imagen falló en este navegador. Prueba con una foto o recarga la página.");
          return;
        }
      }
      requestAnimationFrame(() => void ciclo());
    };
    requestAnimationFrame(() => void ciclo());
    return () => {
      vivo = false;
    };
  }, [origen, prenda, ilustración, servicios,usarMaterial,materialDisponible,complemento]);

  async function encenderCámara() {
    const mío = ++turno.current;
    setAviso("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setAviso("Este navegador no permite usar la cámara aquí. Sube una foto.");
      return;
    }
    setOcupado(true);
    apagarCámara();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 960 } }, audio: false });
      // Si mientras se pedía permiso se salió del probador o se eligió una foto, este flujo ya no se usa: se apaga.
      if (!montado.current || mío !== turno.current) {
        stream.getTracks().forEach((pista) => pista.stop());
        return;
      }
      flujo.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      último.current = null;
      setEstado({ fase: "analizando" });
      setOrigen("camara");
    } catch (error) {
      if (mío !== turno.current) return;
      apagarCámara();
      setAviso(mensajeCámara(error));
    } finally {
      if (mío === turno.current && montado.current) setOcupado(false);
    }
  }

  async function usarFoto(archivo: File | undefined) {
    if (!archivo || !prenda || !ilustración) return;
    const mío = ++turno.current;
    apagarCámara();
    setOcupado(true);
    setAviso("");
    setOrigen("foto");
    setEstado({ fase: "analizando" });
    último.current = null;
    const url = URL.createObjectURL(archivo);
    const vigente = () => montado.current && mío === turno.current;
    try {
      const imagen = await cargarImagen(url);
      if (!vigente()) return;
      const { ancho, alto } = medidaAjustada(imagen.naturalWidth, imagen.naturalHeight);
      const fuente = document.createElement("canvas");
      Object.assign(fuente, { width: ancho, height: alto });
      fuente.getContext("2d")?.drawImage(imagen, 0, 0, ancho, alto);
      const r = await servicios.probar.ajustar(fuente, ancho, alto, prenda, { ancho: ilustración.naturalWidth, alto: ilustración.naturalHeight });
      if (!vigente()) return;
      último.current = { pose: r.pose, fuente, ancho, alto };
      setRevisionFoto(v=>v+1);
      setEstado({ fase: "listo", ajuste: r.ajuste });
      emitir(servicios.probar.registrarPrueba(prenda, r.ajuste, modeloRef.current));
      if(usarMaterial&&materialDisponible)return;
      const t = r.ajuste.ajustado ? r.ajuste.transformación : null;
      // Único momento animado: la prenda aparece sobre el cuerpo.
      const inicio = performance.now(), conjuntoAnimado = claveConjunto.current;
      const aparecer = (ahora: number) => {
        if (!vigente() || claveConjunto.current !== conjuntoAnimado) return;
        const avance = sinMovimiento() || !t ? 1 : Math.min(1, (ahora - inicio) / 320);
        if (lienzo.current)
          dibujar(lienzo.current, { fuente, ancho, alto, capas: capasCon(r.pose, t), pose: r.pose, verPuntos: verPuntosRef.current, opacidad: 1 - (1 - avance) ** 3 });
        if(avance===1&&lienzo.current)setEstado({fase:"listo",ajuste:r.ajuste,codos:lienzo.current.dataset.codos===undefined?undefined:Number(lienzo.current.dataset.codos)});
        if (avance < 1) requestAnimationFrame(aparecer);
      };
      requestAnimationFrame(aparecer);
    } catch {
      if (!vigente()) return;
      setEstado({ fase: "esperando" });
      setOrigen("ninguno");
      setAviso("No pudimos leer esa imagen. Prueba con una foto JPG o PNG.");
    } finally {
      URL.revokeObjectURL(url);
      if (entradaFoto.current) entradaFoto.current.value = "";
      if (vigente()) setOcupado(false);
    }
  }

  function calcularTalla(evento: FormEvent) {
    evento.preventDefault();
    if (!modelo || !prendas.length) return;
    const medidas = Object.fromEntries(CARACTERISTICAS.map((c) => [c, Number(valores[c].replace(",", "."))])) as Medidas;
    try {
      const resultados = prendas.map((p) => ({ p, ...servicios.probar.recomendarTalla(modelo, medidas, p, p === prenda && estado.fase === "listo" ? estado.ajuste : null) }));
      setRecomendación(resultados[0]!.recomendación);
      setDisponible(resultados.map(({ p, resultado }) => ({ prenda: p, hay: resultado.tallaDisponible })));
      setAviso("");
      // Un resultado por prenda: el shell ofrece «Elegir talla» en cada una.
      for (const { resultado } of resultados) emitir(resultado);
    } catch (error) {
      if (!(error instanceof MedidasInvalidas)) throw error;
      setRecomendación(null);
      setAviso("Revisa tus medidas: alguna está fuera de los rangos admitidos.");
    }
  }

  const lista = opciones(prendaInicial, catalogo);
  const selector = <SelectorPrendas opciones={lista} conjunto={conjunto} cambiar={setConjunto} />;
  if (!prenda)
    return (
      <div className="probador">
        <div className="pasos inicio">
          <h2 className="título">Probador virtual</h2>
          {selector}
          <p className="estado" role="status">{lista.length ? "Elige una prenda de arriba, de abajo o ambas para empezar." : "Esperando las prendas del catálogo…"}</p>
        </div>
      </div>
    );

  const preparando = !backend && !falloModelo;
  const ajustada = estado.fase === "listo" && estado.ajuste.ajustado;
  const descripciónLienzo =
    origen === "ninguno" ? "" : ajustada ? `${prendas.map((p) => p.nombre).join(" + ")}: vista aproximada sobre tu ${origen === "camara" ? "imagen de cámara" : "foto"}` : `Tu ${origen === "camara" ? "imagen de cámara" : "foto"}, sin prenda ajustada`;
  const probabilidades = recomendación ? [...(modelo?.modelo.clases ?? [])].map((c) => [c, recomendación.probabilidades[c] ?? 0] as const) : [];

  return (
    <div className="probador" data-modo={modo}>
      <div className="pasos inicio">
        <h2 className="título">Probador virtual</h2>
        {selector}
        {disponibles.length > 1 && <section aria-labelledby="paso-modo">
          <h3 id="paso-modo"><span className="número">2</span>Cómo probarte</h3>
          <ul className="modos">
            {disponibles.map((m) => (
              <li key={m.modo}>
                <button type="button" aria-pressed={modo === m.modo} onClick={() => cambiarModo(m.modo)}>
                  <strong>{m.nombre}</strong>
                  <span>{m.descripción}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>}
        {modo === "ra" && serviciosRA && (
          <>
            <p className="oculto" role="status" aria-live="polite">{textoRA(ra.estado, ra.origen)}</p>
            <p className="estado" data-estado={ra.estado.fase === "listo" ? "ajustada" : ra.estado.fase}>
              {ra.aviso || textoRA(ra.estado, ra.origen)}
            </p>

            <div className="modo-detalle">
              <div className="acciones">
                {ra.origen === "ninguno" ? (
                  <>
                    <button type="button" className="botón" onClick={() => void ra.encenderCamara()}>
                      {Icono.cámara}Cámara
                    </button>
                    <button type="button" className="botón" onClick={() => entradaFotoRA.current?.click()}>
                      {Icono.foto}Subir foto
                    </button>
                  </>
                ) : (
                  <button type="button" className="botón-texto" onClick={ra.apagar}>
                    {ra.origen === "camara" ? "Apagar cámara" : "Quitar foto"}
                  </button>
                )}
                <input
                  ref={entradaFotoRA}
                  className="oculto"
                  type="file"
                  accept="image/*"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => { void ra.usarFoto(e.target.files?.[0]); e.target.value = ""; /* elegir otra vez la misma foto también cuenta */ }}
                />
              </div>
              <p className="nota">
                Las prendas siguen tus hombros, brazos y piernas en tiempo real; gira despacio para ver el costado y la espalda.
              </p>
            </div>
          </>
        )}
        {modo === "fotografico" && fotografico && sesionProbador && prenda && (
          <FotoGenerativa key={prendas.map((p) => `${p.identificador}:${p.imagen}`).join("|")} prendas={prendas} cola={fotografico} />
        )}
        {modo === "local" && <>
        {prenda?.recurso && <p>Fotografía en color {prenda.recurso.color}. {materialDisponible&&usarMaterial?'En fotografía se conserva la forma de tu camiseta base.':'Vista frontal aproximada; no simula la caída de la tela.'}</p>}
        <p className="oculto" role="status" aria-live="polite">{resumenEstado(estado, falloModelo)}</p>
        <p className="estado" data-estado={estado.fase === "listo" ? (ajustada ? "ajustada" : "sin-pose") : estado.fase}>
          {falloModelo ? "No se pudo preparar el modelo de pose. Conéctate una vez para descargarlo y vuelve a intentar." : textoEstado(estado, tipo, preparando,origen)}
        </p>
        {aviso && <p className="aviso" role="alert">{aviso}</p>}

        <div className="modo-detalle">
          {materialDisponible && !acompañante && <>
            <label className="interruptor">
              <input type="checkbox" checked={usarMaterial} disabled={ocupado}
                onChange={(e) => {setUsarMaterial(e.target.checked);try{localStorage.setItem('clb_probador_material',String(e.target.checked));}catch{/* El modo sigue disponible en memoria si el navegador deniega persistencia. */}}} />
              Aplicar tejido sobre camiseta base (foto y cámara)
            </label>
            <p className="nota">{usarMaterial
              ? 'El tejido puede aplicarse en foto o cámara. Usa camiseta lisa y pantalón de distinto color, con el torso completo y buena luz. La cámara muestra su frecuencia real; una fotografía permite revisar más detalle.'
              : 'Se superpone la fotografía por regiones. Tu camiseta anterior puede quedar visible.'}</p>
          </>}
          <div className="acciones">
            <button type="button" className="botón" aria-pressed={origen === "camara"} onClick={() => void encenderCámara()} disabled={!ilustración || ocupado}>
              {Icono.cámara}Cámara
            </button>
            <button type="button" className="botón" aria-pressed={origen === "foto"} onClick={() => entradaFoto.current?.click()} disabled={!ilustración || ocupado}>
              {Icono.foto}Subir foto
            </button>
            {origen === "camara" && (
              <button type="button" className="botón-texto" onClick={volverAlInicio}>
                Apagar cámara
              </button>
            )}
            <input ref={entradaFoto} className="oculto" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={(e) => void usarFoto(e.target.files?.[0])} />
          </div>
          <label className="interruptor">
            <input type="checkbox" checked={verPuntos} onChange={(e) => setVerPuntos(e.target.checked)} />
            Mostrar los puntos que detecta la IA
          </label>
          <p className="nota">De frente y con el cuerpo dentro de la imagen, hasta la {acompañante || tipo === "pantalon" ? "punta de los pies" : tipo === "vestido" ? "rodilla" : "cadera"}.</p>
        </div>
        </>}
      </div>
      {modo === "ra" && serviciosRA && prenda && (
        <figure className="espejo" data-origen={ra.origen}>
          <video ref={ra.video} playsInline muted style={{ display: "none" }} />
          <canvas
            ref={ra.lienzo}
            className={ra.origen === "camara" ? "espejado" : undefined}
            role="img"
            aria-label={`Realidad aumentada 3D: ${prendas.map((p) => p.nombre).join(" + ")}`}
            style={{ display: ra.origen !== "ninguno" ? "block" : "none" }}
          />
          {ra.origen === "ninguno" && (
            <div className="espejo-vacío">
              {prenda.imagen && <img src={prenda.imagen} alt="" width={210} height={230} />}
              <p>Enciende la cámara o sube una foto de cuerpo entero para ver {prendas.length > 1 ? "el conjunto" : "la prenda"} en 3D sobre tu cuerpo.</p>
            </div>
          )}
          <figcaption>{prendas.map((p) => p.nombre).join(" + ")}</figcaption>
        </figure>
      )}
      {modo === "local" && prenda && <figure className="espejo" data-origen={origen}>
        <canvas ref={lienzo} className={origen === "camara" ? "espejado" : undefined} role="img" aria-label={descripciónLienzo} hidden={origen === "ninguno"} />
        {origen === "ninguno" && (
          <div className="espejo-vacío">
            {ilustración && <img src={prenda.imagen} alt="" width={210} height={230} />}
            <p>{materialDisponible&&usarMaterial?'Prueba el tejido de esta polera sobre tu camiseta base.':'Tu foto aparecerá aquí con una vista aproximada de la prenda.'}</p>
          </div>
        )}
        <video ref={video} className="oculto" playsInline muted />
        <figcaption>{prendas.map((p) => p.nombre).join(" + ")}</figcaption>
      </figure>}

      <div className="pasos detalle">

        <section aria-labelledby="paso-talla">
          <h3 id="paso-talla"><span className="número">{disponibles.length > 1 ? 3 : 2}</span>Tu talla</h3>
          {modelo === undefined ? (
            <p className="nota" role="status">Cargando el modelo de tallas…</p>
          ) : modelo === null ? (
            <p className="nota">El modelo de tallas todavía no está en este dispositivo: abre el probador una vez con conexión y quedará guardado. Mientras tanto, guíate por la tabla de tallas con una cinta métrica.</p>
          ) : (
            <form onSubmit={calcularTalla} className="medidas">
              {CARACTERISTICAS.map((c) => (
                <label key={c}>
                  {ETIQUETAS[c]}
                  <input
                    name={c}
                    type="number"
                    inputMode="decimal"
                    required
                    min={LIMITES[c][0]}
                    max={LIMITES[c][1]}
                    step="0.1"
                    value={valores[c]}
                    onChange={(e) => setValores({ ...valores, [c]: e.target.value })}
                  />
                </label>
              ))}
              <button className="botón-principal" type="submit">Calcular mi talla</button>
            </form>
          )}
          {recomendación && modelo && (
            <div className="resultado" aria-live="polite" data-talla={recomendación.talla}>
              <p className="talla">
                {recomendación.alternativa ? (
                  <>Entre <strong>{recomendación.talla}</strong> y <strong>{recomendación.alternativa}</strong></>
                ) : (
                  <>Talla <strong>{recomendación.talla}</strong></>
                )}
              </p>
              <dl className="probabilidades">
                {probabilidades.map(([talla, p]) => (
                  <div key={talla} data-elegida={talla === recomendación.talla || undefined}>
                    <dt>{talla}</dt>
                    <dd>
                      <span className="pista"><span className="barra" style={{ inlineSize: `${Math.round(p * 100)}%` }} /></span>
                      <span className="cifra">{porcentaje.format(p)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {disponible.length > 1 ? (
                <ul className="disponibles">
                  {disponible.map(({ prenda: p, hay }) => (
                    <li key={p.identificador} data-hay={hay === false ? "no" : "si"}>
                      {p.nombre}: {hay === false ? `no tiene talla ${recomendación.talla}` : hay ? `hay talla ${recomendación.talla}` : "tallas sin confirmar"}
                    </li>
                  ))}
                </ul>
              ) : disponible[0]?.hay === false && <p className="aviso">Esta prenda no tiene variante en talla {recomendación.talla}. Revisa las tallas disponibles antes de elegir.</p>}
              {recomendación.tallaPorTabla !== recomendación.talla && (
                <p className="nota">Solo por tu contorno de pecho, la tabla indica {recomendación.tallaPorTabla}.</p>
              )}
              <p className="nota">{modelo.modelo.aviso}</p>
            </div>
          )}
          {modelo !== undefined && (
            <details className="tabla-tallas" open={modelo === null}>
              <summary>Tabla de tallas</summary>
              <table>
                <thead>
                  <tr><th scope="col">Talla</th><th scope="col">Pecho</th><th scope="col">Cintura</th><th scope="col">Altura</th><th scope="col">Peso</th></tr>
                </thead>
                <tbody>
                  {Object.entries(modelo?.modelo.tabla ?? TABLA_REFERENCIA).map(([t, fila]) => {
                    return (
                      <tr key={t}>
                        <th scope="row">{t}</th>
                        <td>{fila.pecho_cm.join("–")} cm</td>
                        <td>{fila.cintura_cm.join("–")} cm</td>
                        <td>{fila.altura_cm.join("–")} cm</td>
                        <td>{fila.peso_kg.join("–")} kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}
        </section>

        <footer className="privacidad">
          <p>{Icono.candado}<span>{modo === 'fotografico' ? 'La fotografía con IA utiliza el servidor de CLB. La recomendación de talla se calcula en este dispositivo.' : modo === 'ra' ? 'La realidad aumentada 3D se procesa en tiempo real con BlazePose en este dispositivo.' : 'La vista local se analiza en este dispositivo y no envía tu imagen a ningún servidor.'}</span></p>
          <details className="nota" data-modelos><summary>Detalles técnicos del probador</summary>
            Pose: {servicios.detector.modelo}
            {backend ? ` · ${backend === "webgl" ? "GPU (WebGL)" : "CPU, más lento"}` : ""}
            {modelo ? ` · Tallas: regresión logística v${modelo.modelo.version}, exactitud ${exactitud.format(modelo.modelo.metricas.exactitud)}, ${modelo.origen === "red" ? "descargado" : "guardado"} el ${fecha.format(new Date(modelo.descargado))}` : ""}
            {registradas ? ` · ${registradas} ${registradas === 1 ? "prueba registrada" : "pruebas registradas"} en este dispositivo` : ""}
          </details>
        </footer>
      </div>
    </div>
  );
}
