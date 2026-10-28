import type { PrendaProbador } from "../dominio/contrato";
import {
  esperaReintento,
  especificacionClave,
  MAXIMO_FALLOS_SERVIDOR,
  MAXIMO_PENDIENTES,
  MAXIMO_RESULTADOS,
  obsoleta,
  VERSION_MOTOR,
  type SolicitudFotografica,
} from "../dominio/solicitud-fotografica";

export type SesionProbador = () => Promise<{ titular: string | null; cabeceras: Record<string, string> }>;

/** Persistencia local de solicitudes y borrados remotos pendientes, siempre separada por titular. */
export interface AlmacenSolicitudes {
  guardar(s: SolicitudFotografica): Promise<void>;
  obtener(titular: string, clave: string): Promise<SolicitudFotografica | undefined>;
  listar(titular: string): Promise<SolicitudFotografica[]>;
  eliminar(titular: string, clave: string): Promise<void>;
  /** Borrado local + invalidación remota pendiente en una sola transacción. */
  eliminarConBorrado(titular: string, clave: string): Promise<void>;
  borrados(titular: string): Promise<string[]>;
  confirmarBorrado(titular: string, clave: string): Promise<void>;
  borrarTodo(): Promise<void>;
}

export interface EstadoRemoto { identificador: string; estado: string; mensaje?: string; reintentable?: boolean }

/** Sin conexión con CLB (fetch falló o venció el plazo). Se reintenta sin límite con la misma clave. */
export class ErrorRed extends Error {}
/** Servidor de imágenes caído, reiniciándose u ocupado: como la red, no agota la solicitud porque no gastó GPU. */
export class ErrorNoDisponible extends ErrorRed {}
/** El servidor respondió pero no pudo atender (ocupado, reiniciado, sin GPU). Reintentos acotados. */
export class ErrorTemporal extends Error {}
/** Sin token válido: se espera a que el usuario renueve la sesión, sin gastar intentos. */
export class ErrorSesion extends Error {}

export interface ServidorFotografico {
  enviar(s: SolicitudFotografica, cabeceras: Record<string, string>, señal: AbortSignal): Promise<EstadoRemoto>;
  consultar(clave: string, cabeceras: Record<string, string>, señal: AbortSignal): Promise<EstadoRemoto>;
  descargar(clave: string, cabeceras: Record<string, string>, señal: AbortSignal): Promise<Blob>;
  /** `*` invalida todos los resultados del titular. */
  invalidar(clave: string, cabeceras: Record<string, string>): Promise<void>;
}

export interface OpcionesCola {
  huella: (datos: ArrayBuffer) => Promise<string>;
  /** Una sola pestaña procesa la cola a la vez (Web Locks); sin soporte, ejecuta directamente. */
  exclusivo?: (tarea: () => Promise<void>) => Promise<void>;
  ahora?: () => number;
  azar?: () => number;
  /** Espera entre consultas de estado mientras se genera. */
  sondeo?: (señal: AbortSignal) => Promise<void>;
  enLinea?: () => boolean;
}

const sinRed = "Guardada en este dispositivo. Se enviará al recuperar la conexión con CLB.";

/**
 * Cola durable del probador fotográfico. La foto se guarda localmente antes de cualquier envío, de modo que cerrar la
 * pestaña, perder la red o reiniciar el servidor no pierde la solicitud. Solo procesa con la página abierta: el navegador
 * no garantiza trabajo en segundo plano; al volver a abrirla, ENVIANDO pasa a PENDIENTE y se reanuda con la misma clave.
 */
export class ColaFotografica {
  private enProceso: Promise<void> | null = null;
  private otraVez = false;
  private actual: AbortController | null = null;
  private readonly oyentes = new Set<() => void>();
  private readonly ahora: () => number;

  constructor(
    private readonly almacen: AlmacenSolicitudes,
    private readonly servidor: ServidorFotografico,
    private readonly sesion: SesionProbador,
    private readonly opciones: OpcionesCola,
  ) {
    this.ahora = opciones.ahora ?? Date.now;
  }

  alCambiar(oyente: () => void): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }
  private avisar(): void { for (const oyente of this.oyentes) oyente(); }

  /** El shell entregó otra sesión (restaurada tarde, inicio o cambio de cuenta): releer la lista y enviar lo pendiente. */
  sesionCambiada(): void {
    this.avisar();
    void this.sincronizar();
  }

  private async titular(): Promise<string | null> { return (await this.sesion()).titular; }

  async listar(): Promise<SolicitudFotografica[]> {
    const titular = await this.titular();
    if (!titular) return [];
    const lista = await this.almacen.listar(titular);
    return (await this.titular()) === titular ? lista.sort((a, b) => b.creado - a.creado) : [];
  }

  /**
   * `conjunto.siguiente`: segunda prenda que se pondrá sobre el resultado (primero la de abajo, luego la de arriba).
   * `conjunto.base`: prenda que ya trae la foto, para mostrar el conjunto completo.
   */
  async encolar(persona: Blob, prenda: PrendaProbador, ropa: Blob, conjunto: { siguiente?: { prenda: PrendaProbador; ropa: Blob }; base?: PrendaProbador } = {}): Promise<SolicitudFotografica> {
    const titular = await this.titular();
    if (!titular) throw new Error("Inicia sesión para guardar tu foto y generar la imagen.");
    if (persona.size === 0 || persona.size > 8 * 1024 * 1024) throw new Error("La foto debe ocupar como máximo 8 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(persona.type)) throw new Error("Selecciona una fotografía JPG, PNG o WebP.");
    for (const r of [ropa, conjunto.siguiente?.ropa]) if (r && (r.type.includes("svg") || r.size === 0)) throw new Error("Esta prenda todavía no tiene una fotografía publicada para el probador.");
    const [fotoHash, ropaHash] = await Promise.all([this.opciones.huella(await persona.arrayBuffer()), this.opciones.huella(await ropa.arrayBuffer())]);
    const clave = await this.opciones.huella(new TextEncoder().encode(especificacionClave(titular, fotoHash, prenda, ropaHash)).buffer as ArrayBuffer);
    const existente = await this.almacen.obtener(titular, clave);
    if (existente && existente.estado !== "ERROR" && !conjunto.siguiente) {
      // Misma foto y prenda: no se duplica. Si era el primer paso de un conjunto, ahora también se muestra sola.
      if (!existente.continuacion) return existente;
      const visible = { ...existente, continuacion: undefined };
      await this.almacen.guardar(visible);
      this.avisar();
      return visible;
    }
    if ((existente?.estado === "PENDIENTE" || existente?.estado === "ENVIANDO") && conjunto.siguiente) {
      // La primera prenda ya está en camino: solo se le agrega la segunda, sin reiniciar su envío.
      const conSiguiente = { ...existente, siguiente: conjunto.siguiente };
      await this.almacen.guardar(conSiguiente);
      this.avisar();
      return conSiguiente;
    }
    if (existente?.estado === "LISTO" && conjunto.siguiente) {
      // La primera prenda ya estaba generada: se guarda la segunda y se continúa desde su resultado.
      const continuar = { ...existente, siguiente: conjunto.siguiente, continuacion: undefined };
      await this.almacen.guardar(continuar);
      return (await this.encadenar(continuar)) ?? continuar;
    }
    const activas = (await this.almacen.listar(titular)).filter((s) => s.estado === "PENDIENTE" || s.estado === "ENVIANDO");
    if (activas.length >= MAXIMO_PENDIENTES) throw new Error(`Ya tienes ${MAXIMO_PENDIENTES} solicitudes en espera. Espera a que terminen o cancela alguna.`);
    const momento = this.ahora();
    const solicitud: SolicitudFotografica = {
      clave, titular, version: VERSION_MOTOR, prenda: { ...prenda, tallas: [...prenda.tallas] }, persona, ropa,
      estado: "PENDIENTE", mensaje: "Guardada en este dispositivo.", intentos: 0, fallosServidor: 0, proximo: 0, creado: existente?.creado ?? momento, actualizado: momento,
      ...(conjunto.siguiente && { siguiente: { prenda: { ...conjunto.siguiente.prenda, tallas: [...conjunto.siguiente.prenda.tallas] }, ropa: conjunto.siguiente.ropa } }),
      ...(conjunto.base && { base: conjunto.base }),
    };
    try {
      await this.almacen.guardar(solicitud);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") throw new Error("No hay espacio en este dispositivo. Borra imágenes generadas y vuelve a intentar.");
      throw error;
    }
    this.avisar();
    void this.sincronizar();
    return solicitud;
  }

  /** Cancelar o eliminar: retira la solicitud local y pide al servidor descartar su resultado (ahora o al reconectar). */
  async eliminar(clave: string): Promise<void> {
    const titular = await this.titular();
    if (!titular) return;
    if (this.actual && this.enCurso === clave) this.actual.abort();
    // El paso intermedio de un conjunto no se muestra aparte: se borra con su continuación para no dejarlo huérfano.
    const intermedios = (await this.almacen.listar(titular)).filter((s) => s.continuacion === clave);
    for (const clav of [clave, ...intermedios.map((s) => s.clave)]) await this.almacen.eliminarConBorrado(titular, clav);
    this.avisar();
    void this.sincronizar();
  }

  async reintentar(clave: string): Promise<void> {
    const titular = await this.titular();
    const s = titular ? await this.almacen.obtener(titular, clave) : undefined;
    if (!s || s.estado !== "ERROR" || !s.persona || !s.ropa) return;
    await this.almacen.guardar({ ...s, estado: "PENDIENTE", mensaje: "Lista para reintentar.", intentos: 0, fallosServidor: 0, proximo: 0, actualizado: this.ahora() });
    this.avisar();
    void this.sincronizar();
  }

  /** Borra todas las imágenes y solicitudes de esta cuenta en el dispositivo y, con red, también en el servidor. */
  async borrarMias(): Promise<void> {
    const titular = await this.titular();
    if (!titular) return;
    this.actual?.abort();
    for (const s of await this.almacen.listar(titular)) await this.almacen.eliminar(titular, s.clave);
    await this.almacen.eliminarConBorrado(titular, "*");
    this.avisar();
    void this.sincronizar();
  }

  private enCurso: string | null = null;

  /** Continúa un conjunto: encola la segunda prenda sobre el resultado de la primera. Devuelve la nueva solicitud. */
  private async encadenar(s: SolicitudFotografica): Promise<SolicitudFotografica | null> {
    if (!s.siguiente || !s.resultado) return null;
    const vigente = () => this.almacen.obtener(s.titular, s.clave);
    try {
      const nueva = await this.encolar(s.resultado, s.siguiente.prenda, s.siguiente.ropa, { base: s.prenda });
      const actual = await vigente();
      if (!actual) {
        // Se eliminó mientras se encolaba: la continuación tampoco debe quedar.
        await this.eliminar(nueva.clave);
        return null;
      }
      await this.almacen.guardar({ ...actual, siguiente: undefined, continuacion: nueva.clave, actualizado: this.ahora() });
      this.avisar();
      return nueva;
    } catch (error) {
      // Cola llena o sin sesión: se reintenta al sincronizar de nuevo; el resultado de la primera prenda ya está guardado.
      const actual = await vigente();
      if (!actual) return null;
      await this.almacen.guardar({ ...actual, mensaje: `Primera prenda lista. ${error instanceof Error ? error.message : "No se pudo continuar con la segunda."}` });
      this.avisar();
      return null;
    }
  }

  /** Procesa borrados y solicitudes vencidas de la cuenta activa. Si ya corre, repite al terminar y devuelve esa espera. */
  sincronizar(): Promise<void> {
    if (this.enProceso) { this.otraVez = true; return this.enProceso; }
    this.enProceso = (async () => {
      try {
        do {
          this.otraVez = false;
          await (this.opciones.exclusivo ?? ((t) => t()))(() => this.procesar());
        } while (this.otraVez);
      } finally {
        this.enProceso = null;
        this.avisar();
      }
    })();
    return this.enProceso;
  }

  /** Próximo instante en que conviene volver a sincronizar, o null si no hay nada pendiente. */
  async proximoIntento(): Promise<number | null> {
    const pendientes = (await this.listar()).filter((s) => s.estado === "PENDIENTE");
    return pendientes.length ? Math.min(...pendientes.map((s) => s.proximo)) : null;
  }

  private async procesar(): Promise<void> {
    const titular = await this.titular();
    if (!titular) return;
    // Recuperación al abrir: una espera interrumpida vuelve a la cola; otro motor exige recalcular la clave.
    for (const s of await this.almacen.listar(titular)) {
      if (s.estado === "ENVIANDO") await this.almacen.guardar({ ...s, estado: "PENDIENTE", remoto: undefined, mensaje: "Se reanudará la solicitud interrumpida.", proximo: 0 });
      else if (s.estado === "LISTO" && s.siguiente) await this.encadenar(s); // Se cerró la página entre las dos prendas.
      else if (obsoleta(s) && s.persona && s.ropa) {
        await this.almacen.eliminar(titular, s.clave);
        await this.encolarDeNuevo(s);
      }
    }
    if (this.opciones.enLinea && !this.opciones.enLinea()) return;
    const { cabeceras } = await this.sesion();
    if (!cabeceras["Authorization"]) return;
    try {
      for (const clave of await this.almacen.borrados(titular)) {
        await this.servidor.invalidar(clave, cabeceras);
        await this.almacen.confirmarBorrado(titular, clave);
      }
    } catch {
      return; // Sin red o sin sesión: los borrados son durables y van antes que cualquier envío nuevo.
    }
    const vencidas = (await this.almacen.listar(titular))
      .filter((s) => s.estado === "PENDIENTE" && s.proximo <= this.ahora())
      .sort((a, b) => a.creado - b.creado);
    for (const s of vencidas) {
      if ((await this.titular()) !== titular) return;
      if (!(await this.enviar(s))) return; // Corte de red: no seguir golpeando el servidor.
    }
  }

  private async encolarDeNuevo(s: SolicitudFotografica): Promise<void> {
    const [fotoHash, ropaHash] = await Promise.all([this.opciones.huella(await s.persona!.arrayBuffer()), this.opciones.huella(await s.ropa!.arrayBuffer())]);
    const clave = await this.opciones.huella(new TextEncoder().encode(especificacionClave(s.titular, fotoHash, s.prenda, ropaHash)).buffer as ArrayBuffer);
    await this.almacen.guardar({ ...s, clave, version: VERSION_MOTOR, estado: "PENDIENTE", mensaje: "Actualizada para el motor vigente.", proximo: 0, remoto: undefined });
  }

  /** Devuelve false si conviene detener el lote (red o sesión). */
  private async enviar(s: SolicitudFotografica): Promise<boolean> {
    const control = new AbortController();
    this.actual = control;
    this.enCurso = s.clave;
    const vigente = async () => !control.signal.aborted && (await this.almacen.obtener(s.titular, s.clave)) !== undefined;
    const actualizar = async (cambios: Partial<SolicitudFotografica>) => {
      const guardada = control.signal.aborted ? undefined : await this.almacen.obtener(s.titular, s.clave);
      if (!guardada) throw new DOMException("Solicitud eliminada", "AbortError");
      // Sobre lo guardado y no sobre la copia local: mientras se enviaba, el usuario pudo convertirla en un conjunto.
      s = { ...guardada, ...cambios, actualizado: this.ahora() };
      await this.almacen.guardar(s);
      this.avisar();
    };
    try {
      await actualizar({ estado: "ENVIANDO", mensaje: "Enviando tu foto a CLB…", remoto: undefined });
      const cabeceras = async () => {
        const actual = await this.sesion();
        if (actual.titular !== s.titular) throw new DOMException("La sesión cambió", "AbortError");
        if (!actual.cabeceras["Authorization"]) throw new ErrorSesion("Inicia sesión de nuevo para continuar.");
        return actual.cabeceras;
      };
      let remoto = await this.servidor.enviar(s, await cabeceras(), control.signal);
      if (remoto.identificador !== s.clave) throw new Error("La versión de la aplicación no coincide con la del servidor. Recarga la página.");
      while (remoto.estado === "PENDIENTE" || remoto.estado === "PROCESANDO") {
        await actualizar({
          remoto: remoto.estado,
          mensaje: remoto.estado === "PENDIENTE" ? "En cola en el servidor de CLB." : "Generando la imagen con IA.",
        });
        await (this.opciones.sondeo ?? esperar)(control.signal);
        remoto = await this.servidor.consultar(s.clave, await cabeceras(), control.signal);
      }
      if (remoto.estado === "ERROR") {
        if (!remoto.reintentable) throw new Error(remoto.mensaje || "No se pudo generar la imagen con esta foto.");
        throw new ErrorTemporal(remoto.mensaje || "El servidor de imágenes tuvo un problema.");
      }
      const resultado = await this.servidor.descargar(s.clave, await cabeceras(), control.signal);
      await actualizar({ estado: "LISTO", resultado, persona: undefined, ropa: undefined, remoto: undefined, mensaje: s.siguiente ? `${s.prenda.nombre} lista. Sigue ${s.siguiente.prenda.nombre}.` : "Imagen guardada en este dispositivo." });
      await this.encadenar(s);
      await this.podar(s.titular);
      return true;
    } catch (error) {
      if (!(await vigente().catch(() => false))) return true; // Eliminada o sesión cambiada durante la espera.
      if (error instanceof ErrorSesion) {
        await actualizar({ estado: "PENDIENTE", remoto: undefined, mensaje: error.message, proximo: this.ahora() + 30_000 });
        return false;
      }
      const intentos = s.intentos + 1;
      if (error instanceof ErrorRed) {
        // Sin red nunca se agota la solicitud: solo se espacian los intentos.
        await actualizar({ estado: "PENDIENTE", remoto: undefined, intentos, proximo: this.ahora() + esperaReintento(intentos, this.opciones.azar), mensaje: error instanceof ErrorNoDisponible ? error.message : sinRed });
        return false;
      }
      if (error instanceof ErrorTemporal) {
        const fallosServidor = s.fallosServidor + 1;
        await actualizar(fallosServidor >= MAXIMO_FALLOS_SERVIDOR
          ? { estado: "ERROR", remoto: undefined, intentos, fallosServidor, mensaje: `${error.message} Pulsa «Reintentar» cuando quieras volver a intentarlo.` }
          : { estado: "PENDIENTE", remoto: undefined, intentos, fallosServidor, proximo: this.ahora() + esperaReintento(intentos, this.opciones.azar), mensaje: `${error.message} Se reintentará automáticamente.` });
        return false; // Servidor ocupado o caído: las demás solicitudes esperan su turno.
      }
      await actualizar({ estado: "ERROR", remoto: undefined, intentos, mensaje: error instanceof Error ? error.message : "No se pudo generar la imagen." });
      return true;
    } finally {
      if (this.actual === control) { this.actual = null; this.enCurso = null; }
    }
  }

  private async podar(titular: string): Promise<void> {
    const listas = (await this.almacen.listar(titular)).filter((s) => s.estado === "LISTO").sort((a, b) => b.actualizado - a.actualizado);
    for (const s of listas.slice(MAXIMO_RESULTADOS)) await this.almacen.eliminarConBorrado(titular, s.clave);
  }

  /** Cerrar sesión en un dispositivo compartido: no quedan fotos privadas de nadie. */
  async borrarDatosLocales(): Promise<void> {
    this.actual?.abort();
    await this.almacen.borrarTodo();
    this.avisar();
  }
}

function esperar(señal: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (señal.aborted) return rechazar(señal.reason);
    const reloj = setTimeout(() => { señal.removeEventListener("abort", terminar); resolver(); }, 2_000 + Math.random() * 1_000);
    const terminar = () => { clearTimeout(reloj); rechazar(señal.reason); };
    señal.addEventListener("abort", terminar, { once: true });
  });
}
