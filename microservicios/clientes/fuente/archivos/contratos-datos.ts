// Contratos de la capa de datos. Negocio depende de estos contratos; AWS no depende de negocio.
export type TipoArchivo = "producto" | "original-prenda" | "textura" | "modelo3d" | "foto-probador" |
  "resultado-probador" | "reporte-excel" | "reporte-pdf" | "comprobante" | "comprobante-excel";
export interface SolicitudSubida {
  tipo: TipoArchivo; descripcion: string; mime: string; bytes: number; sha256: string;
  origen: "web" | "android" | "microservicio"; referencias?: Record<string, string>;
}
export interface Archivo extends SolicitudSubida {
  identificador: string; titular: string; fecha: string; ruta_s3: string; objeto: string;
  huella: string; estado: "PENDIENTE" | "DISPONIBLE" | "BORRADO";
}
export interface RegistroArchivos {
  obtener(id: string): Promise<Archivo | null>;
  crear(archivo: Archivo): Promise<void>;
  estado(id: string, estado: Archivo["estado"]): Promise<void>;
  listar(titular: string, cursor?: string): Promise<{ archivos: Archivo[]; cursor?: string }>;
}
export interface AlmacenArchivos {
  subida(archivo: Archivo): Promise<{ url: string; cabeceras: Record<string, string> }>;
  comprobar(archivo: Archivo): Promise<void>;
  descarga(archivo: Archivo): Promise<string>;
  borrar(archivo: Archivo): Promise<void>;
}
