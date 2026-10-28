import { ErrorNoDisponible, ErrorRed, ErrorSesion, ErrorTemporal, type EstadoRemoto, type ServidorFotografico } from "../aplicacion/probador-fotografico";
import type { SolicitudFotografica } from "../dominio/solicitud-fotografica";

const API = "/api/v1/probador/trabajos";
const CLAVE = /^[a-f0-9]{64}$/;

export const huellaSha256 = async (datos: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", datos))].map((v) => v.toString(16).padStart(2, "0")).join("");

/** REST del worker por la pasarela. Traduce transporte y HTTP a errores de la cola: red, temporal, sesión o definitivo. */
export class ProbadorFotograficoRest implements ServidorFotografico {
  private async solicitar(ruta: string, opciones: RequestInit = {}): Promise<Response> {
    const plazo = AbortSignal.timeout(60_000);
    try {
      const respuesta = await fetch(ruta, { ...opciones, signal: opciones.signal ? AbortSignal.any([opciones.signal, plazo]) : plazo, cache: "no-store" });
      if (respuesta.status === 401) throw new ErrorSesion("Tu sesión venció. Inicia sesión para continuar; la solicitud sigue guardada.");
      // Caído, reiniciándose u ocupado: se reintenta sin tope porque el servidor no llegó a generar nada.
      if ([502, 503, 504].includes(respuesta.status)) throw new ErrorNoDisponible("El servidor de imágenes no está disponible ahora. Tu foto sigue guardada y se reintentará.");
      if ([408, 425, 429].includes(respuesta.status)) throw new ErrorNoDisponible("El probador está ocupado. Tu foto sigue guardada y se reintentará.");
      return respuesta;
    } catch (error) {
      if (opciones.signal?.aborted) throw error;
      if (error instanceof ErrorSesion || error instanceof ErrorTemporal || error instanceof ErrorRed) throw error;
      throw new ErrorRed("No hay conexión con CLB.");
    }
  }

  private async estado(respuesta: Response): Promise<EstadoRemoto> {
    const datos = await respuesta.json().catch(() => null) as (EstadoRemoto & { mensaje?: string }) | null;
    if (!datos) throw new ErrorTemporal("El servidor de imágenes respondió de forma inesperada.");
    if (!respuesta.ok) throw new Error(datos.mensaje || "No se pudo generar la imagen con esta foto.");
    if (!CLAVE.test(datos.identificador ?? "")) throw new ErrorTemporal("El servidor de imágenes respondió de forma inesperada.");
    return datos;
  }

  async enviar(s: SolicitudFotografica, cabeceras: Record<string, string>, señal: AbortSignal): Promise<EstadoRemoto> {
    const formulario = new FormData();
    formulario.set("persona", s.persona!, "persona");
    formulario.set("prenda", s.ropa!, "prenda.png");
    formulario.set("identificador", s.prenda.identificador);
    formulario.set("categoria", s.prenda.categoría);
    // Tras un ERROR reintentable el servidor regenera solo; nunca se fuerza para no duplicar trabajo GPU.
    formulario.set("force_regenerate", "false");
    return this.estado(await this.solicitar(API, { method: "POST", headers: cabeceras, body: formulario, signal: señal }));
  }

  async consultar(clave: string, cabeceras: Record<string, string>, señal: AbortSignal): Promise<EstadoRemoto> {
    const respuesta = await this.solicitar(`${API}/${clave}`, { headers: cabeceras, signal: señal });
    // 404: venció o se reinició sin estado; reenviar con la misma clave lo recrea.
    if (respuesta.status === 404) throw new ErrorTemporal("La solicitud ya no estaba en el servidor; se enviará de nuevo.");
    return this.estado(respuesta);
  }

  async descargar(clave: string, cabeceras: Record<string, string>, señal: AbortSignal): Promise<Blob> {
    const respuesta = await this.solicitar(`${API}/${clave}/imagen`, { headers: cabeceras, signal: señal });
    if (!respuesta.ok || !respuesta.headers.get("Content-Type")?.startsWith("image/png")) throw new ErrorTemporal("No se pudo descargar el resultado.");
    const datos = await respuesta.arrayBuffer();
    const esperada = respuesta.headers.get("X-Contenido-SHA256");
    if (esperada && (await huellaSha256(datos)) !== esperada) throw new ErrorTemporal("La descarga llegó incompleta.");
    return new Blob([datos], { type: "image/png" });
  }

  async invalidar(clave: string, cabeceras: Record<string, string>): Promise<void> {
    const respuesta = await this.solicitar(clave === "*" ? API : `${API}/${clave}`, { method: "DELETE", headers: cabeceras });
    if (!respuesta.ok && respuesta.status !== 404) throw new ErrorTemporal("No se pudo borrar en el servidor.");
  }
}
