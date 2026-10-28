import {useEffect, useMemo, useRef, useState} from 'react';
import type {PrendaProbador} from '../dominio/contrato';
import type {SolicitudFotografica} from '../dominio/solicitud-fotografica';
import type {ColaFotografica} from '../aplicacion/probador-fotografico';

const relativo = new Intl.RelativeTimeFormat('es', {numeric: 'auto'});
function hace(ms: number, ahora: number): string {
  const minutos = Math.round((ms - ahora) / 60_000);
  return Math.abs(minutos) < 60 ? relativo.format(minutos, 'minute') : relativo.format(Math.round(minutos / 60), 'hour');
}

function titulo(s: SolicitudFotografica): string {
  if (s.estado === 'LISTO') return 'Imagen lista';
  if (s.estado === 'ERROR') return 'No se pudo generar';
  if (s.estado === 'PENDIENTE') return 'En espera';
  return s.remoto === 'PROCESANDO' ? 'Generando con IA' : s.remoto === 'PENDIENTE' ? 'En cola en CLB' : 'Enviando';
}

/** URL de objeto por Blob, revocada al cambiar o desmontar. */
function useUrl(blob?: Blob): string {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

/** Nombre de lo que muestra la solicitud: la prenda o el conjunto completo. */
const nombreDe = (s: SolicitudFotografica) => (s.base ? `${s.base.nombre} + ${s.prenda.nombre}` : s.prenda.nombre);

function Resultado({s, nombre}: {s: SolicitudFotografica; nombre: string}) {
  const url = useUrl(s.resultado);
  return url ? <img src={url} alt={`${nombre} sobre tu fotografía, imagen generada con IA`} /> : null;
}

function Solicitud({s, ahora, cola, actual}: {s: SolicitudFotografica; ahora: number; cola: ColaFotografica; actual: boolean}) {
  const [confirmar, setConfirmar] = useState(false);
  const activa = s.estado === 'PENDIENTE' || s.estado === 'ENVIANDO';
  const accion = activa ? 'Cancelar solicitud' : 'Eliminar imagen';
  return <li className="solicitud" data-estado={s.estado}>
    <div className="solicitud-cabecera">
      <strong>{titulo(s)}</strong>
      <span className="nota-breve">{s.siguiente || s.continuacion ? `Paso 1 de 2 · ${s.prenda.nombre} · ` : actual ? '' : `${nombreDe(s)} · `}{s.estado === 'LISTO' ? `generada ${hace(s.actualizado, ahora)}` : `pedida ${hace(s.creado, ahora)}`}</span>
    </div>
    {s.estado !== 'LISTO' && <p className="solicitud-mensaje">{s.mensaje}</p>}
    {s.estado === 'LISTO' && <figure className="resultado-foto">
      <Resultado s={s} nombre={nombreDe(s)} />
      <figcaption>Simulación generada con IA: revisa el diseño y la anatomía. No determina el ajuste físico ni reproduce con exactitud el color, el estampado o la caída de la tela.</figcaption>
    </figure>}
    {confirmar ? <div className="acciones" role="group" aria-label={`Confirmar: ${accion.toLowerCase()}`}>
      <span className="nota-breve">{activa ? 'Se borra la foto de este dispositivo y se descarta el resultado en CLB.' : 'Se borra de este dispositivo y de CLB.'}</span>
      <button className="botón" onClick={() => void cola.eliminar(s.clave)}>Sí, {accion.toLowerCase()}</button>
      <button className="botón-texto" onClick={() => setConfirmar(false)}>Volver</button>
    </div> : <div className="acciones">
      {s.estado === 'ERROR' && s.persona && <button className="botón" onClick={() => void cola.reintentar(s.clave)}>Reintentar</button>}
      <button className="botón-texto" onClick={() => setConfirmar(true)}>{accion}</button>
    </div>}
  </li>;
}

/**
 * Probador fotográfico como cola visible. La foto se guarda en el dispositivo antes de enviarse: cerrar la página o
 * perder la conexión no la pierde, y al volver se reanuda. La generación sigue necesitando el servidor GPU de CLB.
 */
/** `prendas` en orden de generación: primero la de abajo y después la de arriba, que se pone sobre ese resultado. */
export function FotoGenerativa({prendas, cola}: {prendas: PrendaProbador[]; cola: ColaFotografica}) {
  const prenda = prendas.at(-1)!;
  const conjunto = prendas.length > 1;
  const [archivo, setArchivo] = useState<File>();
  const [lista, setLista] = useState<SolicitudFotografica[] | null>(null);
  const [error, setError] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [confirmarTodo, setConfirmarTodo] = useState(false);
  const [ahora, setAhora] = useState(Date.now());
  const original = useUrl(archivo);
  const anterior = useRef(new Map<string, string>());

  useEffect(() => {
    let vivo = true, reloj: ReturnType<typeof setTimeout> | undefined;
    const refrescar = async () => {
      const nuevas = await cola.listar().catch(() => []);
      if (!vivo) return;
      // Solo se anuncian cambios de estado, nunca cada sondeo: el lector de pantalla no se inunda.
      for (const s of nuevas) {
        const previo = anterior.current.get(s.clave);
        if (previo && previo !== `${s.estado}${s.remoto ?? ''}`) setAnuncio(`${s.prenda.nombre}: ${titulo(s).toLowerCase()}.`);
      }
      anterior.current = new Map(nuevas.map((s) => [s.clave, `${s.estado}${s.remoto ?? ''}`]));
      setLista(nuevas);
      clearTimeout(reloj);
      const proximo = await cola.proximoIntento().catch(() => null);
      if (vivo && proximo !== null) reloj = setTimeout(() => void cola.sincronizar(), Math.max(1_000, proximo - Date.now()));
    };
    const quitar = cola.alCambiar(() => void refrescar());
    const enLinea = () => void cola.sincronizar();
    addEventListener('online', enLinea);
    const minuto = setInterval(() => setAhora(Date.now()), 30_000);
    void refrescar().then(() => cola.sincronizar());
    return () => { vivo = false; quitar(); removeEventListener('online', enLinea); clearInterval(minuto); clearTimeout(reloj); };
  }, [cola]);

  async function generar() {
    if (!archivo) return;
    setGuardando(true); setError('');
    try {
      const fotos = await Promise.all(prendas.map(async (p) => {
        const respuesta = await fetch(p.imagenFotografica ?? p.imagen).catch(() => null);
        if (!respuesta?.ok) throw new Error(`La fotografía de ${p.nombre} no está en este dispositivo. Abre su ficha con conexión una vez.`);
        return respuesta.blob();
      }));
      // Un conjunto se genera en dos pasadas: la de abajo y, sobre su resultado, la de arriba.
      const s = await cola.encolar(archivo, prendas[0]!, fotos[0]!, conjunto ? {siguiente: {prenda: prendas[1]!, ropa: fotos[1]!}} : {});
      setAnuncio(s.estado === 'LISTO' ? 'Ya tenías esta imagen generada.' : navigator.onLine ? 'Foto guardada. Enviando a CLB…' : 'Foto guardada en este dispositivo. Se enviará al recuperar la conexión.');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo guardar la solicitud.');
    } finally { setGuardando(false); }
  }

  // El paso intermedio de un conjunto ya continuado no se muestra aparte: su imagen final está en la siguiente.
  const visibles = (lista ?? []).filter((s) => !(s.estado === 'LISTO' && s.continuacion));
  const esDeAqui = (s: SolicitudFotografica) => {
    const final = s.siguiente?.prenda ?? s.prenda, base = s.siguiente ? s.prenda : s.base;
    return final.identificador === prenda.identificador && (base?.identificador ?? null) === (conjunto ? prendas[0]!.identificador : null);
  };
  const propias = visibles.filter(esDeAqui);
  const otras = visibles.filter((s) => !esDeAqui(s));

  return <section className="pasos foto-generativa" aria-labelledby="titulo-foto">
    <h3 id="titulo-foto">Tu fotografía con IA</h3>
    <p>{conjunto ? 'Conjunto' : 'Prenda'}: <strong>{prendas.map((p) => p.nombre).join(' + ')}</strong>{!conjunto && prenda.recurso ? ` · ${prenda.recurso.color}` : ''}</p>
    <div className="prendas-referencia">
      {prendas.map((p) => <img key={p.identificador} className="prenda-referencia" src={p.imagenFotografica ?? p.imagen} alt={`Fotografía de catálogo de ${p.nombre}`} />)}
    </div>
    <p>Usa una foto de una sola persona, de frente, con los brazos visibles hasta las muñecas. Para pantalones o vestidos, incluye las piernas completas.</p>
    {conjunto && <p className="nota">El conjunto se genera en dos pasos: primero {prendas[0]!.nombre} y, sobre ese resultado, {prenda.nombre}. Tarda el doble que una prenda.</p>}
    <p className="nota">Al pulsar «Generar imagen» tu foto se guarda en este dispositivo y se envía al servidor de CLB, que conserva el resultado hasta 24 horas. Necesitas haber iniciado sesión. Puedes cancelar o borrar cada imagen cuando quieras.</p>
    <label className="campo-foto">Tu fotografía (JPG, PNG o WebP, hasta 8 MB)
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={guardando} onChange={(evento) => { setArchivo(evento.target.files?.[0]); setError(''); }} />
    </label>
    <div className="acciones">
      <button className="botón-principal" disabled={!archivo || guardando} onClick={() => void generar()}>{guardando ? 'Guardando…' : 'Generar imagen'}</button>
    </div>
    <p className="estado-cola" role="status" aria-live="polite">{anuncio}</p>
    {error && <p className="aviso" role="alert">{error}</p>}
    {original && <figure className="original-foto"><img src={original} alt="Tu fotografía elegida" /><figcaption>Tu foto</figcaption></figure>}

    <h4 className="subtitulo">Tus imágenes {conjunto ? 'de este conjunto' : 'de esta prenda'}</h4>
    {lista === null ? <p className="nota">Cargando las solicitudes guardadas…</p>
      : propias.length === 0 ? <p className="nota">Aún no hay imágenes {conjunto ? 'de este conjunto' : 'de esta prenda'}. Elige tu foto y pulsa «Generar imagen».</p>
      : <ul className="solicitudes">{propias.map((s) => <Solicitud key={s.clave} s={s} ahora={ahora} cola={cola} actual />)}</ul>}
    {otras.length > 0 && <details className="otras-solicitudes">
      <summary>Otras prendas y conjuntos ({otras.length})</summary>
      <ul className="solicitudes">{otras.map((s) => <Solicitud key={s.clave} s={s} ahora={ahora} cola={cola} actual={false} />)}</ul>
    </details>}
    {(lista?.length ?? 0) > 0 && (confirmarTodo
      ? <div className="acciones" role="group" aria-label="Confirmar borrado de todas tus imágenes">
          <span className="nota-breve">Se borran todas tus fotos e imágenes generadas de este dispositivo y de CLB.</span>
          <button className="botón" onClick={() => { setConfirmarTodo(false); void cola.borrarMias(); setAnuncio('Se borraron tus imágenes de este dispositivo. En CLB se borrarán al haber conexión.'); }}>Sí, borrar todo</button>
          <button className="botón-texto" onClick={() => setConfirmarTodo(false)}>Volver</button>
        </div>
      : <div className="acciones"><button className="botón-texto" onClick={() => setConfirmarTodo(true)}>Borrar todas mis imágenes</button></div>)}
    <p className="nota">Las solicitudes se procesan con esta página abierta. Si la cierras, se reanudan al volver a abrir el probador.</p>
  </section>;
}
