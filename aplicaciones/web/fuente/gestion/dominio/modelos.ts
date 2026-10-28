/** Gestión empresarial (fase 8): lo que devuelven los agentes del microservicio de IA y cómo se dibuja un reporte. */

export type Agente = "monitoreo" | "reportes" | "inventario" | "clientes";
export type Visualizacion = "TABLA" | "BARRAS" | "LINEAS" | "KPI";
export type Destino = "PANEL" | "VISTA" | "HISTORIAL";

export interface Fuente { herramienta: string; argumentos: Record<string, unknown>; resultado: unknown }

export interface RespuestaAgente {
  agente: Agente;
  respuesta: string;
  fuentes: Fuente[];
  generativa: boolean;
  herramientas_permitidas: string[];
  observacion?: string;
  respuesta_descartada?: string;
}

export interface ResultadoMision { mision: string; agentes: RespuestaAgente[]; generativa: boolean; fecha: string }

export interface Especificacion {
  titulo: string;
  metrica: "UNIDADES" | "MONTO" | "PEDIDOS";
  agrupar_por: string | null;
  periodo: "HOY" | "SEMANA" | "MES" | "TODO";
  visualizacion: Visualizacion;
  destino: Destino;
  limite: number;
}

export interface Fila { clave: string; valor: number }

export interface DatosReporte { titulo: string; unidad: string; total: number; filas: Fila[]; pedidos: number; unidades: number; monto: string; datos_al: string | null }

export interface Reporte {
  identificador: string;
  peticion: string | null;
  salida_modelo: string | null;
  especificacion: Especificacion;
  generativa: boolean;
  observacion: string | null;
  datos: DatosReporte;
  datos_al: string | null;
  fecha: string;
}

export interface Propuesta {
  identificador: string; variante: string; sku: string; cantidad: number; motivo: string; fecha: string;
  estado: "PENDIENTE" | "CONFIRMANDO" | "REQUIERE_REVISION" | "CONFIRMADA" | "RECHAZADA";
  disponible: number | null; minimo: number | null;
}

export const PROPUESTA_ABIERTA: Propuesta["estado"][] = ["PENDIENTE", "CONFIRMANDO", "REQUIERE_REVISION"];
export interface VarianteStock { identificador: string; sku: string; nombre: string; talla: string; color: string; disponible: number; minimo: number }
export interface Alerta { sku: string; nombre: string; disponible: number; minimo: number; fecha: string }
/** Alerta accionable que crea la automatización n8n (flujo A) y que una persona marca como atendida. */
export interface Notificacion {
  evento: string; producto: string; sku: string; talla: string; color: string; disponible: number; minimo: number;
  mensaje: string; origen: string; estado: "NUEVA" | "ATENDIDA"; fecha_evento: string; fecha: string;
  atendida_por: string | null; fecha_atencion: string | null;
}
export interface Segmento { grupo: number; nombre: string; descripcion: string; clientes: number; recenciaDias: number; frecuencia: number; montoBs: number; diversidad: number }
export interface Segmentacion { clientes: number; silueta: number | null; datosAl: string | null; segmentos: Segmento[] }
export interface Auditoria { identificador: number; fecha: string; usuario: string; agente: string; herramienta: string; argumentos: unknown; permitido: boolean; resultado: string }

export const NOMBRES_AGENTE: Record<Agente, string> = {
  monitoreo: "Monitoreo", reportes: "Reportes", inventario: "Inventario", clientes: "Clientes",
};

export const PERIODOS: Record<Especificacion["periodo"], string> = { HOY: "hoy", SEMANA: "últimos 7 días", MES: "últimos 30 días", TODO: "todo el historial" };

/** Valor legible: los montos con dos decimales y separador de miles boliviano (1.320,00 Bs). */
export function formatoValor(valor: number, unidad: string): string {
  if (unidad === "Bs") return valor.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Bs";
  return valor.toLocaleString("es-BO") + (unidad ? " " + unidad : "");
}

/** Marcas de eje «limpias» (1, 2, 5 × 10ⁿ) que cubren el máximo. */
export function marcasEje(maximo: number, cantidad = 4): number[] {
  if (!(maximo > 0)) return [0, 1];
  const paso0 = maximo / cantidad;
  const potencia = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * potencia).find(p => p >= paso0) ?? 10 * potencia;
  const marcas: number[] = [];
  for (let v = 0; v < maximo + paso - 1e-9; v += paso) marcas.push(Math.round(v * 1e6) / 1e6);
  return marcas;
}

/** Etiqueta compacta para el eje: 1.200 → 1,2 mil. */
export function compacto(valor: number): string {
  return valor >= 1000 ? (valor / 1000).toLocaleString("es-BO", { maximumFractionDigits: 1 }) + " mil" : valor.toLocaleString("es-BO");
}
