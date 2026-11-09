/** Gestión empresarial (fase 8): lo que devuelven los agentes del microservicio de IA y cómo se dibuja un reporte. */
import type { DatosReporteV2, EspecificacionV2, Procedencia } from "./reportes-v2";

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

export type Metrica = "UNIDADES" | "MONTO" | "PEDIDOS";
export type Agrupacion = "TALLA" | "COLOR" | "CATEGORIA" | "PRODUCTO" | "DIA";
export type Orden = "METRICA_DESC" | "METRICA_ASC" | "CLAVE_ASC";
export interface Filtros { categoria?: string | null; talla?: string | null; color?: string | null; producto?: string | null }

export interface Especificacion {
  titulo: string;
  metrica: Metrica;
  agrupar_por: Agrupacion | null;
  periodo: "HOY" | "SEMANA" | "MES" | "TODO" | "RANGO";
  visualizacion: Visualizacion;
  destino: Destino;
  limite: number;
  // Ampliación de reportes (opcional: el historial anterior no la trae).
  metricas_extra?: Metrica[];
  filtros?: Filtros | null;
  desde?: string | null;
  hasta?: string | null;
  orden?: Orden;
}

/** `valor` es la métrica principal; `valores` trae también las columnas extra pedidas. */
export interface Fila { clave: string; valor: number; valores?: Partial<Record<Metrica, number>> }

export interface DatosReporte {
  titulo: string; unidad: string; total: number; filas: Fila[]; pedidos: number; unidades: number; monto: string; datos_al: string | null;
  columnas?: Metrica[]; totales?: Partial<Record<Metrica, number>>;
}

export interface Reporte {
  identificador: string;
  peticion: string | null;
  salida_modelo: string | null;
  /** v1 (historial anterior) o v2 (catálogo); se distinguen con `esV2(especificacion)`. */
  especificacion: Especificacion | EspecificacionV2;
  generativa: boolean;
  observacion: string | null;
  datos: DatosReporte | DatosReporteV2;
  procedencia?: Procedencia;
  datos_al: string | null;
  fecha: string;
  /** Lo que se entendió (métricas, agrupación, periodo, filtros y orden), calculado por el servidor. */
  interpretacion?: string;
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

export const PERIODOS: Record<Especificacion["periodo"], string> = {
  HOY: "hoy", SEMANA: "últimos 7 días", MES: "últimos 30 días", TODO: "todo el historial", RANGO: "rango de fechas",
};
export const METRICAS: Record<Metrica, string> = { UNIDADES: "Unidades vendidas", MONTO: "Ventas en Bs", PEDIDOS: "Pedidos" };
export const AGRUPACIONES: Record<Agrupacion, string> = { TALLA: "Talla", COLOR: "Color", CATEGORIA: "Categoría", PRODUCTO: "Producto", DIA: "Día" };
export const ORDENES: Record<Orden, string> = { METRICA_DESC: "De mayor a menor", METRICA_ASC: "De menor a mayor", CLAVE_ASC: "Alfabético" };

/** Minutos desde la última sincronización del modelo de lectura; `null` si nunca llegaron datos. */
export function minutosDesde(fecha: string | null, ahora = Date.now()): number | null {
  if (!fecha) return null;
  const ms = ahora - new Date(fecha).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : null;
}

/** Valor legible: los montos con dos decimales y separador de miles boliviano (Bs 1.320,00), igual que tabla, PDF y Excel. */
export function formatoValor(valor: number, unidad: string): string {
  if (unidad === "Bs") return "Bs " + valor.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
