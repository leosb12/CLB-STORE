import { effect, inject, Injectable, signal } from "@angular/core";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import type { Operacion, Producto } from "../../catalogo/dominio/modelos";
import { ADMINISTRACION_REST } from "../adaptadores/administracion-rest";
import {
  datosDeProducto,
  validarProducto,
  type DatosProducto,
} from "../dominio/productos-administrativos";

@Injectable({ providedIn: "root" })
export class EstadoAdministracion {
  readonly catálogo = inject(EstadoCatalogo);
  private readonly remoto = inject(ADMINISTRACION_REST);
  readonly productos = signal<Producto[]>([]);
  readonly operaciones = signal<Operacion[]>([]);
  readonly errores = signal<Record<string, string>>({});
  readonly mensaje = signal("");
  readonly error = signal("");
  readonly guardando = signal(false);
  private iniciada = false;

  constructor() {
    effect(() => {
      this.catálogo.revisiónLocal();
      if (this.iniciada)
        void this.leerLocal().catch(() =>
          this.error.set("No se pudo leer la administración local."),
        );
    });
  }

  async catalogoFotograficoPublicado(): Promise<void> {
    await this.catálogo.sincronizar(true);
    await this.leerLocal();
  }

  async iniciar(): Promise<void> {
    this.iniciada = true;
    try {
      await this.catálogo.local.marcarAdministracionVisitada();
      await this.leerLocal();
      await this.catálogo.iniciar();
      await this.catálogo.sincronizar(true);
      await this.leerLocal();
    } catch {
      this.error.set(
        "No se pudo abrir la administración local. Revisa el almacenamiento del navegador.",
      );
    }
  }

  private async leerLocal(): Promise<void> {
    const [productos, públicos, operaciones] = await Promise.all([
      this.catálogo.local.productosAdministracion(),
      this.catálogo.local.productos(),
      this.catálogo.local.operaciones(),
    ]);
    // Un producto público descargado también es una base confirmada para editar offline.
    // Se conserva la versión más reciente conocida, incluyendo inactivos administrativos.
    const confirmados = new Map(
      productos.map((producto) => [producto.identificador, producto]),
    );
    for (const producto of públicos) {
      const anterior = confirmados.get(producto.identificador);
      if (
        !anterior ||
        anterior.versión_sincronización < producto.versión_sincronización
      )
        confirmados.set(producto.identificador, producto);
    }
    this.productos.set(
      [...confirmados.values()].sort((uno, otro) =>
        uno.nombre.localeCompare(otro.nombre, "es"),
      ),
    );
    this.operaciones.set(
      operaciones
        .filter((operación) =>
          ["REGISTRAR_PRODUCTO", "MODIFICAR_PRODUCTO"].includes(operación.tipo),
        )
        .sort(
          (uno, otro) =>
            otro.fechaCreación.localeCompare(uno.fechaCreación) ||
            otro.identificador.localeCompare(uno.identificador),
        ),
    );
  }

  async guardar(
    datos: DatosProducto,
    base?: Producto,
    reemplaza?: string,
  ): Promise<boolean> {
    this.mensaje.set("");
    this.error.set("");
    const errores = validarProducto(datos);
    this.errores.set(errores);
    if (Object.keys(errores).length) return false;
    this.guardando.set(true);
    try {
      const identificador = crypto.randomUUID();
      const operación: Operacion = {
        identificador,
        claveIdempotencia: identificador,
        tipo: base ? "MODIFICAR_PRODUCTO" : "REGISTRAR_PRODUCTO",
        versiónEsperada: base?.versión_sincronización ?? null,
        fechaCreación: new Date().toISOString(),
        estado: "PENDIENTE",
        intentos: 0,
        próximoIntento: Date.now(),
        datos: {
          ...datos,
          sku: datos.sku.trim().toUpperCase(),
          nombre: datos.nombre.trim(),
          categoría: datos.categoría.trim(),
          ...(base ? { identificadorProducto: base.identificador } : {}),
        },
      };
      await this.catálogo.local.encolarAdministrativa(operación, reemplaza);
      this.mensaje.set(
        "Propuesta guardada en este dispositivo. Permanece pendiente hasta recibir confirmación del servidor.",
      );
      await this.leerLocal();
      await this.catálogo.sincronizar(true);
      await this.leerLocal();
      const actual = this.operaciones().find(
        (candidata) => candidata.identificador === identificador,
      );
      if (actual?.estado === "CONFIRMADA")
        this.mensaje.set(
          "El servidor confirmó la operación. El producto ya está actualizado.",
        );
      if (actual?.estado === "REQUIERE_REVISION")
        this.error.set(actual.error ?? "La propuesta requiere revisión.");
      return true;
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la propuesta.",
      );
      return false;
    } finally {
      this.guardando.set(false);
    }
  }

  async revisar(
    operación: Operacion,
  ): Promise<{ datos: DatosProducto; base?: Producto }> {
    if (operación.motivoRevision === "REINTENTOS_AGOTADOS")
      throw new Error(
        "La confirmación es incierta. Reintenta la misma operación para consultar su resultado sin cambiar UUID ni datos.",
      );
    if (operación.estado !== "REQUIERE_REVISION" || operación.reemplazadaPor)
      throw new Error("Esta operación no está disponible para revisión.");
    let base: Producto | undefined;
    if (operación.tipo === "MODIFICAR_PRODUCTO") {
      if (!this.catálogo.disponible() || !navigator.onLine)
        throw new Error(
          "Conecta con Inventario para cargar la versión actual antes de resolver el conflicto.",
        );
      base = await this.remoto.consultar(
        String(operación.datos["identificadorProducto"]),
      );
    }
    const datos = datosDeProducto(base);
    // Conserva la propuesta para compararla; nunca la aplica sobre el catálogo confirmado.
    for (const campo of [
      "sku",
      "nombre",
      "descripción",
      "categoría",
      "precio",
    ] as const) {
      const valor = operación.datos[campo];
      if (typeof valor === "string") datos[campo] = valor;
    }
    if (typeof operación.datos["activo"] === "boolean")
      datos.activo = operación.datos["activo"];
    this.mensaje.set(
      base
        ? `Versión actual ${base.versión_sincronización} cargada. Compara la propuesta y confirma con Guardar; se creará otra operación.`
        : "Corrige la propuesta. Guardar creará una nueva operación, conservando la anterior para revisión.",
    );
    return { datos, base };
  }

  async alternarEstado(producto: Producto): Promise<void> {
    await this.guardar(
      { ...datosDeProducto(producto), activo: !producto.activo },
      producto,
    );
  }

  async reintentar(identificador: string): Promise<void> {
    try {
      await this.catálogo.local.reintentarIncierta(identificador);
      this.mensaje.set(
        "Se reintentará la misma solicitud, con el mismo UUID, clave y datos.",
      );
      await this.leerLocal();
      await this.catálogo.sincronizar(true);
      await this.leerLocal();
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : "No se pudo reintentar.",
      );
    }
  }
}
