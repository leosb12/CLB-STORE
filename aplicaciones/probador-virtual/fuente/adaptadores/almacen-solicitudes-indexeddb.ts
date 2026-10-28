import type { AlmacenSolicitudes } from "../aplicacion/probador-fotografico";
import type { SolicitudFotografica } from "../dominio/solicitud-fotografica";

const BASE = "clb_probador_vton";
const SOLICITUDES = "solicitudes";
const BORRADOS = "borrados";
/** Copias de la versión anterior (Cache Storage, sin cola): se retiran al abrir la nueva. */
const CACHE_ANTERIOR = "clb_vton_fotos_v1";

const promesa = <T>(r: IDBRequest<T>) => new Promise<T>((resolver, rechazar) => { r.onsuccess = () => resolver(r.result); r.onerror = () => rechazar(r.error); });

/**
 * Base propia del microfrontend, separada de `clb_catalogo` del shell. Fotos y resultado viven en la misma fila que su
 * estado: cada cambio es una sola transacción, sin archivos huérfanos.
 */
export class AlmacenSolicitudesIndexedDb implements AlmacenSolicitudes {
  private base: Promise<IDBDatabase> | null = null;

  private abrir(): Promise<IDBDatabase> {
    this.base ??= new Promise<IDBDatabase>((resolver, rechazar) => {
      const pedido = indexedDB.open(BASE, 1);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        db.createObjectStore(SOLICITUDES, { keyPath: ["titular", "clave"] }).createIndex("titular", "titular");
        db.createObjectStore(BORRADOS, { keyPath: ["titular", "clave"] }).createIndex("titular", "titular");
      };
      pedido.onsuccess = () => {
        const db = pedido.result;
        db.onversionchange = () => { db.close(); this.base = null; };
        resolver(db);
      };
      pedido.onerror = () => { this.base = null; rechazar(pedido.error); };
      if (typeof caches !== "undefined") void caches.delete(CACHE_ANTERIOR).catch(() => undefined);
    });
    return this.base;
  }

  private async transaccion<T>(almacenes: string[], modo: IDBTransactionMode, tarea: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
    const t = (await this.abrir()).transaction(almacenes, modo, { durability: "strict" });
    const fin = new Promise<void>((resolver, rechazar) => { t.oncomplete = () => resolver(); t.onerror = () => rechazar(t.error); t.onabort = () => rechazar(t.error); });
    const resultado = await tarea(t);
    await fin;
    return resultado;
  }

  guardar(s: SolicitudFotografica): Promise<void> {
    return this.transaccion([SOLICITUDES], "readwrite", (t) => { t.objectStore(SOLICITUDES).put(s); });
  }
  obtener(titular: string, clave: string): Promise<SolicitudFotografica | undefined> {
    return this.transaccion([SOLICITUDES], "readonly", (t) => promesa(t.objectStore(SOLICITUDES).get([titular, clave])));
  }
  listar(titular: string): Promise<SolicitudFotografica[]> {
    return this.transaccion([SOLICITUDES], "readonly", (t) => promesa(t.objectStore(SOLICITUDES).index("titular").getAll(titular)));
  }
  eliminar(titular: string, clave: string): Promise<void> {
    return this.transaccion([SOLICITUDES], "readwrite", (t) => { t.objectStore(SOLICITUDES).delete([titular, clave]); });
  }
  eliminarConBorrado(titular: string, clave: string): Promise<void> {
    return this.transaccion([SOLICITUDES, BORRADOS], "readwrite", (t) => {
      if (clave !== "*") t.objectStore(SOLICITUDES).delete([titular, clave]);
      t.objectStore(BORRADOS).put({ titular, clave });
    });
  }
  async borrados(titular: string): Promise<string[]> {
    const filas = await this.transaccion([BORRADOS], "readonly", (t) => promesa(t.objectStore(BORRADOS).index("titular").getAll(titular)));
    return filas.map((f: { clave: string }) => f.clave);
  }
  confirmarBorrado(titular: string, clave: string): Promise<void> {
    return this.transaccion([BORRADOS], "readwrite", (t) => { t.objectStore(BORRADOS).delete([titular, clave]); });
  }
  /** Fotos y resultados de todas las cuentas. Los borrados pendientes (solo claves) se conservan para enviarse al volver esa cuenta. */
  async borrarTodo(): Promise<void> {
    await this.transaccion([SOLICITUDES], "readwrite", (t) => { t.objectStore(SOLICITUDES).clear(); });
  }
}
