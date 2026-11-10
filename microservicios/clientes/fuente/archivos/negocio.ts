import { randomBytes, createHash } from "node:crypto";
import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Titular } from "../comun/autenticacion.js";
import type { TipoArchivo, SolicitudSubida, Archivo, RegistroArchivos, AlmacenArchivos } from "./contratos-datos.js";
export type { TipoArchivo, SolicitudSubida, Archivo, RegistroArchivos, AlmacenArchivos } from "./contratos-datos.js";

export const destinos = {
  "producto": "PRODUCTOS/FOTOGRAFIAS", "original-prenda": "PRODUCTOS/ORIGINALES",
  "textura": "MODELOS-3D/TEXTURAS", "modelo3d": "MODELOS-3D/PRENDAS",
  "foto-probador": "PROBADOR-VIRTUAL/FOTOS-ORIGINALES", "resultado-probador": "PROBADOR-VIRTUAL/RESULTADOS-IA",
  "reporte-excel": "REPORTES/EXCEL", "reporte-pdf": "REPORTES/PDF", "comprobante": "COMPROBANTES/PDF", "comprobante-excel": "COMPROBANTES/EXCEL",
} as const satisfies Record<TipoArchivo, string>;

const fallo = (mensaje: string) => new UnprocessableEntityException({ mensaje, código: "ARCHIVO_INVALIDO" });
export function nombreLegible(descripcion: string, fecha: string, extension: string): string {
  if (/\b[a-f0-9]{16,}\b|\b\d{6,}\b|[a-f0-9]{8}-[a-f0-9]{4}-/i.test(descripcion))
    throw fallo("Describe el contenido sin identificadores, hashes ni códigos numéricos.");
  const nombre = descripcion.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
  if (!/[a-z]{3}/.test(nombre)) throw fallo("Escribe una descripción reconocible del archivo.");
  const sufijo = [...randomBytes(6)].map(n => String.fromCharCode(97 + n % 26)).join("");
  return `${nombre}_${fecha.replace("T", "_").replace(/:/g, "-").replace(".", "-").replace("Z", "_UTC")}_${sufijo}.${extension}`;
}

export class ServicioArchivos {
  constructor(private readonly registro: RegistroArchivos, private readonly almacen: AlmacenArchivos, private readonly bucket: string) {}

  private async propio(id: string, titular: Titular): Promise<Archivo> {
    const archivo = await this.registro.obtener(id);
    if (!archivo || (archivo.titular !== titular.sub && !titular.roles.includes("admin")))
      throw new NotFoundException({ mensaje: "Archivo inexistente.", código: "NO_ENCONTRADO" });
    return archivo;
  }

  async preparar(id: string, datos: SolicitudSubida, titular: Titular) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id ?? ""))
      throw fallo("Idempotency-Key debe ser UUID v4.");
    if (!titular.roles.some(r => r === "admin" || r === "servicio") && datos.tipo !== "foto-probador")
      throw new ForbiddenException({ mensaje: "No tienes permiso para subir este tipo de archivo.", código: "ACCESO_DENEGADO" });
    const imagen = ["producto", "original-prenda", "textura", "foto-probador", "resultado-probador"].includes(datos.tipo);
    const extensiones: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "model/gltf-binary": "glb" };
    const extension = extensiones[datos.mime];
    if (!extension || (imagen && !["png", "jpg"].includes(extension)) ||
      (["reporte-pdf", "comprobante"].includes(datos.tipo) && extension !== "pdf") ||
      (["reporte-excel", "comprobante-excel"].includes(datos.tipo) && extension !== "xlsx") || (datos.tipo === "modelo3d" && extension !== "glb"))
      throw fallo("El formato no corresponde a la funcionalidad indicada.");
    if (!Object.hasOwn(destinos, datos.tipo)) throw fallo("Funcionalidad desconocida.");
    if (Object.keys(datos.referencias ?? {}).length > 12 || Object.entries(datos.referencias ?? {}).some(([k, v]) =>
      !/^[a-z_]{1,40}$/.test(k) || typeof v !== "string" || v.length > 200)) throw fallo("Metadatos de referencia inválidos.");
    // Canonizar referencias evita conflictos por el orden de las claves JSON. La clave es estable ante respuesta incierta.
    const canonico = { tipo: datos.tipo, descripcion: datos.descripcion, mime: datos.mime, bytes: datos.bytes,
      sha256: datos.sha256, origen: datos.origen,
      referencias: Object.fromEntries(Object.entries(datos.referencias ?? {}).sort(([a], [b]) => a.localeCompare(b))) };
    const huella = createHash("sha256").update(JSON.stringify(canonico)).digest("hex");
    let archivo = await this.registro.obtener(id);
    if (!archivo) {
      const fecha = new Date().toISOString();
      const objeto = `${destinos[datos.tipo]}/${nombreLegible(datos.descripcion, fecha, extension)}`;
      await this.registro.crear({ ...canonico, identificador: id, titular: titular.sub, fecha, objeto,
        ruta_s3: `s3://${this.bucket}/${objeto}`, huella, estado: "PENDIENTE" });
      archivo = await this.registro.obtener(id);
    }
    if (!archivo || archivo.titular !== titular.sub || archivo.huella !== huella || archivo.estado === "BORRADO")
      throw new ConflictException({ mensaje: "La clave corresponde a otra subida o a un archivo borrado.", código: "CONFLICTO_IDEMPOTENCIA" });
    return { archivo, ...(archivo.estado === "PENDIENTE" ? { subida: await this.almacen.subida(archivo), vence_en_segundos: 300 } : {}) };
  }

  async confirmar(id: string, titular: Titular) {
    const archivo = await this.propio(id, titular);
    if (archivo.estado === "BORRADO") throw new ConflictException({ mensaje: "El archivo fue borrado." });
    if (archivo.estado !== "DISPONIBLE") {
      await this.almacen.comprobar(archivo);
      await this.registro.estado(id, "DISPONIBLE");
      console.info(JSON.stringify({ evento: "clb_archivo_confirmado", ruta_s3: archivo.ruta_s3, origen: archivo.origen }));
    }
    return { archivo: { ...archivo, estado: "DISPONIBLE" } };
  }

  async consultar(id: string, titular: Titular) { return { archivo: await this.propio(id, titular) }; }
  async descargar(id: string, titular: Titular) {
    const archivo = await this.propio(id, titular);
    if (archivo.estado !== "DISPONIBLE") throw new ConflictException({ mensaje: "El archivo aún no está disponible." });
    return { ruta_s3: archivo.ruta_s3, url: await this.almacen.descarga(archivo), vence_en_segundos: 300 };
  }
  async borrar(id: string, titular: Titular) {
    const archivo = await this.propio(id, titular);
    // Primero cerrar el acceso lógico. La marca durable permite repetir una eliminación incierta sin perder la ruta.
    await this.registro.estado(id, "BORRADO");
    await this.almacen.borrar(archivo);
    return { ruta_s3: archivo.ruta_s3, estado: "BORRADO" };
  }
  listar(titular: Titular, cursor?: string) { return this.registro.listar(titular.sub, cursor); }
}
