import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validarCantidad, type Variante, type ConfirmacionExistencias, type LineaCarrito, type Movimiento } from "../../existencias/dominio/modelos";
import type {
  Favorito,
  Metadato,
  Operacion,
  Producto,
} from "../dominio/modelos";

interface EsquemaClb extends DBSchema {
  productos: { key: string; value: Producto };
  favoritos: { key: string; value: Favorito };
  operaciones: { key: string; value: Operacion };
  metadatos: { key: string; value: Metadato };
  productosAdministracion: { key: string; value: Producto };
  variantes: { key: string; value: Variante };
  variantesAdministracion: { key: string; value: Variante };
  carrito: { key: string; value: LineaCarrito };
  movimientos: { key: string; value: { identificador: string; movimientos: Movimiento[] } };
}

export class RepositorioLocal {
  private base?: Promise<IDBPDatabase<EsquemaClb>>;

  constructor(private readonly nombre = "clb_catalogo") {}

  private abrir(): Promise<IDBPDatabase<EsquemaClb>> {
    return (this.base ??= openDB<EsquemaClb>(this.nombre, 3, {
      upgrade(base, anterior) {
        if (anterior < 3) {
          for (const nombre of ["variantes", "variantesAdministracion", "carrito", "movimientos"] as const)
            base.createObjectStore(nombre, { keyPath: "identificador" });
        }
        if (anterior < 1) {
          base.createObjectStore("productos", { keyPath: "identificador" });
          base.createObjectStore("favoritos", { keyPath: "identificador" });
          base.createObjectStore("operaciones", { keyPath: "identificador" });
          base.createObjectStore("metadatos", { keyPath: "clave" });
        }
        if (anterior < 2)
          base.createObjectStore("productosAdministracion", {
            keyPath: "identificador",
          });
      },
      blocking: () => {
        void this.cerrar();
      },
    }));
  }

  async cerrar(): Promise<void> {
    if (this.base) (await this.base).close();
    this.base = undefined;
  }

  async productos(): Promise<Producto[]> {
    return (await this.abrir()).getAll("productos");
  }
  async producto(identificador: string): Promise<Producto | undefined> {
    return (await this.abrir()).get("productos", identificador);
  }
  async favoritos(): Promise<Favorito[]> {
    return (await this.abrir()).getAll("favoritos");
  }
  async operaciones(): Promise<Operacion[]> {
    return (await this.abrir()).getAll("operaciones");
  }
  async metadato(clave: string): Promise<unknown> {
    return (await this.abrir())
      .get("metadatos", clave)
      .then((dato) => dato?.valor);
  }

  async guardarCatalogo(productos: Producto[]): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      ["productos", "metadatos"],
      "readwrite",
    );
    await transacción.objectStore("productos").clear();
    for (const producto of productos)
      await transacción.objectStore("productos").put(producto);
    await transacción
      .objectStore("metadatos")
      .put({ clave: "última_sincronización", valor: new Date().toISOString() });
    await transacción.done;
  }

  async guardarProducto(producto: Producto): Promise<void> {
    await (await this.abrir()).put("productos", producto);
  }

  // Favorito y operación se guardan atómicamente: no puede existir uno sin la otra.
  async alternarFavorito(identificador: string): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      ["favoritos", "operaciones"],
      "readwrite",
    );
    const favoritos = transacción.objectStore("favoritos");
    const existente = await favoritos.get(identificador);
    const fechaCreación = new Date().toISOString();
    if (existente) await favoritos.delete(identificador);
    else
      await favoritos.put({ identificador, fechaActualización: fechaCreación });
    const uuid = crypto.randomUUID();
    await transacción.objectStore("operaciones").put({
      identificador: uuid,
      claveIdempotencia: uuid,
      tipo: "CAMBIAR_FAVORITO",
      fechaCreación,
      estado: "PENDIENTE",
      intentos: 0,
      próximoIntento: Date.now(),
      datos: { identificadorProducto: identificador, favorito: !existente },
    });
    await transacción.done;
  }

  async guardarOperacion(operación: Operacion): Promise<void> {
    await (await this.abrir()).put("operaciones", operación);
  }

  async productosAdministracion(): Promise<Producto[]> {
    return (await this.abrir()).getAll("productosAdministracion");
  }

  async marcarAdministracionVisitada(): Promise<void> {
    await (
      await this.abrir()
    ).put("metadatos", { clave: "administracion_visitada", valor: true });
  }

  async guardarAdministracion(productos: Producto[]): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      "productosAdministracion",
      "readwrite",
    );
    await transacción.store.clear();
    for (const producto of productos) await transacción.store.put(producto);
    await transacción.done;
  }

  async encolarAdministrativa(
    operación: Operacion,
    reemplaza?: string,
  ): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      "operaciones",
      "readwrite",
    );
    const existentes = await transacción.store.getAll();
    const colisión = existentes.some(
      (anterior) =>
        (["PENDIENTE", "ENVIANDO", "ERROR_REINTENTABLE"].includes(
          anterior.estado,
        ) ||
          (anterior.estado === "REQUIERE_REVISION" &&
            anterior.motivoRevision === "REINTENTOS_AGOTADOS")) &&
        (operación.tipo === "MODIFICAR_PRODUCTO"
          ? anterior.tipo === operación.tipo &&
            anterior.datos["identificadorProducto"] ===
              operación.datos["identificadorProducto"]
          : anterior.tipo === operación.tipo &&
            anterior.datos["sku"] === operación.datos["sku"]),
    );
    if (colisión) {
      await transacción.done;
      throw new Error(
        "Ya existe una propuesta pendiente para este producto o SKU. Espera su resultado antes de preparar otra.",
      );
    }
    if (reemplaza) {
      const anterior = await transacción.store.get(reemplaza);
      if (
        !anterior ||
        anterior.estado !== "REQUIERE_REVISION" ||
        anterior.motivoRevision === "REINTENTOS_AGOTADOS" ||
        anterior.reemplazadaPor
      ) {
        await transacción.done;
        throw new Error(
          "La operación ya fue revisada o todavía no requiere revisión.",
        );
      }
      await transacción.store.put({
        ...anterior,
        reemplazadaPor: operación.identificador,
      });
    }
    await transacción.store.add(operación);
    await transacción.done;
  }

  async reintentarIncierta(identificador: string): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      "operaciones",
      "readwrite",
    );
    const operación = await transacción.store.get(identificador);
    if (
      !operación ||
      operación.estado !== "REQUIERE_REVISION" ||
      operación.motivoRevision !== "REINTENTOS_AGOTADOS"
    ) {
      await transacción.done;
      throw new Error(
        "Esta operación requiere corregir el conflicto antes de enviarla.",
      );
    }
    await transacción.store.put({
      ...operación,
      estado: "ERROR_REINTENTABLE",
      próximoIntento: Date.now(),
      motivoRevision: undefined,
    });
    await transacción.done;
  }

  async reclamar(
    identificador: string,
    propietario: string,
    ahora: number,
  ): Promise<Operacion | undefined> {
    const transacción = (await this.abrir()).transaction(
      "operaciones",
      "readwrite",
    );
    const operación = await transacción.store.get(identificador);
    if (operación?.dependencias?.length) {
      const dependencias = await Promise.all(operación.dependencias.map(id => transacción.store.get(id)));
      if (dependencias.some(dependencia => dependencia?.estado !== "CONFIRMADA")) {
        await transacción.done;
        return undefined;
      }
      if (operación.versiónDesde && operación.intentos === 0) {
        const base = dependencias.find(dependencia => dependencia?.identificador === operación.versiónDesde)?.resultadoExistencias;
        if (!base) { await transacción.done; return undefined; }
        operación.versiónEsperada = base.versión_sincronización;
      }
    }
    if (
      !operación ||
      operación.estado === "CONFIRMADA" ||
      operación.estado === "REQUIERE_REVISION" ||
      operación.próximoIntento > ahora ||
      (operación.estado === "ENVIANDO" && (operación.vencimiento ?? 0) > ahora)
    ) {
      await transacción.done;
      return undefined;
    }
    const reclamada: Operacion = {
      ...operación,
      estado: "ENVIANDO",
      propietario,
      vencimiento: ahora + 30_000,
      intentos: operación.intentos + 1,
    };
    await transacción.store.put(reclamada);
    await transacción.done;
    return reclamada;
  }

  async finalizar(
    operación: Operacion,
    propietario: string,
    respuesta?: Producto | ConfirmacionExistencias,
  ): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      ["operaciones", "productos", "productosAdministracion", "variantesAdministracion"],
      "readwrite",
    );
    const operaciones = transacción.objectStore("operaciones");
    const actual = await operaciones.get(operación.identificador);
    const producto = respuesta && !("variante" in respuesta) ? respuesta : undefined;
    const variante = respuesta && "variante" in respuesta ? respuesta.variante : undefined;
    if (actual?.estado === "ENVIANDO" && actual.propietario === propietario) {
      const {
        propietario: descartado,
        vencimiento: vencido,
        ...resultado
      } = operación;
      await operaciones.put({
        ...resultado,
        ...(producto ? { resultado: producto } : {}),
        ...(variante ? { resultadoExistencias: variante } : {}),
      });
      if (variante) {
        const almacén = transacción.objectStore("variantesAdministracion");
        const anterior = await almacén.get(variante.identificador);
        if (!anterior || anterior.versión_sincronización <= variante.versión_sincronización) await almacén.put(variante);
      }
      if (producto) {
        const administración = transacción.objectStore(
          "productosAdministracion",
        );
        const públicos = transacción.objectStore("productos");
        const anteriorAdministrativo = await administración.get(
          producto.identificador,
        );
        const anteriorPúblico = await públicos.get(producto.identificador);
        const versiónConocida = Math.max(
          anteriorAdministrativo?.versión_sincronización ?? 0,
          anteriorPúblico?.versión_sincronización ?? 0,
        );
        if (producto.versión_sincronización >= versiónConocida) {
          await administración.put(producto);
          // Una respuesta idempotente puede ser histórica. Las altas/activaciones
          // se publican únicamente después de releer el catálogo actual por REST.
          if (!producto.activo) await públicos.delete(producto.identificador);
        }
      }
    }
    await transacción.done;
  }

  async variantes(producto: string, administración = false): Promise<Variante[]> {
    return (await (await this.abrir()).getAll(administración ? "variantesAdministracion" : "variantes"))
      .filter(variante => variante.identificador_producto === producto);
  }

  async guardarVariantes(producto: string, variantes: Variante[], administración = false): Promise<void> {
    const almacén = administración ? "variantesAdministracion" : "variantes";
    const transacción = (await this.abrir()).transaction([almacén, "metadatos"], "readwrite");
    const objetos = transacción.objectStore(almacén);
    for (const anterior of await objetos.getAll())
      if (anterior.identificador_producto === producto) await objetos.delete(anterior.identificador);
    for (const variante of variantes) await objetos.put(variante);
    await transacción.objectStore("metadatos").put({ clave: (administración ? "variantes_admin_" : "variantes_") + producto, valor: new Date().toISOString() });
    await transacción.done;
  }

  async movimientos(variante: string): Promise<Movimiento[]> {
    return (await (await this.abrir()).get("movimientos", variante))?.movimientos ?? [];
  }
  async guardarMovimientos(variante: string, movimientos: Movimiento[]): Promise<void> {
    await (await this.abrir()).put("movimientos", { identificador: variante, movimientos });
  }
  async carrito(): Promise<LineaCarrito[]> { return (await this.abrir()).getAll("carrito"); }
  async agregarCarrito(línea: LineaCarrito): Promise<void> {
    validarCantidad(línea.cantidad);
    const transacción = (await this.abrir()).transaction("carrito", "readwrite");
    const anterior = await transacción.store.get(línea.identificador);
    const cantidad = (anterior?.cantidad ?? 0) + línea.cantidad;
    validarCantidad(cantidad);
    await transacción.store.put({ ...línea, cantidad });
    await transacción.done;
  }
  async cantidadCarrito(id: string, cantidad: number): Promise<void> {
    validarCantidad(cantidad);
    const transacción = (await this.abrir()).transaction("carrito", "readwrite");
    const línea = await transacción.store.get(id);
    if (línea) await transacción.store.put({ ...línea, cantidad });
    await transacción.done;
  }
  async quitarCarrito(id: string): Promise<void> { await (await this.abrir()).delete("carrito", id); }
  async vaciarCarrito(): Promise<void> { await (await this.abrir()).clear("carrito"); }

  async encolarExistencias(operación: Operacion, reemplaza?: string): Promise<void> {
    const transacción = (await this.abrir()).transaction("operaciones", "readwrite");
    const anteriores = await transacción.store.getAll();
    const variante = operación.datos["identificador_variante"] ?? operación.datos["identificador"];
    const relacionadas = anteriores.filter(anterior => (anterior.datos["identificador_variante"] ?? anterior.datos["identificador"]) === variante);
    if (relacionadas.some(anterior => anterior.motivoRevision === "REINTENTOS_AGOTADOS" && anterior.estado === "REQUIERE_REVISION"))
      throw new Error("Hay una confirmación incierta. Reintenta la misma operación antes de preparar otra.");
    const activas = relacionadas.filter(anterior => ["PENDIENTE", "ENVIANDO", "ERROR_REINTENTABLE"].includes(anterior.estado));
    const pendiente = activas.find(anterior => !activas.some(otra => otra.dependencias?.includes(anterior.identificador)));
    if (pendiente && !reemplaza) {
      operación.dependencias = [...new Set([...(operación.dependencias ?? []), pendiente.identificador])];
      operación.versiónDesde = pendiente.identificador;
    }
    if (operación.dependencias?.some(id => !anteriores.some(anterior => anterior.identificador === id)))
      throw new Error("No existe la operación de la que depende esta propuesta.");
    if (reemplaza) {
      const anterior = await transacción.store.get(reemplaza);
      if (!anterior || anterior.estado !== "REQUIERE_REVISION" || anterior.motivoRevision === "REINTENTOS_AGOTADOS" || anterior.reemplazadaPor)
        throw new Error("La propuesta no está disponible para corrección.");
      for (const hija of anteriores) {
        if (hija.intentos === 0 && hija.dependencias?.includes(reemplaza)) {
          await transacción.store.put({ ...hija,
            dependencias: hija.dependencias.map(id => id === reemplaza ? operación.identificador : id),
            versiónDesde: hija.versiónDesde === reemplaza ? operación.identificador : hija.versiónDesde });
        }
      }
      await transacción.store.put({ ...anterior, reemplazadaPor: operación.identificador });
    }
    await transacción.store.add(operación);
    await transacción.done;
  }

  // Arrendamiento transaccional compartido entre pestañas, también sin Web Locks.
  async tomarTurno(propietario: string, ahora: number): Promise<boolean> {
    const transacción = (await this.abrir()).transaction(
      "metadatos",
      "readwrite",
    );
    const actual = (await transacción.store.get("turno_sincronización"))
      ?.valor as { propietario: string; vencimiento: number } | undefined;
    const permitido =
      !actual ||
      actual.vencimiento <= ahora ||
      actual.propietario === propietario;
    if (permitido)
      await transacción.store.put({
        clave: "turno_sincronización",
        valor: { propietario, vencimiento: ahora + 30_000 },
      });
    await transacción.done;
    return permitido;
  }

  async liberarTurno(propietario: string): Promise<void> {
    const transacción = (await this.abrir()).transaction(
      "metadatos",
      "readwrite",
    );
    const actual = (await transacción.store.get("turno_sincronización"))
      ?.valor as { propietario: string } | undefined;
    if (actual?.propietario === propietario)
      await transacción.store.delete("turno_sincronización");
    await transacción.done;
  }
}
