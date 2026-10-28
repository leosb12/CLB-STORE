/**
 * Integración con el microfrontend del probador (React, build y contenedor propios). Nginx de la web remite /probador/ a
 * su contenedor, así comparte origen, CSP y Service Worker con el shell.
 */
const CARPETA = "/probador/";
const URL_PROBADOR = CARPETA + "probador.js";

interface ModuloProbador {
  /** Guarda en el dispositivo el modelo de tallas (y pide sus archivos) para usarlo sin conexión. */
  precargar(): Promise<void>;
  /** Retira fotos y resultados privados del probador fotográfico (cerrar sesión en un equipo compartido). */
  borrarDatosPrivados?(): Promise<void>;
}

let carga: Promise<ModuloProbador> | undefined;

/** Importa (ejecuta) el módulo una sola vez; al importarlo queda registrado <clb-probador>. */
export function cargarProbador(): Promise<ModuloProbador> {
  carga ??= import(/* @vite-ignore */ URL_PROBADOR) as Promise<ModuloProbador>;
  carga.catch(() => (carga = undefined));
  return carga;
}

/**
 * Al cerrar sesión, el probador detiene su cola y borra fotos y resultados. Si su módulo no llega en 3 s (sin copia ni
 * red), se borra su base entera: se pierden sus borrados pendientes en el servidor, nunca quedan fotos del usuario.
 */
export async function borrarDatosProbador(): Promise<void> {
  const modulo = await Promise.race([
    cargarProbador().catch(() => null),
    new Promise<null>((listo) => setTimeout(() => listo(null), 3_000)),
  ]);
  if (modulo?.borrarDatosPrivados) return modulo.borrarDatosPrivados();
  await new Promise<void>((listo, fallo) => {
    const peticion = indexedDB.deleteDatabase("clb_probador_vton");
    peticion.onsuccess = () => listo();
    peticion.onerror = () => fallo(peticion.error);
    peticion.onblocked = () => listo(); // se completa al cerrarse la otra pestaña
  });
}

function enOcio(tarea: () => void): void {
  if ("requestIdleCallback" in window) window.requestIdleCallback(tarea, { timeout: 15_000 });
  else setTimeout(tarea, 5_000);
}

/** Espera a que el Service Worker controle la página: si no, lo descargado no quedaría guardado. */
async function controlado(sw: ServiceWorkerContainer): Promise<void> {
  await sw.ready;
  if (sw.controller) return;
  await new Promise<void>((resolver) => sw.addEventListener("controllerchange", () => resolver(), { once: true }));
}

/**
 * Al arrancar, con red: descarga los archivos del probador (código y MoveNet) sin ejecutarlos, para que el Service Worker
 * los guarde. Así el código del microfrontend no corre en páginas que no lo usan (administración, gestión).
 */
export function precargarArchivosProbador(sw: ServiceWorkerContainer | undefined = navigator.serviceWorker): void {
  if (!navigator.onLine || !sw) return;
  enOcio(() =>
    void (async () => {
      await controlado(sw);
      const manifiesto = (await (await fetch(CARPETA + "manifiesto.json", { cache: "no-cache" })).json()) as { archivos?: unknown };
      const archivos = Array.isArray(manifiesto.archivos) ? manifiesto.archivos.filter((a): a is string => typeof a === "string") : [];
      // Solo rutas de la carpeta del probador, aunque el manifiesto trajera otra cosa.
      const urls = archivos.map((a) => new URL(a, location.origin + CARPETA)).filter((u) => u.origin === location.origin && u.pathname.startsWith(CARPETA));
      await Promise.allSettled(urls.map((u) => fetch(u)));
    })().catch(() => undefined),
  );
}

/** En el detalle de una prenda, con red: el probador guarda su modelo de tallas para abrirse sin conexión después. */
export function prepararProbador(): void {
  if (!navigator.onLine) return;
  enOcio(() => void cargarProbador().then((m) => m.precargar()).catch(() => undefined));
}
