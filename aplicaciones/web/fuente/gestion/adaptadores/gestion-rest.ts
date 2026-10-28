import { InjectionToken } from "@angular/core";
import { ErrorRemoto } from "../../catalogo/dominio/modelos";
import type { CredencialesAdministrativas } from "../../administracion/adaptadores/administracion-rest";
import { PROPUESTA_ABIERTA } from "../dominio/modelos";
import type {
  Alerta, Auditoria, Destino, Especificacion, Notificacion, Propuesta, Reporte, ResultadoMision, Segmentacion, VarianteStock,
} from "../dominio/modelos";

export const GESTION_REST = new InjectionToken<GestionRest>("CLB Gestión REST");

const CONSULTA_INVENTARIO = `{ stockBajo { identificador sku nombre talla color disponible minimo }
  alertas(limite: 10) { sku nombre disponible minimo fecha } }`;
const CONSULTA_SEGMENTOS = `{ segmentosClientes { clientes silueta datosAl
  segmentos { grupo nombre descripcion clientes recenciaDias frecuencia montoBs diversidad } } }`;

/**
 * Adaptador REST/GraphQL hacia el microservicio de IA (gestión empresarial, rol admin). GraphQL solo se usa aquí:
 * la tienda, Android y los servicios entre sí siguen con REST.
 */
export class GestionRest {
  constructor(private readonly url: string, private readonly credenciales: CredencialesAdministrativas) {}

  mision(mision: string): Promise<ResultadoMision> {
    return this.json("/agentes/misiones", { method: "POST", body: JSON.stringify({ mision }) });
  }

  reporte(solicitud: { peticion?: string; especificacion?: Especificacion; destino?: Destino }): Promise<Reporte> {
    return this.json("/reportes", { method: "POST", body: JSON.stringify(solicitud) });
  }

  async historial(): Promise<Reporte[]> {
    return (await this.json<{ reportes: Reporte[] }>("/reportes?limite=20")).reportes;
  }

  reporteGuardado(identificador: string): Promise<Reporte> {
    return this.json("/reportes/" + encodeURIComponent(identificador));
  }

  async excel(identificador: string): Promise<Blob> {
    return (await this.solicitar("/reportes/" + encodeURIComponent(identificador) + "/excel")).blob();
  }

  async propuestas(): Promise<Propuesta[]> {
    const { propuestas } = await this.json<{ propuestas: Propuesta[] }>("/agentes/propuestas");
    return propuestas.filter(propuesta => PROPUESTA_ABIERTA.includes(propuesta.estado));
  }

  resolver(identificador: string, accion: "confirmar" | "rechazar"): Promise<Propuesta> {
    return this.json(`/agentes/propuestas/${encodeURIComponent(identificador)}/${accion}`, { method: "POST" });
  }

  async notificaciones(): Promise<Notificacion[]> {
    return (await this.json<{ notificaciones: Notificacion[] }>("/notificaciones?estado=NUEVA")).notificaciones;
  }

  async atender(evento: string): Promise<Notificacion> {
    return (await this.json<{ notificacion: Notificacion }>(`/notificaciones/${encodeURIComponent(evento)}/atender`, { method: "POST" })).notificacion;
  }

  async auditoria(): Promise<Auditoria[]> {
    return (await this.json<{ auditoria: Auditoria[] }>("/agentes/auditoria?limite=40")).auditoria;
  }

  inventario(): Promise<{ stockBajo: VarianteStock[]; alertas: Alerta[] }> {
    return this.graphql(CONSULTA_INVENTARIO);
  }

  async segmentos(): Promise<Segmentacion> {
    return (await this.graphql<{ segmentosClientes: Segmentacion }>(CONSULTA_SEGMENTOS)).segmentosClientes;
  }

  async transcribir(audio: Blob): Promise<string> {
    const formulario = new FormData();
    formulario.append("audio", audio, "voz.webm");
    return (await this.json<{ texto: string }>("/voz", { method: "POST", body: formulario })).texto;
  }

  private async graphql<T>(query: string): Promise<T> {
    const cuerpo = await this.json<{ data?: T; errors?: { message: string }[] }>("/graphql", { method: "POST", body: JSON.stringify({ query }) });
    if (cuerpo.errors?.length || !cuerpo.data) throw new Error(cuerpo.errors?.[0]?.message ?? "La consulta de gestión no devolvió datos.");
    return cuerpo.data;
  }

  private async json<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
    return (await this.solicitar(ruta, opciones)).json() as Promise<T>;
  }

  private async solicitar(ruta: string, opciones: RequestInit = {}): Promise<Response> {
    if (navigator.onLine === false) throw new ErrorRemoto(0, "La gestión empresarial necesita conexión: los agentes trabajan en el servidor.");
    const credenciales = await this.credenciales.cabeceras();
    if (!credenciales["Authorization"]) throw new ErrorRemoto(401, "Inicia sesión como administrador para usar la gestión.");
    const json: Record<string, string> = typeof opciones.body === "string" ? { "Content-Type": "application/json" } : {};
    let respuesta: Response;
    try {
      respuesta = await fetch(this.url + ruta, { ...opciones, cache: "no-store", headers: { Accept: "application/json", ...json, ...credenciales } });
    } catch {
      throw new ErrorRemoto(0, "No se pudo contactar al servicio de IA. Revisa la conexión e inténtalo otra vez.");
    }
    if (respuesta.ok) return respuesta;
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (respuesta.status === 502 || respuesta.status === 504)
      throw new ErrorRemoto(respuesta.status, "El servicio de IA no está disponible. El catálogo y las compras siguen funcionando con normalidad.");
    throw new ErrorRemoto(respuesta.status, cuerpo.mensaje ?? "El servicio de IA no pudo atender la solicitud.", cuerpo);
  }
}
