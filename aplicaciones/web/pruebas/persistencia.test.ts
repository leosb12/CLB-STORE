import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB } from "idb";
import { RepositorioLocal } from "../fuente/catalogo/adaptadores/repositorio-local";
import { CatalogoRest } from "../fuente/catalogo/adaptadores/catalogo-rest";
import { Sincronizador } from "../fuente/catalogo/aplicacion/sincronizador";
import {
  ErrorRemoto,
  type FuenteCatalogo,
  type Operacion,
  type Producto,
  type ProcesadorOperacion,
} from "../fuente/catalogo/dominio/modelos";

const producto: Producto = {
  identificador: "a".repeat(32),
  sku: "CLB-PRUEBA",
  nombre: "Camisa de diseño",
  descripción: "Confección boliviana",
  categoría: "Camisas",
  precio: "0.29",
  moneda: "BOB",
  activo: true,
  fecha_creación: "2026-10-19T12:00:00Z",
  fecha_actualización: "2026-10-19T12:00:00Z",
  versión_sincronización: 1,
};
const fuente: FuenteCatalogo = {
  disponible: async () => true,
  descargar: async () => [producto],
  consultar: async () => producto,
};

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
function operación(tipo = "PRUEBA_CON_ENDPOINT"): Operacion {
  const identificador = crypto.randomUUID();
  return {
    identificador,
    tipo,
    fechaCreación: new Date().toISOString(),
    estado: "PENDIENTE",
    intentos: 0,
    próximoIntento: 0,
    datos: { ejemplo: true },
    claveIdempotencia: identificador,
  };
}

test("REST valida el contrato y conserva el precio decimal exacto", async () => {
  let ruta = "";
  const remoto = new CatalogoRest("/api/v1", async (entrada) => {
    ruta = String(entrada);
    return Response.json({
      productos: [producto],
      paginación: { página: 1, límite: 100, total: 1, páginas: 1 },
    });
  });
  assert.equal((await remoto.descargar())[0].precio, "0.29");
  assert.match(decodeURIComponent(ruta), /página=1/);
});

test("una descarga REST incompleta no se interpreta como catálogo vacío", async () => {
  const remoto = new CatalogoRest("/api/v1", async () =>
    Response.json({
      productos: [],
      paginación: { página: 1, límite: 100, total: 5, páginas: 1 },
    }),
  );
  await assert.rejects(remoto.descargar(), /incompleta/);
});

test("los productos y metadatos persisten al cerrar y reabrir IndexedDB", async () =>
  conBase(async (local, nombre) => {
    await local.guardarCatalogo([producto]);
    await local.cerrar();
    const reabierta = new RepositorioLocal(nombre);
    try {
      assert.deepEqual(await reabierta.productos(), [producto]);
      assert.equal(
        typeof (await reabierta.metadato("última_sincronización")),
        "string",
      );
    } finally {
      await reabierta.cerrar();
    }
  }));

test("favoritos y cola persisten atómicamente entre sesiones", async () =>
  conBase(async (local, nombre) => {
    await local.alternarFavorito(producto.identificador);
    const original = (await local.operaciones())[0];
    await local.cerrar();
    const reabierta = new RepositorioLocal(nombre);
    try {
      assert.equal(
        (await reabierta.favoritos())[0].identificador,
        producto.identificador,
      );
      assert.deepEqual((await reabierta.operaciones())[0], original);
      assert.equal(original.estado, "PENDIENTE");
      await reabierta.alternarFavorito(producto.identificador);
      assert.equal((await reabierta.favoritos()).length, 0);
      assert.equal((await reabierta.operaciones()).length, 2);
    } finally {
      await reabierta.cerrar();
    }
  }));

test("la sincronización de lectura guarda productos devueltos por REST", async () =>
  conBase(async (local) => {
    const remoto = new CatalogoRest("/api/v1", async (entrada) =>
      Response.json({
        productos: [producto],
        paginación: {
          página: 1,
          límite: String(entrada).includes("100") ? 100 : 1,
          total: 1,
          páginas: 1,
        },
      }),
    );
    assert.equal(
      (await new Sincronizador(local, remoto).sincronizar()).actualizado,
      true,
    );
    assert.deepEqual(await local.productos(), [producto]);
  }));

test("sin backend se leen los productos guardados y no se elimina el catálogo", async () =>
  conBase(async (local) => {
    await local.guardarCatalogo([producto]);
    const fecha = await local.metadato("última_sincronización");
    const caído = { ...fuente, disponible: async () => false };
    assert.equal(
      (await new Sincronizador(local, caído).sincronizar()).disponible,
      false,
    );
    assert.deepEqual(await local.productos(), [producto]);
    assert.equal(await local.metadato("última_sincronización"), fecha);
  }));

test("una descarga parcial fallida conserva los datos anteriores", async () =>
  conBase(async (local) => {
    await local.guardarCatalogo([producto]);
    const fallida = {
      ...fuente,
      descargar: async (): Promise<Producto[]> => {
        throw new Error("Red interrumpida");
      },
    };
    await new Sincronizador(local, fallida).sincronizar();
    assert.deepEqual(await local.productos(), [producto]);
  }));

test("favoritos sin procesador ni endpoint permanecen pendientes sin intentos", async () =>
  conBase(async (local) => {
    await local.alternarFavorito(producto.identificador);
    await new Sincronizador(local, fuente).sincronizar();
    const pendiente = (await local.operaciones())[0];
    assert.equal(pendiente.estado, "PENDIENTE");
    assert.equal(pendiente.intentos, 0);
  }));

test("el backoff mantiene UUID e idempotencia y confirma solo tras procesar", async () =>
  conBase(async (local) => {
    let ahora = 10000;
    let envíos = 0;
    const pendiente = operación();
    await local.guardarOperacion(pendiente);
    const procesador: ProcesadorOperacion = {
      tipo: pendiente.tipo,
      endpoint: "/endpoint-solo-de-prueba",
      procesar: async (enviada) => {
        assert.equal(enviada.identificador, pendiente.identificador);
        assert.equal(enviada.claveIdempotencia, pendiente.claveIdempotencia);
        if (++envíos === 1) throw new ErrorRemoto(503, "Error temporal");
      },
    };
    const motor = new Sincronizador(local, fuente, [procesador], () => ahora);
    await motor.sincronizar();
    let guardada = (await local.operaciones())[0];
    assert.equal(guardada.estado, "ERROR_REINTENTABLE");
    assert.equal(guardada.próximoIntento, 11000);
    await motor.sincronizar();
    assert.equal(envíos, 1);
    ahora = 11001;
    await motor.sincronizar();
    guardada = (await local.operaciones())[0];
    assert.equal(guardada.estado, "CONFIRMADA");
    assert.equal(guardada.intentos, 2);
    assert.equal(guardada.identificador, pendiente.identificador);
    assert.equal(guardada.claveIdempotencia, pendiente.claveIdempotencia);
  }));

test("conflictos permanentes requieren revisión y no se reintentan", async () =>
  conBase(async (local) => {
    const pendiente = operación();
    await local.guardarOperacion(pendiente);
    let envíos = 0;
    const motor = new Sincronizador(local, fuente, [
      {
        tipo: pendiente.tipo,
        endpoint: "/prueba",
        procesar: async () => {
          envíos++;
          throw new ErrorRemoto(409, "Conflicto");
        },
      },
    ]);
    await motor.sincronizar();
    await motor.sincronizar();
    assert.equal((await local.operaciones())[0].estado, "REQUIERE_REVISION");
    assert.equal(envíos, 1);
  }));

test("dos sincronizadores y dos conexiones no duplican una operación concurrente", async () =>
  conBase(async (local, nombre) => {
    const segunda = new RepositorioLocal(nombre);
    const pendiente = operación();
    await local.guardarOperacion(pendiente);
    let envíos = 0;
    const procesador: ProcesadorOperacion = {
      tipo: pendiente.tipo,
      endpoint: "/prueba",
      procesar: async () => {
        envíos++;
        await new Promise((resolver) => setTimeout(resolver, 30));
      },
    };
    const uno = new Sincronizador(local, fuente, [procesador]);
    const dos = new Sincronizador(segunda, fuente, [procesador]);
    try {
      await Promise.all([
        uno.sincronizar(),
        uno.sincronizar(),
        dos.sincronizar(),
      ]);
      assert.equal(envíos, 1);
    } finally {
      await segunda.cerrar();
    }
  }));

test("recupera una operación ENVIANDO abandonada tras expirar su arrendamiento", async () =>
  conBase(async (local) => {
    const pendiente = operación();
    await local.guardarOperacion({
      ...pendiente,
      estado: "ENVIANDO",
      propietario: "sesión-cerrada",
      vencimiento: 5000,
      intentos: 1,
    });
    const motor = new Sincronizador(
      local,
      fuente,
      [
        {
          tipo: pendiente.tipo,
          endpoint: "/prueba",
          procesar: async () => undefined,
        },
      ],
      () => 6000,
    );
    await motor.sincronizar();
    const recuperada = (await local.operaciones())[0];
    assert.equal(recuperada.estado, "CONFIRMADA");
    assert.equal(recuperada.identificador, pendiente.identificador);
    assert.equal(recuperada.intentos, 2);
  }));

test("una escritura tardía de otro propietario no confirma una operación reclamada", async () =>
  conBase(async (local) => {
    const pendiente = operación();
    await local.guardarOperacion(pendiente);
    const primera = await local.reclamar(pendiente.identificador, "antiguo", 0);
    const nueva = await local.reclamar(pendiente.identificador, "nuevo", 31000);
    assert.ok(primera);
    assert.ok(nueva);
    await local.finalizar({ ...primera, estado: "CONFIRMADA" }, "antiguo");
    assert.equal((await local.operaciones())[0].propietario, "nuevo");
    assert.equal((await local.operaciones())[0].estado, "ENVIANDO");
  }));

test("una reconexión reemplaza el catálogo completo sin borrar favoritos ni cola", async () =>
  conBase(async (local) => {
    await local.guardarCatalogo([producto]);
    await local.alternarFavorito(producto.identificador);
    const actualizado = {
      ...producto,
      nombre: "Camisa actualizada",
      versión_sincronización: 2,
    };
    await new Sincronizador(local, {
      ...fuente,
      descargar: async () => [actualizado],
    }).sincronizar();
    assert.equal((await local.productos())[0].nombre, "Camisa actualizada");
    assert.equal((await local.favoritos()).length, 1);
    assert.equal((await local.operaciones()).length, 1);
  }));
