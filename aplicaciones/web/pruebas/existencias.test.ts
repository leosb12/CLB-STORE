import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB, deleteDB } from "idb";
import { RepositorioLocal } from "../fuente/catalogo/adaptadores/repositorio-local";
import { Sincronizador } from "../fuente/catalogo/aplicacion/sincronizador";
import { AdministracionRest } from "../fuente/administracion/adaptadores/administracion-rest";
import { centavos, importe, totalCarrito, varianteValida, type Variante, type LineaCarrito } from "../fuente/existencias/dominio/modelos";
import { ErrorRemoto, type Operacion, type FuenteCatalogo } from "../fuente/catalogo/dominio/modelos";

const variante: Variante = { identificador: crypto.randomUUID(), identificador_producto: "a".repeat(32), sku: "CLB-NEGRO-M", talla: "M", color: "Negro", activo: true, física: 10, reservada: 2, disponible: 8, mínimo: 3, versión_sincronización: 2, fecha_creación: "2026-10-21T12:00:00Z", fecha_actualización: "2026-10-21T12:00:00Z" };
const línea: LineaCarrito = { identificador: variante.identificador, identificadorProducto: variante.identificador_producto, sku: variante.sku, talla: variante.talla, color: variante.color, nombre: "Camiseta", precioCentavos: 29, cantidad: 3 };
const fuente: FuenteCatalogo = { disponible: async () => true, descargar: async () => [], consultar: async () => { throw new Error("No utilizada"); } };
function operación(tipo = "REGISTRAR_MOVIMIENTO"): Operacion {
  const id = crypto.randomUUID();
  return { identificador: id, tipo, claveIdempotencia: id, datos: tipo === "CREAR_VARIANTE" ? { identificador: variante.identificador, identificador_producto: variante.identificador_producto, sku: variante.sku, talla: "M", color: "Negro", activo: true } : { identificador_variante: variante.identificador, tipo: "ENTRADA", cantidad: 1, motivo: "Recuento" }, versiónEsperada: 2, fechaCreación: "2026-10-21T12:00:00Z", estado: "PENDIENTE", intentos: 0, próximoIntento: 0 };
}
async function conBase(acción: (local: RepositorioLocal, nombre: string) => Promise<void>): Promise<void> {
  const nombre = "clb_prueba_" + crypto.randomUUID(), local = new RepositorioLocal(nombre);
  try { await acción(local, nombre); } finally { await local.cerrar(); await deleteDB(nombre); }
}
test("migración v2→v3 conserva datos anteriores y una sola cola", () => conBase(async (local, nombre) => {
  const base = await openDB(nombre, 2, { upgrade(b) { for (const n of ["productos", "productosAdministracion", "favoritos", "operaciones"]) b.createObjectStore(n, { keyPath: "identificador" }); b.createObjectStore("metadatos", { keyPath: "clave" }); } });
  const op = operación(); await base.put("operaciones", op); await base.put("favoritos", { identificador: "favorito", fechaActualización: "fecha" }); base.close();
  assert.deepEqual(await local.operaciones(), [op]); assert.equal((await local.favoritos()).length, 1);
  await local.agregarCarrito(línea); assert.equal((await local.carrito()).length, 1);
}));
test("carrito exacto persiste, combina UUID, edita offline y vacía sin operaciones remotas", () => conBase(async (local) => {
  await local.agregarCarrito(línea); await local.agregarCarrito({ ...línea, cantidad: 4 }); await local.cerrar();
  assert.equal((await local.carrito())[0].cantidad, 7); assert.equal(importe(totalCarrito(await local.carrito())), "2,03 Bs");
  await local.cantidadCarrito(línea.identificador, 1_000_000_000); assert.equal((await local.carrito())[0].cantidad, 1_000_000_000);
  assert.equal((await local.operaciones()).length, 0); await local.quitarCarrito(línea.identificador); assert.deepEqual(await local.carrito(), []);
  await local.agregarCarrito(línea); await local.vaciarCarrito(); assert.deepEqual(await local.carrito(), []);
}));
test("dos pestañas agregan al carrito sin perder cantidades", () => conBase(async (local, nombre) => {
  const otra = new RepositorioLocal(nombre);
  try { await Promise.all([local.agregarCarrito(línea), otra.agregarCarrito(línea)]); assert.equal((await local.carrito())[0].cantidad, 6); }
  finally { await otra.cerrar(); }
}));
test("dinero se calcula con centavos y bigint sin redondeo binario", () => {
  assert.equal(centavos("0.29"), 29); assert.equal(centavos("129.9"), 12990); assert.equal(importe(totalCarrito([{ ...línea, precioCentavos: centavos("999999999.99"), cantidad: 1_000_000_000 }])), "999999999990000000,00 Bs");
  assert.throws(() => centavos("0.291")); assert.throws(() => centavos("1e2"));
});
test("carrito rechaza fracciones, negativos y cantidades no seguras", () => conBase(async local => {
  for (const cantidad of [0, -1, 1.2, NaN, 1_000_000_001]) await assert.rejects(local.agregarCarrito({ ...línea, cantidad }));
  assert.deepEqual(await local.carrito(), []);
}));
test("variantes confirmadas persisten separadas de propuestas y del catálogo público", () => conBase(async local => {
  await local.guardarVariantes(variante.identificador_producto, [variante]);
  await local.encolarExistencias(operación("MODIFICAR_VARIANTE"));
  await local.cerrar(); assert.deepEqual(await local.variantes(variante.identificador_producto), [variante]);
  assert.deepEqual(await local.variantes(variante.identificador_producto, true), []);
}));
test("cola causal espera creación y resuelve versión desde su comprobante", () => conBase(async local => {
  const crear = operación("CREAR_VARIANTE"), mover = operación();
  await local.encolarExistencias(crear); await local.encolarExistencias(mover);
  const pendientes = await local.operaciones(); assert.deepEqual(pendientes.find(op => op.identificador === mover.identificador)?.dependencias, [crear.identificador]);
  assert.equal(await local.reclamar(mover.identificador, "dueño", 0), undefined);
  const envíos: string[] = [];
  const motor = new Sincronizador(local, fuente, ["CREAR_VARIANTE", "REGISTRAR_MOVIMIENTO"].map(tipo => ({ tipo, endpoint: "/real", procesar: async op => {
    envíos.push(op.tipo); if (tipo === "REGISTRAR_MOVIMIENTO") assert.equal(op.versiónEsperada, 1);
    return { variante: { ...variante, versión_sincronización: tipo === "CREAR_VARIANTE" ? 1 : 2 } };
  } })));
  await motor.sincronizar(true); assert.deepEqual(envíos, ["CREAR_VARIANTE", "REGISTRAR_MOVIMIENTO"]);
  assert.ok((await local.operaciones()).every(op => op.estado === "CONFIRMADA"));
}));
test("dependencia rechazada bloquea movimiento sin gastar intentos", () => conBase(async local => {
  const crear = operación("CREAR_VARIANTE"), mover = operación();
  await local.encolarExistencias(crear); await local.encolarExistencias(mover);
  await new Sincronizador(local, fuente, [{ tipo: "CREAR_VARIANTE", endpoint: "/real", procesar: async () => { throw new ErrorRemoto(422, "SKU inválido"); } }, { tipo: "REGISTRAR_MOVIMIENTO", endpoint: "/real", procesar: async () => { assert.fail("No debía enviarse"); } }]).sincronizar(true);
  const ops = await local.operaciones(); assert.equal(ops.find(op => op.identificador === mover.identificador)?.intentos, 0); assert.equal(ops.find(op => op.identificador === crear.identificador)?.estado, "REQUIERE_REVISION");
}));
test("corrección explícita conserva antecedente y redirige dependencias no enviadas", () => conBase(async local => {
  const crear = operación("CREAR_VARIANTE"), mover = operación();
  await local.encolarExistencias(crear); await local.encolarExistencias(mover);
  await local.guardarOperacion({ ...crear, estado: "REQUIERE_REVISION", motivoRevision: "CONFLICTO_PERMANENTE" });
  const corregida = operación("CREAR_VARIANTE"); await local.encolarExistencias(corregida, crear.identificador);
  const ops = await local.operaciones(); assert.equal(ops.find(op => op.identificador === crear.identificador)?.reemplazadaPor, corregida.identificador);
  assert.deepEqual(ops.find(op => op.identificador === mover.identificador)?.dependencias, [corregida.identificador]);
  assert.equal(ops.find(op => op.identificador === corregida.identificador)?.dependencias, undefined);
}));
test("cadena de movimientos con igual fecha conserva orden causal y versiones", () => conBase(async local => {
  const a = operación(), b = operación(), c = operación();
  for (const op of [a, b, c]) await local.encolarExistencias(op);
  let versión = 2;
  await new Sincronizador(local, fuente, [{ tipo: a.tipo, endpoint: "/real", procesar: async op => { assert.equal(op.versiónEsperada, versión); return { variante: { ...variante, versión_sincronización: ++versión } }; } }]).sincronizar(true);
  assert.equal(versión, 5); assert.ok((await local.operaciones()).every(op => op.estado === "CONFIRMADA"));
}));
test("confirmación incierta impide propuesta nueva sobre la misma variante", () => conBase(async local => {
  await local.guardarOperacion({ ...operación(), estado: "REQUIERE_REVISION", motivoRevision: "REINTENTOS_AGOTADOS" });
  await assert.rejects(local.encolarExistencias(operación()), /incierta/);
}));
test("GraphQL de gestión envía UUID estable, clave y versión y rechaza confirmación inválida", async () => {
  const op = operación(); let cuerpo: Record<string, unknown> = {}, clave = "", consulta = "";
  const respuesta = (datos: unknown) => new Response(JSON.stringify({ data: { registrarMovimiento: datos } }));
  const remoto = new AdministracionRest("/api/v1", undefined, async (_url, opciones) => {
    const envío = JSON.parse(String(opciones?.body)); consulta = envío.query; cuerpo = envío.variables.d; clave = envío.variables.c;
    return respuesta({ variante: { ...variante, versión_sincronización: 3 } });
  });
  await remoto.enviarExistencias(op, new AbortController().signal); assert.equal(cuerpo["versión_esperada"], 2); assert.equal(clave, op.claveIdempotencia);
  assert.match(consulta, /^mutation/);
  const inválido = new AdministracionRest("/api/v1", undefined, async () => respuesta({ variante: { ...variante, disponible: -1 } }));
  await assert.rejects(inválido.enviarExistencias(op, new AbortController().signal), /confirmación válida/);
  const sinCambio = new AdministracionRest("/api/v1", undefined, async () => respuesta({ variante }));
  await assert.rejects(sinCambio.enviarExistencias(op, new AbortController().signal), /confirmación válida/);
});
test("reintento transitorio conserva clave, datos y versión resuelta", () => conBase(async local => {
  const op = operación(); await local.encolarExistencias(op); let intentos = 0; let ahora = 0;
  const motor = new Sincronizador(local, fuente, [{ tipo: op.tipo, endpoint: "/real", procesar: async enviada => { assert.equal(enviada.claveIdempotencia, op.claveIdempotencia); assert.equal(enviada.versiónEsperada, 2); if (++intentos === 1) throw new Error("Respuesta perdida"); return { variante }; } }], () => ahora);
  await motor.sincronizar(true); ahora = 2000; await motor.sincronizar(true);
  assert.equal(intentos, 2); assert.equal((await local.operaciones())[0].estado, "CONFIRMADA");
}));
test("ack de variante es atómico con comprobante y no altera disponibilidad pública histórica", () => conBase(async local => {
  await local.guardarVariantes(variante.identificador_producto, [variante]); const op = operación(); await local.encolarExistencias(op);
  await local.reclamar(op.identificador, "dueño", 0);
  await local.finalizar({ ...op, estado: "CONFIRMADA" }, "dueño", { variante: { ...variante, disponible: 9, física: 11, versión_sincronización: 3 } });
  assert.equal((await local.operaciones())[0].resultadoExistencias?.disponible, 9);
  assert.equal((await local.variantes(variante.identificador_producto))[0].disponible, 8);
  assert.equal((await local.variantes(variante.identificador_producto, true))[0].disponible, 9);
}));
test("contrato público no acepta saldos inconsistentes ni identificadores inválidos", () => {
  assert.equal(varianteValida(variante), true); assert.equal(varianteValida({ ...variante, reservada: 20 }), false); assert.equal(varianteValida({ ...variante, identificador: "nombre" }), false);
});
