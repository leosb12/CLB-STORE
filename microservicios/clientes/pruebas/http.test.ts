import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { crearAplicacion } from "../fuente/aplicacion.js";
import { RepositorioEnMemoria } from "./soporte/repositorio-en-memoria.js";
import { emisorDePrueba, RepositorioPerfilesEnMemoria } from "./soporte/tokens.js";

const repositorio = new RepositorioEnMemoria();
let aplicación: INestApplication;
let base: string;
let firmar: Awaited<ReturnType<typeof emisorDePrueba>>["firmar"];
let servicio: string;

before(async () => {
  const emisor = await emisorDePrueba();
  firmar = emisor.firmar;
  servicio = await firmar(randomUUID(), ["servicio"]);
  aplicación = await crearAplicacion(repositorio, new RepositorioPerfilesEnMemoria(), emisor.verificador);
  await aplicación.listen(0, "127.0.0.1");
  base = await aplicación.getUrl();
});
after(() => aplicación.close());

const enviar = (ruta: string, cuerpo: unknown, opciones: { token?: string | null; clave?: string | null; método?: string } = {}) =>
  fetch(`${base}${ruta}`, {
    method: opciones.método ?? "POST",
    headers: { "content-type": "application/json",
      ...(opciones.token === null ? {} : { authorization: `Bearer ${opciones.token ?? servicio}` }),
      ...(opciones.clave === null ? {} : { "idempotency-key": opciones.clave ?? randomUUID() }) },
    body: JSON.stringify(cuerpo),
  });
const leer = (ruta: string, token: string) => fetch(`${base}${ruta}`, { headers: { authorization: `Bearer ${token}` } });

test("acreditación, repetición, reversa y consulta con token de servicio", async () => {
  const [pedido, cliente, clave] = [randomUUID(), randomUUID(), randomUUID()];
  const cuerpo = { identificador_pedido: pedido, identificador_cliente: cliente, total_centavos: 25_000 };
  const primera = await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { clave });
  assert.equal(primera.status, 201);
  const movimiento = await primera.json();
  assert.equal(movimiento.movimiento.puntos, 25);
  assert.deepEqual(await (await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { clave })).json(), movimiento);
  assert.equal((await enviar("/api/v1/interno/fidelizacion/acreditaciones", { ...cuerpo, total_centavos: 1 }, { clave })).status, 409);
  assert.equal((await enviar("/api/v1/interno/fidelizacion/reversas", { identificador_pedido: pedido, identificador_cliente: cliente })).status, 201);
  const consulta = await (await leer(`/api/v1/fidelizacion/clientes/${cliente}`, await firmar(cliente, ["cliente"]))).json();
  assert.equal(consulta.saldo, 0);
  assert.deepEqual(consulta.movimientos.map((m: { tipo: string }) => m.tipo), ["ACREDITACION", "REVERSA"]);
});

test("sin token 401; un cliente no puede acreditar puntos (403)", async () => {
  const cuerpo = { identificador_pedido: randomUUID(), identificador_cliente: randomUUID(), total_centavos: 1000 };
  const sinToken = await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { token: null });
  assert.equal(sinToken.status, 401);
  assert.equal((await sinToken.json()).código, "NO_AUTENTICADO");
  const cliente = await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { token: await firmar(randomUUID(), ["cliente"]) });
  assert.equal(cliente.status, 403);
  assert.equal((await cliente.json()).código, "ACCESO_DENEGADO");
});

test("tokens de otro emisor, otra audiencia o vencidos se rechazan", async () => {
  const cuerpo = { identificador_pedido: randomUUID(), identificador_cliente: randomUUID(), total_centavos: 1000 };
  for (const token of [await firmar(randomUUID(), ["servicio"], { emisor: "http://atacante/realms/clb" }),
    await firmar(randomUUID(), ["servicio"], { audiencia: "otra-api" }),
    await firmar(randomUUID(), ["servicio"], { vence: "-1m" }),
    await firmar(randomUUID(), ["servicio"], { sinExpiracion: true }), "no-es-un-jwt"]) {
    assert.equal((await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { token })).status, 401);
  }
});

test("cada cliente ve solo sus puntos; un administrador puede ver cualquiera", async () => {
  const [dueño, otro] = [randomUUID(), randomUUID()];
  assert.equal((await leer(`/api/v1/fidelizacion/clientes/${dueño}`, await firmar(otro, ["cliente"]))).status, 403);
  assert.equal((await leer(`/api/v1/fidelizacion/clientes/${dueño}`, await firmar(dueño, ["cliente"]))).status, 200);
  assert.equal((await leer(`/api/v1/fidelizacion/clientes/${dueño}`, await firmar(otro, ["admin"]))).status, 200);
  // La ruta interna (comprobante de n8n) es solo para servicios, ni siquiera para el propio cliente.
  assert.equal((await fetch(`${base}/api/v1/interno/fidelizacion/clientes/${dueño}`)).status, 401);
  assert.equal((await leer(`/api/v1/interno/fidelizacion/clientes/${dueño}`, await firmar(dueño, ["cliente"]))).status, 403);
  const interna = await leer(`/api/v1/interno/fidelizacion/clientes/${dueño}`, await firmar(otro, ["servicio"]));
  assert.equal(interna.status, 200);
  assert.equal((await interna.json()).identificador_cliente, dueño);
});

test("M05: la ruta interna lee la acreditación del pedido por su clave (consistente) y solo la del propio cliente", async () => {
  const [cliente, otro, pedido] = [randomUUID(), randomUUID(), randomUUID()];
  const acreditada = await enviar("/api/v1/interno/fidelizacion/acreditaciones", { identificador_pedido: pedido, identificador_cliente: cliente, total_centavos: 25000 });
  assert.ok(acreditada.ok, String(acreditada.status));
  const propio = await (await leer(`/api/v1/interno/fidelizacion/clientes/${cliente}?pedido=${pedido}`, servicio)).json();
  assert.equal(propio.pedido.acreditación.puntos, 25);
  assert.equal(propio.pedido.reversa, null);
  const ajeno = await (await leer(`/api/v1/interno/fidelizacion/clientes/${otro}?pedido=${pedido}`, servicio)).json();
  assert.equal(ajeno.pedido.acreditación, null);
  assert.equal((await leer(`/api/v1/interno/fidelizacion/clientes/${cliente}?pedido=no-es-uuid`, servicio)).status, 422);
});

test("perfil propio: lectura inicial vacía, edición con versión y conflicto entre dispositivos", async () => {
  const cliente = randomUUID();
  const token = await firmar(cliente, ["cliente"]);
  assert.equal((await (await leer("/api/v1/perfiles/yo", token)).json()).perfil.versión, 0);
  const datos = { nombre: "Ana Pérez", teléfono: "+591 70000000", medidas: { altura_cm: 165, pecho_cm: 88 }, versión_esperada: 0 };
  const editado = await enviar("/api/v1/perfiles/yo", datos, { token, clave: null, método: "PUT" });
  assert.equal(editado.status, 200);
  assert.equal((await editado.json()).perfil.versión, 1);
  const conflicto = await enviar("/api/v1/perfiles/yo", { ...datos, nombre: "Otra" }, { token, clave: null, método: "PUT" });
  assert.equal(conflicto.status, 409);
  const cuerpo = await conflicto.json();
  assert.equal(cuerpo.código, "CONFLICTO_VERSION");
  assert.equal(cuerpo.perfil_actual.nombre, "Ana Pérez");
  const inválido = await enviar("/api/v1/perfiles/yo", { ...datos, medidas: { altura_cm: 20 }, versión_esperada: 1 }, { token, clave: null, método: "PUT" });
  assert.equal(inválido.status, 422);
  // El titular es siempre el del token: otro cliente ve su propio perfil vacío.
  assert.equal((await (await leer("/api/v1/perfiles/yo", await firmar(randomUUID(), ["cliente"]))).json()).perfil.nombre, "");
});

test("valida datos, clave y campos no admitidos con 422 en español", async () => {
  const válido = { identificador_pedido: randomUUID(), identificador_cliente: randomUUID(), total_centavos: 100 };
  for (const [cuerpo, clave] of [[{ ...válido, total_centavos: 1.5 }, randomUUID()], [{ ...válido, identificador_pedido: "x" }, randomUUID()],
    [{ ...válido, extra: true }, randomUUID()], [válido, null], [válido, "no-uuid"]] as const) {
    const respuesta = await enviar("/api/v1/interno/fidelizacion/acreditaciones", cuerpo, { clave });
    assert.equal(respuesta.status, 422);
    assert.match((await respuesta.json()).mensaje, /no son válidos|UUID v4/);
  }
  const ruta = await fetch(`${base}/no-existe`);
  assert.equal(ruta.status, 404);
  assert.deepEqual(await ruta.json(), { mensaje: "La ruta solicitada no existe.", código: "NO_ENCONTRADO" });
});

test("salud no requiere token y refleja la dependencia", async () => {
  assert.deepEqual(await (await fetch(`${base}/salud`)).json(), { estado: "ACTIVO", servicio: "clientes", dependencias: { dynamodb: "ACTIVO" } });
  repositorio.activo = false;
  assert.equal((await fetch(`${base}/salud`)).status, 503);
  repositorio.activo = true;
});
