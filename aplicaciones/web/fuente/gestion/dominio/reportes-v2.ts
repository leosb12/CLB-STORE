/**
 * Reportes v2: catálogo explícito de campos (mismo contrato que valida IA en `dominio/catalogo_reportes.py`).
 * Aquí solo se describe para dibujar y editar; el servidor vuelve a validar todo.
 */

export type TipoDato = "TEXTO" | "ENTERO" | "DINERO" | "FECHA" | "BOOLEANO";
export type ClaseCampo = "DIMENSION" | "VALOR" | "METRICA";
export type FuenteReporte = "VENTAS" | "INVENTARIO";
export type Formato = "PANTALLA" | "PDF" | "EXCEL";
export type Procedencia = "MODELO" | "REGLAS" | "MANUAL";
export type PeriodoV2 = "HOY" | "AYER" | "ESTA_SEMANA" | "SEMANA_PASADA" | "ULTIMOS_7_DIAS" | "ESTE_MES" | "MES_PASADO"
  | "ULTIMOS_30_DIAS" | "TODO" | "RANGO";
export type Operador = "IGUAL" | "CONTIENE" | "MAYOR_O_IGUAL" | "MENOR_O_IGUAL";
export type Celda = string | number | boolean | null;

export interface FiltroV2 { campo: string; operador: Operador; valor: string }
export interface EspecificacionV2 {
  version: 2;
  titulo: string;
  fuente: FuenteReporte;
  tipo: "DETALLE" | "AGREGADO";
  columnas: string[];
  filtros: FiltroV2[];
  periodo: PeriodoV2;
  desde?: string | null;
  hasta?: string | null;
  orden: { campo: string; direccion: "ASC" | "DESC" }[];
  limite: number;
  grafico: { tipo: "NINGUNO" | "BARRAS" | "LINEAS"; eje?: string | null; valor?: string | null };
  formatos: Formato[];
}
export interface ColumnaReporte { campo: string; etiqueta: string; tipo: TipoDato }
export interface GraficoV2 {
  tipo: "BARRAS" | "LINEAS"; eje: string; valor: string; etiqueta_eje: string; etiqueta_valor: string; tipo_valor: TipoDato;
  puntos: { clave: string; valor: number }[];
}
export interface DatosReporteV2 {
  version: 2; titulo: string; fuente: FuenteReporte; tipo: "DETALLE" | "AGREGADO";
  columnas: ColumnaReporte[]; filas: Celda[][]; total_filas: number; truncado: boolean;
  totales: Record<string, number>;
  grafico: GraficoV2 | null;
  periodo: { codigo: string; texto: string; desde: string | null; hasta: string | null };
  datos_al: string | null; nombres_al?: string | null; notas: string[];
}

export interface CampoCatalogo { etiqueta: string; tipo: TipoDato; clase: ClaseCampo }
const PRODUCTO: Record<string, CampoCatalogo> = {
  PRODUCTO: { etiqueta: "Producto", tipo: "TEXTO", clase: "DIMENSION" },
  SKU: { etiqueta: "SKU", tipo: "TEXTO", clase: "DIMENSION" },
  CATEGORIA: { etiqueta: "Categoría", tipo: "TEXTO", clase: "DIMENSION" },
  TALLA: { etiqueta: "Talla", tipo: "TEXTO", clase: "DIMENSION" },
  COLOR: { etiqueta: "Color", tipo: "TEXTO", clase: "DIMENSION" },
};
export const CATALOGO_REPORTES: Record<FuenteReporte, Record<string, CampoCatalogo>> = {
  VENTAS: {
    FECHA: { etiqueta: "Fecha", tipo: "FECHA", clase: "DIMENSION" },
    PEDIDO: { etiqueta: "Pedido", tipo: "TEXTO", clase: "DIMENSION" },
    ESTADO: { etiqueta: "Estado", tipo: "TEXTO", clase: "DIMENSION" },
    CLIENTE: { etiqueta: "Cliente", tipo: "TEXTO", clase: "DIMENSION" },
    ...PRODUCTO,
    CANTIDAD: { etiqueta: "Cantidad", tipo: "ENTERO", clase: "VALOR" },
    PRECIO_UNITARIO: { etiqueta: "Precio unitario", tipo: "DINERO", clase: "VALOR" },
    SUBTOTAL: { etiqueta: "Total comprado", tipo: "DINERO", clase: "VALOR" },
    STOCK_ACTUAL: { etiqueta: "Stock disponible actual", tipo: "ENTERO", clase: "VALOR" },
    UNIDADES: { etiqueta: "Unidades", tipo: "ENTERO", clase: "METRICA" },
    MONTO: { etiqueta: "Ventas (Bs)", tipo: "DINERO", clase: "METRICA" },
    PEDIDOS: { etiqueta: "Pedidos", tipo: "ENTERO", clase: "METRICA" },
    CLIENTES: { etiqueta: "Clientes", tipo: "ENTERO", clase: "METRICA" },
    PRECIO_PROMEDIO: { etiqueta: "Precio promedio", tipo: "DINERO", clase: "METRICA" },
    TICKET_PROMEDIO: { etiqueta: "Ticket promedio", tipo: "DINERO", clase: "METRICA" },
  },
  INVENTARIO: {
    ...PRODUCTO,
    STOCK_FISICO: { etiqueta: "Stock físico", tipo: "ENTERO", clase: "VALOR" },
    STOCK_RESERVADO: { etiqueta: "Reservado", tipo: "ENTERO", clase: "VALOR" },
    STOCK_DISPONIBLE: { etiqueta: "Disponible", tipo: "ENTERO", clase: "VALOR" },
    STOCK_MINIMO: { etiqueta: "Mínimo", tipo: "ENTERO", clase: "VALOR" },
    STOCK_BAJO: { etiqueta: "Stock bajo", tipo: "BOOLEANO", clase: "VALOR" },
    DISPONIBLE_TOTAL: { etiqueta: "Disponible total", tipo: "ENTERO", clase: "METRICA" },
    FISICO_TOTAL: { etiqueta: "Stock físico total", tipo: "ENTERO", clase: "METRICA" },
    VARIANTES: { etiqueta: "Variantes", tipo: "ENTERO", clase: "METRICA" },
    VARIANTES_STOCK_BAJO: { etiqueta: "Variantes con stock bajo", tipo: "ENTERO", clase: "METRICA" },
  },
};
export const PERIODOS_V2: Record<PeriodoV2, string> = {
  HOY: "Hoy", AYER: "Ayer", ESTA_SEMANA: "Esta semana (desde el lunes)", SEMANA_PASADA: "Semana pasada",
  ULTIMOS_7_DIAS: "Últimos 7 días", ESTE_MES: "Este mes", MES_PASADO: "Mes pasado", ULTIMOS_30_DIAS: "Últimos 30 días",
  TODO: "Todo el historial", RANGO: "Rango de fechas",
};
export const OPERADORES: Record<Operador, string> = { IGUAL: "es", CONTIENE: "contiene", MAYOR_O_IGUAL: "≥", MENOR_O_IGUAL: "≤" };
export const OPERADORES_POR_TIPO: Record<TipoDato, Operador[]> = {
  TEXTO: ["IGUAL", "CONTIENE"], ENTERO: ["IGUAL", "MAYOR_O_IGUAL", "MENOR_O_IGUAL"],
  DINERO: ["IGUAL", "MAYOR_O_IGUAL", "MENOR_O_IGUAL"], BOOLEANO: ["IGUAL"], FECHA: [],
};
/** Salida elegida explícitamente en la interfaz: prevalece sobre lo que diga la petición. */
export const SALIDAS: { id: string; nombre: string; formatos: Formato[] | null }[] = [
  { id: "auto", nombre: "Según la petición", formatos: null },
  { id: "pantalla", nombre: "En pantalla", formatos: ["PANTALLA"] },
  { id: "pdf", nombre: "Solo PDF", formatos: ["PDF"] },
  { id: "excel", nombre: "Solo Excel", formatos: ["EXCEL"] },
  { id: "ambos", nombre: "PDF y Excel", formatos: ["PDF", "EXCEL"] },
  { id: "todo", nombre: "Pantalla y archivos", formatos: ["PANTALLA", "PDF", "EXCEL"] },
];
export const PROCEDENCIAS: Record<Procedencia, { texto: string; corto: string; tono: string }> = {
  MODELO: { texto: "Interpretado por el modelo de lenguaje del servidor", corto: "Modelo del servidor", tono: "ok" },
  REGLAS: { texto: "Interpretación limitada por reglas", corto: "Reglas (limitada)", tono: "alerta" },
  MANUAL: { texto: "Especificación editada manualmente", corto: "Edición manual", tono: "espera" },
};

export function esV2(especificacion: unknown): especificacion is EspecificacionV2 {
  return (especificacion as { version?: number } | null)?.version === 2;
}

/** Procedencia veraz; el historial anterior a la v2 no la guardó y se deduce de lo que sí guardó. */
export function procedenciaDe(reporte: { procedencia?: string | null; generativa: boolean; observacion: string | null }): Procedencia {
  if (reporte.procedencia === "MODELO" || reporte.procedencia === "REGLAS" || reporte.procedencia === "MANUAL") return reporte.procedencia;
  if (reporte.generativa) return "MODELO";
  return reporte.observacion?.startsWith("Especificación editada") ? "MANUAL" : "REGLAS";
}

/** Qué se muestra: pantalla solo si se pidió o no se dijo nada; archivos pedidos, o ambos a demanda si no se pidió ninguno. */
export function salidaDe(especificacion: EspecificacionV2): { pantalla: boolean; archivos: ("PDF" | "EXCEL")[]; pedidos: boolean } {
  const pedidos = especificacion.formatos.filter((f): f is "PDF" | "EXCEL" => f !== "PANTALLA");
  return {
    pantalla: !especificacion.formatos.length || especificacion.formatos.includes("PANTALLA"),
    archivos: pedidos.length ? pedidos : ["PDF", "EXCEL"],
    pedidos: pedidos.length > 0,
  };
}

/** Celda en formato boliviano: dinero desde centavos («Bs 1.234,50»), fechas dd/mm/aaaa, sí/no. */
export function formatoCelda(valor: Celda | undefined, tipo: TipoDato): string {
  if (valor === null || valor === undefined) return "—";
  if (tipo === "DINERO")
    return "Bs " + (Number(valor) / 100).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (tipo === "ENTERO") return Number(valor).toLocaleString("es-BO");
  if (tipo === "FECHA") {
    const [a, m, d] = String(valor).slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  }
  if (tipo === "BOOLEANO") return valor ? "Sí" : "No";
  return String(valor);
}

export function esNumerico(tipo: TipoDato): boolean {
  return tipo === "DINERO" || tipo === "ENTERO";
}
