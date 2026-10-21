import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB, deleteDB } from "idb";
import { RepositorioLocal } from "../fuente/catalogo/adaptadores/repositorio-local";
import { AdministracionRest } from "../fuente/administracion/adaptadores/administracion-rest";
import { validarProducto } from "../fuente/administracion/dominio/productos-administrativos";
import { Sincronizador } from "../fuente/catalogo/aplicacion/sincronizador";
import {
  ErrorRemoto,
  type Producto,
  type Operacion,
  type FuenteCatalogo,
} from "../fuente/catalogo/dominio/modelos";

const producto: Producto = {
  identificador: "b".repeat(32),
  sku: "CLB-ADMIN",
  nombre: "Camisa de diseño",
  descripción: "",
  categoría: "Camisas",
  precio: "0.29",
  moneda: "BOB",
  activo: true,
  versión_sincronización: 1,
  fecha_creación: "2026-10-19T12:00:00Z",
  fecha_actualización: "2026-10-19T12:00:00Z",
};
const fuente: FuenteCatalogo = {
  disponible: async () => true,
  descargar: async () => [producto],
  consultar: async () => producto,
};

function propuesta(): Operacion {
  const identificador = crypto.randomUUID();
  return {
    identificador,
    claveIdempotencia: identificador,
    tipo: "MODIFICAR_PRODUCTO",
    versiónEsperada: 1,
    fechaCreación: new Date().toISOString(),
    estado: "PENDIENTE",
    intentos: 0,
    próximoIntento: 0,
    datos: {
      identificadorProducto: producto.identificador,
      sku: producto.sku,
      nombre: "Propuesta aún no confirmada",
      descripción: "",
      categoría: "Camisas",
      precio: "1.01",
      activo: true,
    },
  };
}

async function conBase(
  acción: (local: RepositorioLocal, nombre: string) => Promise<void>,
): Promise<void> {
  const nombre = "clb_prueba_" + crypto.randomUUID();
  const local = new RepositorioLocal(nombre);
  try {
    await acción(local, nombre);
  } finally {
    await local.cerrar();
    await deleteDB(nombre);
  }
}

test("migración IndexedDB v1→v2 conserva productos, favoritos y la única cola", async () =>
  conBase(async (local, nombre) => {
    const antigua = await openDB(nombre, 1, {
      upgrade(base) {
        for (const almacén of ["productos", "favoritos", "operaciones"])
          base.createObjectStore(almacén, { keyPath: "identificador" });
        base.createObjectStore("metadatos", { keyPath: "clave" });
      },
    });
    const operación = propuesta();
    await antigua.put("productos", producto);
    await antigua.put("operaciones", operación);
    await antigua.put("favoritos", { identificador: producto.identificador });
    antigua.close();
    assert.deepEqual(await local.productos(), [producto]);
    assert.equal(
      (await local.operaciones())[0].identificador,
      operación.identificador,
    );
    assert.equal((await local.favoritos()).length, 1);
    assert.deepEqual(await local.productosAdministracion(), []);
  }));

test("preparar una modificación offline no cambia el producto confirmado y persiste entre sesiones", async () =>
  conBase(async (local, nombre) => {
    await local.guardarCatalogo([producto]);
    await local.guardarAdministracion([producto]);
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    await local.cerrar();
    const reabierta = new RepositorioLocal(nombre);
    try {
      assert.deepEqual(await reabierta.productos(), [producto]);
      assert.deepEqual(await reabierta.productosAdministracion(), [producto]);
      assert.deepEqual((await reabierta.operaciones())[0], operación);
    } finally {
      await reabierta.cerrar();
    }
  }));

test("dos pestañas no preparan duplicaciones locales del mismo producto pendiente", async () =>
  conBase(async (local, nombre) => {
    const otra = new RepositorioLocal(nombre);
    try {
      const resultados = await Promise.allSettled([
        local.encolarAdministrativa(propuesta()),
        otra.encolarAdministrativa(propuesta()),
      ]);
      assert.equal(
        resultados.filter((resultado) => resultado.status === "fulfilled")
          .length,
        1,
      );
      assert.equal((await local.operaciones()).length, 1);
    } finally {
      await otra.cerrar();
    }
  }));

test("REST conserva Idempotency-Key y versión esperada entre reintentos de escritura", async () => {
  const solicitudes: RequestInit[] = [];
  const remoto = new AdministracionRest(
    "/api/v1",
    undefined,
    async (_, opciones) => {
      solicitudes.push(opciones!);
      return Response.json({
        producto: { ...producto, versión_sincronización: 2 },
      });
    },
  );
  const operación = propuesta();
  await remoto.enviar(operación, new AbortController().signal);
  await remoto.enviar(operación, new AbortController().signal);
  assert.deepEqual(solicitudes[0].headers, solicitudes[1].headers);
  assert.equal(
    (solicitudes[0].headers as Record<string, string>)["Idempotency-Key"],
    operación.identificador,
  );
  assert.equal(JSON.parse(String(solicitudes[0].body))["versión_esperada"], 1);
  assert.equal(solicitudes[0].body, solicitudes[1].body);
});

test("conflicto 409 conserva propuesta, UUID y versión del servidor para revisión", async () =>
  conBase(async (local, nombre) => {
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    const actual = {
      ...producto,
      nombre: "Cambio ajeno",
      versión_sincronización: 2,
    };
    const procesador = {
      tipo: operación.tipo,
      endpoint: "/api/v1/productos",
      procesar: async () => {
        throw new ErrorRemoto(409, "Conflicto", {
          código: "CONFLICTO_VERSION",
          producto_actual: actual,
        });
      },
    };
    await new Sincronizador(local, fuente, [procesador]).sincronizar();
    await local.cerrar();
    const reabierta = new RepositorioLocal(nombre);
    try {
      const persistida = (await reabierta.operaciones())[0];
      assert.equal(persistida.estado, "REQUIERE_REVISION");
      assert.equal(persistida.identificador, operación.identificador);
      assert.deepEqual(persistida.datos, operación.datos);
      assert.deepEqual(persistida.detalleError?.["producto_actual"], actual);
    } finally {
      await reabierta.cerrar();
    }
  }));

test("confirmación remota guarda comprobante y producto administrativo, sin publicar un recibo histórico activo", async () =>
  conBase(async (local) => {
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    const reclamada = await local.reclamar(
      operación.identificador,
      "propietario",
      Date.now(),
    );
    assert.ok(reclamada);
    const confirmado = { ...producto, versión_sincronización: 2 };
    await local.finalizar(
      { ...reclamada, estado: "CONFIRMADA" },
      "propietario",
      confirmado,
    );
    assert.equal((await local.operaciones())[0].estado, "CONFIRMADA");
    assert.deepEqual((await local.operaciones())[0].resultado, confirmado);
    assert.deepEqual(await local.productosAdministracion(), [confirmado]);
    assert.deepEqual(await local.productos(), []);
  }));

test("una confirmación de desactivación retira el producto público y conserva el administrativo", async () =>
  conBase(async (local) => {
    await local.guardarCatalogo([producto]);
    await local.guardarAdministracion([producto]);
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    const reclamada = await local.reclamar(
      operación.identificador,
      "propietario",
      Date.now(),
    );
    assert.ok(reclamada);
    await local.finalizar(
      { ...reclamada, estado: "CONFIRMADA" },
      "propietario",
      { ...producto, activo: false, versión_sincronización: 2 },
    );
    assert.deepEqual(await local.productos(), []);
    assert.equal((await local.productosAdministracion())[0].activo, false);
  }));

test("un recibo idempotente antiguo no reemplaza una versión confirmada más reciente", async () =>
  conBase(async (local) => {
    const másReciente = {
      ...producto,
      activo: false,
      versión_sincronización: 3,
    };
    await local.guardarAdministracion([másReciente]);
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    const reclamada = await local.reclamar(
      operación.identificador,
      "propietario",
      Date.now(),
    );
    assert.ok(reclamada);
    await local.finalizar(
      { ...reclamada, estado: "CONFIRMADA" },
      "propietario",
      { ...producto, versión_sincronización: 2 },
    );
    assert.deepEqual(await local.productosAdministracion(), [másReciente]);
    assert.deepEqual(await local.productos(), []);
  }));

test("la corrección explícita crea otra operación y conserva el conflicto original", async () =>
  conBase(async (local) => {
    const anterior = {
      ...propuesta(),
      estado: "REQUIERE_REVISION" as const,
      error: "Conflicto",
    };
    await local.guardarOperacion(anterior);
    const nueva = { ...propuesta(), versiónEsperada: 2 };
    await local.encolarAdministrativa(nueva, anterior.identificador);
    const operaciones = await local.operaciones();
    assert.equal(
      operaciones.find(
        (operación) => operación.identificador === anterior.identificador,
      )?.estado,
      "REQUIERE_REVISION",
    );
    assert.equal(
      operaciones.find(
        (operación) => operación.identificador === anterior.identificador,
      )?.reemplazadaPor,
      nueva.identificador,
    );
    await assert.rejects(
      local.encolarAdministrativa(propuesta(), anterior.identificador),
    );
  }));

test("rechazo de autorización 403 jamás confirma ni aplica la propuesta", async () =>
  conBase(async (local) => {
    const operación = propuesta();
    await local.encolarAdministrativa(operación);
    await new Sincronizador(local, fuente, [
      {
        tipo: operación.tipo,
        endpoint: "/api/v1/productos",
        procesar: async () => {
          throw new ErrorRemoto(403, "No autorizado");
        },
      },
    ]).sincronizar();
    assert.equal((await local.operaciones())[0].estado, "REQUIERE_REVISION");
    assert.deepEqual(await local.productosAdministracion(), []);
  }));

test("validaciones administrativas no convierten dinero a float ni aceptan cero", () => {
  const datos = {
    sku: "clb-1",
    nombre: "Camisa de año nuevo",
    descripción: "",
    categoría: "Camisas",
    precio: "0.29",
    activo: true,
  };
  assert.deepEqual(validarProducto(datos), {});
  for (const precio of [
    "0",
    "0.00",
    "1,20",
    "1e3",
    "-1",
    "1.001",
    "1000000000.00",
  ])
    assert.ok(validarProducto({ ...datos, precio })["precio"]);
});

test("reintentos agotados conservan UUID y datos; la revisión manual consulta la misma operación", async () =>
  conBase(async (local) => {
    const operación = { ...propuesta(), intentos: 7 };
    await local.encolarAdministrativa(operación);
    const temporal = {
      tipo: operación.tipo,
      endpoint: "/api/v1/productos",
      procesar: async () => {
        throw new ErrorRemoto(503, "Respuesta incierta");
      },
    };
    await new Sincronizador(local, fuente, [temporal]).sincronizar();
    const incierta = (await local.operaciones())[0];
    assert.equal(incierta.estado, "REQUIERE_REVISION");
    assert.equal(incierta.motivoRevision, "REINTENTOS_AGOTADOS");
    await assert.rejects(
      local.encolarAdministrativa(propuesta(), incierta.identificador),
    );
    await local.reintentarIncierta(incierta.identificador);
    const reintentada = (await local.operaciones())[0];
    assert.equal(reintentada.identificador, operación.identificador);
    assert.equal(reintentada.claveIdempotencia, operación.claveIdempotencia);
    assert.deepEqual(reintentada.datos, operación.datos);
    assert.equal(reintentada.intentos, 8);
    await new Sincronizador(local, fuente, [
      {
        tipo: operación.tipo,
        endpoint: "/api/v1/productos",
        procesar: async () => producto,
      },
    ]).sincronizar();
    assert.equal((await local.operaciones())[0].estado, "CONFIRMADA");
    assert.equal((await local.operaciones()).length, 1);
  }));
