import { InjectionToken } from "@angular/core";
import { ErrorRemoto } from "../../catalogo/dominio/modelos";
import type { CredencialesAdministrativas } from "../../administracion/adaptadores/administracion-rest";
import { PROPUESTA_ABIERTA } from "../dominio/modelos";
import type {
  Alerta, Auditoria, Destino, Especificacion, Notificacion, Propuesta, Reporte, ResultadoMision, Segmentacion, VarianteStock,
} from "../dominio/modelos";
import type { EspecificacionV2, Formato } from "../dominio/reportes-v2";

export const GESTION_REST = new InjectionToken<GestionRest>("CLB Gestión REST");

export interface SolicitudReporte {
  peticion?: string; especificacion?: Especificacion | EspecificacionV2; destino?: Destino; formatos?: Formato[];
}

const CONSULTA_INVENTARIO = `{ stockBajo { identificador sku nombre talla color disponible minimo }
  alertas(limite: 10) { sku nombre disponible minimo fecha } }`;
const CONSULTA_SEGMENTOS = `{ segmentosClientes { clientes silueta datosAl
  segmentos { grupo nombre descripcion clientes recenciaDias frecuencia montoBs diversidad } } }`;
// Los alias devuelven los nombres que ya usa el dominio (p. ej. datos_al), así el modelo no cambia con el transporte.
const CAMPOS_REPORTE = "identificador peticion salida_modelo: salidaModelo especificacion generativa observacion datos datos_al: datosAl fecha "
  + "interpretacion procedencia";
const CAMPOS_PROPUESTA = "identificador variante sku cantidad motivo fecha estado disponible minimo";
const CAMPOS_NOTIFICACION = "evento producto sku talla color disponible minimo mensaje origen estado fecha_evento: fechaEvento fecha "
  + "atendida_por: atendidaPor fecha_atencion: fechaAtencion";

interface ErrorGraphQL { message: string; extensions?: { codigo?: string; estado_http?: number; [clave: string]: unknown } }

/**
 * Adaptador de la gestión empresarial (rol admin) hacia el microservicio de IA. Las consultas y acciones de negocio van
 * por GraphQL (R5); REST solo transfiere archivos: audio a transcribir y descarga del Excel. La tienda y los servicios
 * entre sí siguen con REST.
 */
export class GestionRest {
  constructor(private readonly url: string, private readonly credenciales: CredencialesAdministrativas) {}

  async mision(mision: string): Promise<ResultadoMision> {
    return (await this.graphql<{ ejecutarMision: ResultadoMision }>(
      "mutation($m: String!) { ejecutarMision(mision: $m) { mision agentes generativa fecha } }", { m: mision })).ejecutarMision;
  }

  /** `formatos`: la elección explícita en la pantalla; si falta, vale lo que diga la petición. */
  async reporte(solicitud: SolicitudReporte): Promise<Reporte> {
    return (await this.graphql<{ generarReporte: Reporte }>(
      `mutation($p: String, $e: JSON, $d: DestinoReporte, $f: [FormatoReporte!]) {
        generarReporte(peticion: $p, especificacion: $e, destino: $d, formatos: $f) { ${CAMPOS_REPORTE} } }`,
      { p: solicitud.peticion ?? null, e: solicitud.especificacion ?? null, d: solicitud.destino ?? null,
        f: solicitud.formatos ?? null })).generarReporte;
  }

  async historial(): Promise<Reporte[]> {
    return (await this.graphql<{ reportes: Reporte[] }>(`{ reportes(limite: 20) { ${CAMPOS_REPORTE} } }`)).reportes;
  }

  async reporteGuardado(identificador: string): Promise<Reporte> {
    return (await this.graphql<{ reporte: Reporte }>(
      `query($i: UUID!) { reporte(identificador: $i) { ${CAMPOS_REPORTE} } }`, { i: identificador })).reporte;
  }

  /** Descarga binaria por REST (Excel o PDF): los mismos datos guardados del reporte. */
  async archivo(identificador: string, formato: "excel" | "pdf"): Promise<Blob> {
    return (await this.solicitar("/reportes/" + encodeURIComponent(identificador) + "/" + formato)).blob();
  }

  excel(identificador: string): Promise<Blob> {
    return this.archivo(identificador, "excel");
  }

  async propuestas(): Promise<Propuesta[]> {
    const { propuestas } = await this.graphql<{ propuestas: Propuesta[] }>(`{ propuestas { ${CAMPOS_PROPUESTA} } }`);
    return propuestas.filter(propuesta => PROPUESTA_ABIERTA.includes(propuesta.estado));
  }

  async resolver(identificador: string, accion: "confirmar" | "rechazar"): Promise<Propuesta> {
    return (await this.graphql<{ resolverPropuesta: Propuesta }>(
      `mutation($i: UUID!, $c: Boolean!) { resolverPropuesta(identificador: $i, confirmar: $c) { ${CAMPOS_PROPUESTA} } }`,
      { i: identificador, c: accion === "confirmar" })).resolverPropuesta;
  }

  async notificaciones(): Promise<Notificacion[]> {
    return (await this.graphql<{ notificaciones: Notificacion[] }>(`{ notificaciones(estado: NUEVA) { ${CAMPOS_NOTIFICACION} } }`)).notificaciones;
  }

  async atender(evento: string): Promise<Notificacion> {
    return (await this.graphql<{ atenderNotificacion: Notificacion }>(
      `mutation($e: UUID!) { atenderNotificacion(evento: $e) { ${CAMPOS_NOTIFICACION} } }`, { e: evento })).atenderNotificacion;
  }

  async auditoria(): Promise<Auditoria[]> {
    return (await this.graphql<{ auditoria: Auditoria[] }>(
      "{ auditoria(limite: 40) { identificador fecha usuario agente herramienta argumentos permitido resultado } }")).auditoria;
  }

  inventario(): Promise<{ stockBajo: VarianteStock[]; alertas: Alerta[] }> {
    return this.graphql(CONSULTA_INVENTARIO);
  }

  async segmentos(): Promise<Segmentacion> {
    return (await this.graphql<{ segmentosClientes: Segmentacion }>(CONSULTA_SEGMENTOS)).segmentosClientes;
  }

  /** Transferencia del audio por REST (multipart); el texto vuelve editable antes de pedir el reporte. */
  async transcribir(audio: Blob): Promise<string> {
    const formulario = new FormData();
    formulario.append("audio", audio, "voz.webm");
    return (await this.json<{ texto: string }>("/voz", { method: "POST", body: formulario })).texto;
  }

  /** Los errores de negocio traen `estado_http` y `codigo`: se entregan como el mismo ErrorRemoto que REST. */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const cuerpo = await this.json<{ data?: T; errors?: ErrorGraphQL[] }>("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) });
    const error = cuerpo.errors?.[0];
    if (error) {
      const { estado_http: estado, codigo, ...resto } = error.extensions ?? {};
      if (typeof estado === "number") throw new ErrorRemoto(estado, error.message, { código: codigo, ...resto });
      throw new Error(error.message);
    }
    if (!cuerpo.data) throw new Error("La consulta de gestión no devolvió datos.");
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
