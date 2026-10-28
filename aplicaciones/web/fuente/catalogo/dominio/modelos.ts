import type { RecursoProbador, TexturaGuardada } from "./recurso-probador";
import type { ConfirmacionExistencias, Variante } from "../../existencias/dominio/modelos";
import type { ConfirmacionPedido, PedidoVenta } from "../../pedidos/dominio/modelos";
export interface Producto {
  recurso_probador?: RecursoProbador;
  identificador: string;
  sku: string;
  nombre: string;
  descripción: string;
  categoría: string;
  precio: string;
  moneda: "BOB";
  activo: boolean;
  fecha_creación: string;
  fecha_actualización: string;
  versión_sincronización: number;
}

export interface PaginaProductos {
  productos: Producto[];
  paginación: {
    página: number;
    límite: number;
    total: number;
    páginas: number;
  };
}

export type EstadoOperacion =
  | "PENDIENTE"
  | "ENVIANDO"
  | "CONFIRMADA"
  | "ERROR_REINTENTABLE"
  | "REQUIERE_REVISION";

export interface Operacion {
  identificador: string;
  tipo: string;
  fechaCreación: string;
  estado: EstadoOperacion;
  intentos: number;
  próximoIntento: number;
  datos: Record<string, unknown>;
  claveIdempotencia: string;
  error?: string;
  propietario?: string;
  vencimiento?: number;
  versiónEsperada?: number | null;
  resultado?: Producto;
  resultadoExistencias?: Variante;
  /** Titular (sub de Keycloak) que creó la operación: solo esa sesión la ve y la envía en un navegador compartido. */
  titular?: string;
  /** Último estado conocido del pedido en Ventas; se muestra sin conexión y se refresca al consultar. */
  resultadoPedido?: PedidoVenta;
  dependencias?: string[];
  versiónDesde?: string;
  detalleError?: Record<string, unknown>;
  reemplazadaPor?: string;
  motivoRevision?: "CONFLICTO_PERMANENTE" | "REINTENTOS_AGOTADOS";
}

export interface Favorito {
  identificador: string;
  fechaActualización: string;
}
export interface Metadato {
  clave: string;
  valor: unknown;
}

export interface FuenteCatalogo {
  descargarRecursos?(productos: Producto[], guardadas?: TexturaGuardada[]): Promise<TexturaGuardada[]>;
  descargar(): Promise<Producto[]>;
  consultar(identificador: string): Promise<Producto>;
  disponible(): Promise<boolean>;
}

// Un procesador se registra únicamente cuando existe su endpoint real.
export interface ProcesadorOperacion {
  tipo: string;
  endpoint: string;
  /** Milisegundos antes de abortar el envío (predeterminado 10 s); la SAGA de Ventas necesita más. */
  tiempoMáximo?: number;
  procesar(
    operación: Readonly<Operacion>,
    señal: AbortSignal,
  ): Promise<void | Producto | ConfirmacionExistencias | ConfirmacionPedido>;
}

export class ErrorRemoto extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly detalles?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}
