import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB } from "idb";
import { RepositorioLocal } from "../fuente/catalogo/adaptadores/repositorio-local";
import { Sincronizador } from "../fuente/catalogo/aplicacion/sincronizador";
import type { FuenteCatalogo, Operacion } from "../fuente/catalogo/dominio/modelos";
import type { LineaCarrito } from "../fuente/existencias/dominio/modelos";
import { VentasRest } from "../fuente/pedidos/adaptadores/ventas-rest";
import { CONFIRMAR_PEDIDO, fusionarHistorial, solicitudPedido, type PedidoVenta } from "../fuente/pedidos/dominio/modelos";

const fuente: FuenteCatalogo = { disponible: async () => true, descargar: async () => [], consultar: async () => { throw new Error("No utilizada"); } };
const línea: LineaCarrito = { identificador: crypto.randomUUID(), identificadorProducto: "a".repeat(32), sku: "CLB-M-NEGRO", talla: "M", color: "Negro", nombre: "Polera", precioCentavos: 12_000, cantidad: 2 };

async function conBase(acción: (local: RepositorioLocal) => Promise<void>): Promise<void> {
  const nombre = "clb_prueba_" + crypto.randomUUID(), local = new RepositorioLocal(nombre);
  try { await acción(local); } finally { await local.cerrar(); await deleteDB(nombre); }
}

function crearPedido(líneas: LineaCarrito[]): Operacion {
  const identificador = crypto.randomUUID();
  return { identificador, tipo: CONFIRMAR_PEDIDO, fechaCreación: new Date().toISOString(), estado: "PENDIENTE", intentos: 0, próximoIntento: 0,
    datos: solicitudPedido(identificador, líneas), claveIdempotencia: crypto.randomUUID(), titular: "titular-a" };
}

// Sesión de Keycloak simulada: los adaptadores solo necesitan la cabecera Authorization.
const conSesión = { cabeceras: async () => ({ Authorization: "Bearer token-de-prueba" }), sub: async () => "titular-a" };
const ventas = () => new VentasRest("/api/v1", conSesión);

function pedidoVenta(id: string, estado: PedidoVenta["estado"] = "CONFIRMADO", actualización = "2026-10-22T12:00:00Z"): PedidoVenta {
  return { identificador: id, identificador_cliente: crypto.randomUUID(), estado, motivo: null, total: "240.00", moneda: "BOB",
    líneas: [{ identificador_variante: línea.identificador, sku: línea.sku, nombre: "Polera", talla: "M", color: "Negro", precio: "120.00", cantidad: 2, subtotal: "240.00" }],
    fecha_creación: "2026-10-22T12:00:00Z", fecha_actualización: actualización };
}

test("historial combina dispositivos por UUID sin crear operaciones y conserva el resultado local más reciente", () => {
  const op = crearPedido([línea]), pendiente = crearPedido([línea]);
  op.resultadoPedido = pedidoVenta(op.identificador, "CONFIRMADO", "2026-10-22T12:01:00Z");
  const remoto = pedidoVenta(crypto.randomUUID());
  const originales = structuredClone([op, pendiente]);
  const vista = fusionarHistorial([op, pendiente], [pedidoVenta(op.identificador, "PENDIENTE"), remoto]);
  assert.equal(vista.length, 3);
  assert.deepEqual(vista.filter(e => e.operacion).map(e => e.operacion?.identificador), [pendiente.identificador]);
  assert.equal(vista.find(e => e.pedido?.identificador === op.identificador)?.pedido?.estado, "CONFIRMADO");
  assert.deepEqual([op, pendiente], originales);
});

test("historial se guarda por cuenta y sobrevive al reinicio sin cambiar carrito ni cola", () => conBase(async local => {
  await local.agregarCarrito(línea);
  await local.encolarPedido(crearPedido);
  await local.agregarCarrito(línea);
  const cola = await local.operaciones(), carrito = await local.carrito();
  const pedidos = [pedidoVenta(crypto.randomUUID())], fecha = "2026-10-22T13:00:00Z";
  await local.guardarHistorial("cuenta-a", pedidos, fecha);
  await local.cerrar();
  assert.deepEqual(await local.historial("cuenta-a"), { pedidos, fecha });
  assert.equal(await local.historial("cuenta-b"), undefined);
  assert.deepEqual(await local.operaciones(), cola);
  assert.deepEqual(await local.carrito(), carrito);
}));

test("historial REST pagina con token, conserva copia ante corte y rechaza datos ajenos o cambio de sesión", () => conBase(async local => {
  const titular = crypto.randomUUID();
  let cuenta = titular, pagina = 0, modo = "ok";
  const a = { ...pedidoVenta(crypto.randomUUID()), identificador_cliente: titular };
  const b = { ...pedidoVenta(crypto.randomUUID()), identificador_cliente: titular };
  await local.guardarHistorial(titular, [a], "fecha anterior");
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, opciones) => {
    assert.equal((opciones?.headers as Record<string, string>)["Authorization"], "Bearer prueba");
    pagina++;
    if (pagina % 2 === 0) {
      assert.ok(String(url).includes("antes=" + a.identificador));
      if (modo === "corte") throw new TypeError("Sin red");
      return Response.json({ pedidos: [b], siguiente: null });
    }
    if (modo === "sesion") cuenta = "otra";
    return Response.json({ pedidos: [{ ...a, identificador_cliente: modo === "ajeno" ? "otra" : titular }], siguiente: a.identificador });
  }) as typeof fetch;
  try {
    const rest = new VentasRest("/api/v1", { sub: async () => cuenta, cabeceras: async () => ({ Authorization: "Bearer prueba" }) });
    assert.deepEqual(await rest.historial(titular), [a, b]);
    modo = "corte"; pagina = 0;
    await assert.rejects(async () => local.guardarHistorial(titular, await rest.historial(titular), "nueva"));
    assert.equal((await local.historial(titular))?.fecha, "fecha anterior");
    modo = "ajeno"; pagina = 0;
    await assert.rejects(rest.historial(titular), /otra cuenta/);
    modo = "sesion"; pagina = 0;
    await assert.rejects(rest.historial(titular), /sesión cambió/);
    assert.deepEqual(await local.operaciones(), []);
  } finally { globalThis.fetch = original; }
}));

test("confirmar encola el pedido y vacía el carrito en una sola transacción; el cliente no viaja en el pedido", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  const primera = await local.encolarPedido(crearPedido);
  assert.equal((await local.carrito()).length, 0);
  assert.deepEqual((await local.operaciones()).map(op => op.identificador), [primera.identificador]);
  assert.equal(primera.datos["identificador"], primera.identificador);
  assert.ok(!("identificador_cliente" in primera.datos), "Ventas toma el cliente del token, no del dispositivo.");
}));

test("con el carrito vacío no se crea pedido ni cambia nada", () => conBase(async (local) => {
  await assert.rejects(local.encolarPedido(crearPedido), /carrito está vacío/);
  assert.equal((await local.operaciones()).length, 0);
}));

test("sin sesión el pedido no se envía: queda reintentable con la misma clave", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  await local.encolarPedido(crearPedido);
  let llamadas = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => { llamadas++; return new Response("{}", { status: 201 }); }) as typeof fetch;
  try {
    await new Sincronizador(local, fuente, new VentasRest("/api/v1").procesadores()).sincronizar(true);
    const pendiente = (await local.operaciones())[0];
    assert.equal(pendiente.estado, "ERROR_REINTENTABLE");
    assert.equal(pendiente.error, "Inicia sesión para enviar tus pedidos.");
    assert.equal(llamadas, 0, "Sin token no se llama a Ventas.");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}));

test("los pedidos se envían aunque Inventario no responda", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  const operación = await local.encolarPedido(crearPedido);
  const inventarioCaído: FuenteCatalogo = { disponible: async () => false, descargar: async () => { throw new Error("caído"); }, consultar: async () => { throw new Error("caído"); } };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ pedido: pedidoVenta(operación.identificador) }), { status: 201 })) as typeof fetch;
  try {
    const resultado = await new Sincronizador(local, inventarioCaído, ventas().procesadores()).sincronizar(true);
    assert.equal(resultado.disponible, false, "El catálogo sigue marcado como no actualizado.");
    assert.equal((await local.operaciones())[0].estado, "CONFIRMADA");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}));

test("un pedido rechazado devuelve sus prendas al carrito una sola vez y conserva el antecedente", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  const operación = await local.encolarPedido(crearPedido);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ mensaje: "La variante no está disponible.", código: "VARIANTE_NO_DISPONIBLE" }), { status: 422 })) as typeof fetch;
  try {
    await new Sincronizador(local, fuente, ventas().procesadores()).sincronizar(true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  await local.recuperarPedidoEnCarrito(operación.identificador);
  assert.deepEqual((await local.carrito()).map(l => [l.identificador, l.cantidad]), [[línea.identificador, 2]]);
  assert.equal((await local.operaciones())[0].reemplazadaPor, "CARRITO");
  await assert.rejects(local.recuperarPedidoEnCarrito(operación.identificador), /no se puede devolver/);
  assert.equal((await local.carrito())[0].cantidad, 2, "No se duplican prendas.");
}));

test("el sincronizador reintenta con la misma clave y guarda el pedido confirmado sin enviar la copia local", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  const operación = await local.encolarPedido(crearPedido);
  const envíos: { clave: string | null; cuerpo: Record<string, unknown> }[] = [];
  let caído = true;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: string, opciones: RequestInit) => {
    envíos.push({ clave: new Headers(opciones.headers).get("Idempotency-Key"), cuerpo: JSON.parse(String(opciones.body)) });
    if (caído) return new Response(JSON.stringify({ mensaje: "Inventario no responde.", código: "SERVICIO_NO_DISPONIBLE" }), { status: 503 });
    return new Response(JSON.stringify({ pedido: pedidoVenta(operación.identificador) }), { status: 201 });
  }) as typeof fetch;
  try {
    const motor = new Sincronizador(local, fuente, ventas().procesadores(), () => Date.now());
    await motor.sincronizar(true);
    assert.equal((await local.operaciones())[0].estado, "ERROR_REINTENTABLE");
    caído = false;
    const reloj = Date.now() + 10 * 60_000;
    await new Sincronizador(local, fuente, ventas().procesadores(), () => reloj).sincronizar(true);
    const final = (await local.operaciones())[0];
    assert.equal(final.estado, "CONFIRMADA");
    assert.equal(final.resultadoPedido?.estado, "CONFIRMADO");
    assert.equal(envíos.length, 2);
    assert.ok(envíos.every(envío => envío.clave === operación.claveIdempotencia), "Todos los reintentos usan la misma Idempotency-Key.");
    assert.ok(envíos.every(envío => !("carrito" in envío.cuerpo)), "La copia local del carrito no se envía a Ventas.");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}));

test("un pedido de otro titular no se envía con la sesión actual (navegador compartido)", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  await local.encolarPedido(crearPedido);
  let llamadas = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => { llamadas++; return new Response("{}", { status: 201 }); }) as typeof fetch;
  try {
    const otraSesión = { cabeceras: async () => ({ Authorization: "Bearer token-de-b" }), sub: async () => "titular-b" };
    await new Sincronizador(local, fuente, new VentasRest("/api/v1", otraSesión).procesadores()).sincronizar(true);
    const pendiente = (await local.operaciones())[0];
    assert.equal(pendiente.estado, "ERROR_REINTENTABLE");
    assert.match(pendiente.error ?? "", /pertenece a otra sesión/);
    assert.equal(llamadas, 0, "El pedido de A nunca se envía con el token de B.");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}));

test("un rechazo definitivo de Ventas queda en revisión con su mensaje", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  await local.encolarPedido(crearPedido);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ mensaje: "La variante no está disponible.", código: "VARIANTE_NO_DISPONIBLE" }), { status: 422 })) as typeof fetch;
  try {
    await new Sincronizador(local, fuente, ventas().procesadores()).sincronizar(true);
    const final = (await local.operaciones())[0];
    assert.equal(final.estado, "REQUIERE_REVISION");
    assert.equal(final.error, "La variante no está disponible.");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}));

test("actualizar un pedido solo reemplaza estados más antiguos", () => conBase(async (local) => {
  await local.agregarCarrito(línea);
  const operación = await local.encolarPedido(crearPedido);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ pedido: pedidoVenta(operación.identificador, "EN_REVISION", "2026-10-22T12:00:05Z") }), { status: 201 })) as typeof fetch;
  try {
    await new Sincronizador(local, fuente, ventas().procesadores()).sincronizar(true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  await local.actualizarPedido(operación.identificador, pedidoVenta(operación.identificador, "PENDIENTE", "2026-10-22T12:00:01Z"));
  assert.equal((await local.operaciones())[0].resultadoPedido?.estado, "EN_REVISION");
  // Java puede omitir o incluir fracciones de segundo: se comparan instantes, no texto.
  await local.actualizarPedido(operación.identificador, pedidoVenta(operación.identificador, "CONFIRMADO", "2026-10-22T12:00:05.250Z"));
  assert.equal((await local.operaciones())[0].resultadoPedido?.estado, "CONFIRMADO");
}));
