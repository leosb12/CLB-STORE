import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import type { INestApplication } from "@nestjs/common";
import { crearAplicacion } from "../fuente/aplicacion.js";
import { crearClienteDynamoDB, RepositorioDynamoDB } from "../fuente/fidelizacion/datos/repositorio-dynamodb.js";
import type { Mensaje, ProveedorCorreo, ProveedorPush, ResultadoEnvio } from "../fuente/notificaciones/datos/proveedores.js";
import { RepositorioNotificacionesDynamoDB, type Envio } from "../fuente/notificaciones/datos/repositorio-notificaciones.js";
import { MAXIMO_INTENTOS, ServicioNotificaciones, type EventoPedido } from "../fuente/notificaciones/negocio/servicio-notificaciones.js";
import { RepositorioEnMemoria } from "./soporte/repositorio-en-memoria.js";
import { emisorDePrueba, RepositorioPerfilesEnMemoria } from "./soporte/tokens.js";

// DynamoDB Local real (escrituras condicionales y transacciones de verdad): tabla temporal clb_prueba_* que se borra.
const dynamodb = crearClienteDynamoDB();
const tabla = `clb_prueba_${randomBytes(6).toString("hex")}`;
const repositorio = new RepositorioNotificacionesDynamoDB(dynamodb, tabla);

class Proveedor implements ProveedorPush, ProveedorCorreo {
  readonly envios: { destino: string; mensaje: Mensaje }[] = [];
  respuestas: ResultadoEnvio[] = [];
  async enviar(destino: string, mensaje: Mensaje): Promise<ResultadoEnvio> {
    this.envios.push({ destino, mensaje });
    return this.respuestas.shift() ?? { ok: true };
  }
}

let ahora = new Date("2026-11-09T12:00:00Z");
const reloj = () => ahora;
const avanzar = (minutos: number) => { ahora = new Date(ahora.getTime() + minutos * 60_000); };

function nuevo() {
  const push = new Proveedor(), correo = new Proveedor();
  return { push, correo, servicio: new ServicioNotificaciones(repositorio, push, correo, reloj) };
}
const secreto = () => randomBytes(32).toString("base64url");
const evento = (cliente: string): EventoPedido => ({ evento: `ventas:${Date.now()}${Math.floor(Math.random() * 1e6)}`, tipo: "pedido_confirmado", cliente, pedido: randomUUID() });
const estados = async (e: EventoPedido) => Object.fromEntries((await repositorio.envios(e.evento)).map((f: Envio) => [f.canal, f.estado]));

before(() => new RepositorioDynamoDB(dynamodb, tabla).asegurarTabla());
after(async () => {
  if (tabla.startsWith("clb_prueba_")) await dynamodb.send(new DeleteTableCommand({ TableName: tabla }));
  dynamodb.destroy();
});

test("preferencias: canal desactivado se omite; sin dispositivo solo correo; repetir el registro no crea filas", async () => {
  const { servicio, correo, push } = nuevo();
  const cliente = randomUUID();
  await servicio.registrarContacto(cliente, "cliente@ejemplo.bo");
  const e = evento(cliente);
  assert.deepEqual(await servicio.registrar([e]), { registrados: 1, repetidos: 0 });
  assert.deepEqual(await servicio.registrar([e]), { registrados: 0, repetidos: 1 });
  assert.deepEqual(await estados(e), { CORREO: "PENDIENTE", PUSH: "OMITIDO_SIN_DESTINO" });
  await servicio.procesar(50);
  assert.equal((await estados(e))["CORREO"], "ENVIADO");
  assert.equal(correo.envios[0]!.destino, "cliente@ejemplo.bo");
  assert.equal(correo.envios[0]!.mensaje.clave, `${e.evento}:correo`);
  assert.equal(push.envios.length, 0);

  await servicio.guardarPreferencias(cliente, { push: true, correo: false }, 0);
  const e2 = evento(cliente);
  await servicio.registrar([e2]);
  assert.equal((await estados(e2))["CORREO"], "OMITIDO_PREFERENCIA");
  await assert.rejects(servicio.guardarPreferencias(cliente, { push: false, correo: false }, 0), { status: 409 });
});

test("preferencias: la misma Idempotency-Key tras una respuesta perdida devuelve lo guardado; con otro cuerpo se rechaza", async () => {
  const { servicio } = nuevo();
  const cliente = randomUUID(), clave = randomUUID();
  const primera = await servicio.guardarPreferencias(cliente, { push: false, correo: true }, 0, clave);
  assert.deepEqual(primera, { push: false, correo: true, versión: 1 });
  assert.deepEqual(await servicio.guardarPreferencias(cliente, { push: false, correo: true }, 0, clave), primera);
  await assert.rejects(servicio.guardarPreferencias(cliente, { push: true, correo: true }, 0, clave),
    (e: { status: number; response: { código: string } }) => e.status === 409 && e.response.código === "CONFLICTO_IDEMPOTENCIA");
  await assert.rejects(servicio.guardarPreferencias(cliente, { push: true, correo: true }, 0, randomUUID()),
    (e: { response: { código: string } }) => e.response.código === "CONFLICTO_VERSION");
  assert.deepEqual(await repositorio.preferencias(cliente), primera);
});

test("push caído y correo bien: canales independientes, reintento con espera y una sola entrega por canal", async () => {
  const { servicio, correo, push } = nuevo();
  const cliente = randomUUID(), instalacion = randomUUID();
  await servicio.registrarContacto(cliente, "c@ejemplo.bo");
  await servicio.vincular(cliente, instalacion, `token-${randomUUID()}`, secreto());
  const e = evento(cliente);
  await servicio.registrar([e]);
  push.respuestas = [{ ok: false, tipo: "transitorio", codigo: "HTTP_503" }];
  await servicio.procesar(50);
  assert.deepEqual(await estados(e), { CORREO: "ENVIADO", [`PUSH#${instalacion}`]: "REINTENTAR" });
  await servicio.procesar(50); // antes de la espera de 1 min: no se reintenta
  assert.equal(push.envios.length, 1);
  avanzar(1);
  await servicio.procesar(50);
  assert.equal((await estados(e))[`PUSH#${instalacion}`], "ENVIADO");
  assert.equal(push.envios.length, 2);
  assert.equal(correo.envios.length, 1);
});

test("dos dispositivos con un fallo: solo se reintenta el que falló; token inválido borra la instalación", async () => {
  const { servicio, push } = nuevo();
  const cliente = randomUUID(), [a, b] = [randomUUID(), randomUUID()];
  await servicio.vincular(cliente, a, `token-a-${randomUUID()}`, secreto());
  await servicio.vincular(cliente, b, `token-b-${randomUUID()}`, secreto());
  const e = evento(cliente);
  await servicio.registrar([e]);
  push.respuestas = [{ ok: true }, { ok: false, tipo: "token_invalido", codigo: "UNREGISTERED" }];
  await servicio.procesar(50);
  const filas = await estados(e);
  assert.deepEqual(Object.values(filas).filter(v => v !== "OMITIDO_SIN_DESTINO").sort(), ["ENVIADO", "OMITIDO_TOKEN_INVALIDO"]);
  const invalida = Object.entries(filas).find(([, v]) => v === "OMITIDO_TOKEN_INVALIDO")![0].slice(5);
  assert.equal(await repositorio.instalacion(invalida), null);
  assert.equal((await repositorio.dispositivos(cliente)).length, 1);
  avanzar(30);
  await servicio.procesar(50);
  assert.equal(push.envios.length, 2);
});

test("límite de intentos y rechazo definitivo", async () => {
  const { servicio, correo } = nuevo();
  const [c1, c2] = [randomUUID(), randomUUID()];
  await servicio.registrarContacto(c1, "a@ejemplo.bo");
  await servicio.registrarContacto(c2, "b@ejemplo.bo");
  const [e1, e2] = [evento(c1), evento(c2)];
  await servicio.registrar([e1]);
  correo.respuestas = Array.from({ length: MAXIMO_INTENTOS }, () => ({ ok: false, tipo: "transitorio", codigo: "HTTP_500" }) as ResultadoEnvio);
  for (let i = 0; i < MAXIMO_INTENTOS; i++) { await servicio.procesar(50); avanzar(20); }
  assert.equal((await estados(e1))["CORREO"], "FALLIDO_DEFINITIVO");
  assert.equal(correo.envios.length, MAXIMO_INTENTOS);
  await servicio.registrar([e2]);
  correo.respuestas = [{ ok: false, tipo: "definitivo", codigo: "HTTP_422" }];
  await servicio.procesar(50);
  assert.equal((await estados(e2))["CORREO"], "FALLIDO_DEFINITIVO");
});

test("procesadores concurrentes: cada fila se reclama una sola vez", async () => {
  const { servicio: uno, correo } = nuevo();
  const dos = new ServicioNotificaciones(repositorio, new Proveedor(), correo, reloj);
  const eventos = await Promise.all(Array.from({ length: 4 }, async () => {
    const cliente = randomUUID();
    await uno.registrarContacto(cliente, `${cliente}@ejemplo.bo`);
    return evento(cliente);
  }));
  await uno.registrar(eventos);
  avanzar(60);
  await Promise.all([uno.procesar(50), dos.procesar(50)]);
  const destinos = correo.envios.filter(e => eventos.some(ev => e.mensaje.clave === `${ev.evento}:correo`)).map(e => e.destino);
  assert.equal(destinos.length, 4);
  assert.equal(new Set(destinos).size, 4);
});

test("caída tras aceptar el proveedor: el reclamo vence y el reintento reutiliza la misma clave idempotente", async () => {
  const { servicio, correo } = nuevo();
  const cliente = randomUUID();
  await servicio.registrarContacto(cliente, "caida@ejemplo.bo");
  const e = evento(cliente);
  await servicio.registrar([e]);
  const [fila] = await repositorio.envios(e.evento);
  // Simula un procesador que reclamó, envió y cayó antes de guardar el resultado.
  assert.ok(await repositorio.reclamar(fila!, "procesador-caido", new Date(ahora.getTime() + 120_000).toISOString(), ahora.toISOString()));
  await servicio.procesar(50);
  assert.equal(correo.envios.length, 0, "con el reclamo vigente nadie más envía");
  avanzar(3);
  await servicio.procesar(50);
  assert.equal((await estados(e))["CORREO"], "ENVIADO");
  assert.equal(correo.envios[0]!.mensaje.clave, `${e.evento}:correo`);
  assert.equal((await repositorio.envios(e.evento)).find(f => f.canal === "CORREO")!.intentos, 2);
});

test("vínculo: misma instalación pasa a otra cuenta con su secreto; nunca se envía a la cuenta anterior; token único", async () => {
  const { servicio, push } = nuevo();
  const [a, b, instalacion] = [randomUUID(), randomUUID(), randomUUID()];
  const llave = secreto(), token = `token-${randomUUID()}`;
  await servicio.vincular(a, instalacion, token, llave);
  const e = evento(a);
  await servicio.registrar([e]);
  await assert.rejects(servicio.vincular(b, instalacion, token, secreto()), { status: 403 });
  await servicio.vincular(b, instalacion, token, llave); // logout de A y login de B en el mismo teléfono
  assert.deepEqual((await repositorio.dispositivos(a)).length, 0);
  assert.equal((await repositorio.dispositivos(b))[0]!.instalacion, instalacion);
  await servicio.procesar(50);
  assert.equal(push.envios.length, 0);
  assert.equal((await estados(e))[`PUSH#${instalacion}`], "OMITIDO_SIN_DESTINO");
  const otra = randomUUID();
  await servicio.vincular(b, otra, token, secreto()); // reinstalación con el mismo token: el vínculo viejo desaparece
  assert.equal(await repositorio.instalacion(instalacion), null);
  await assert.rejects(servicio.desvincular(otra, secreto()), { status: 403 }); // sin su secreto no se desvincula
});

test("correo fuera de la ventana de 24 h del proveedor no se reintenta", async () => {
  const { servicio, correo } = nuevo();
  const cliente = randomUUID();
  await servicio.registrarContacto(cliente, "tarde@ejemplo.bo");
  const e = evento(cliente);
  await servicio.registrar([e]);
  correo.respuestas = [{ ok: false, tipo: "transitorio", codigo: "HTTP_503" }];
  await servicio.procesar(50);
  avanzar(24 * 60);
  await servicio.procesar(50);
  const fila = (await repositorio.envios(e.evento)).find(f => f.canal === "CORREO")!;
  assert.equal(fila.estado, "FALLIDO_DEFINITIVO");
  assert.equal(fila.codigo_error, "VENCIDO");
  assert.equal(correo.envios.length, 1);
});

test("HTTP: titular, desvinculación sin sesión y rutas internas solo para servicio", async () => {
  const emisor = await emisorDePrueba();
  const aplicación: INestApplication = await crearAplicacion(new RepositorioEnMemoria(), new RepositorioPerfilesEnMemoria(), emisor.verificador,
    { repositorio, push: new Proveedor(), correo: new Proveedor(), reloj });
  await aplicación.listen(0, "127.0.0.1");
  const base = await aplicación.getUrl();
  try {
    const sub = randomUUID(), instalacion = randomUUID(), llave = secreto();
    const cliente = await emisor.firmar(sub, ["cliente"], { correo: "titular@ejemplo.bo" });
    const pedir = (ruta: string, init: RequestInit = {}, token: string | null = cliente) => fetch(base + ruta, { ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as object) } });
    const prefs = await (await pedir("/api/v1/perfiles/yo/notificaciones")).json();
    assert.deepEqual(prefs.preferencias, { push: true, correo: true, versión: 0, correo_disponible: true });
    assert.equal(await repositorio.contacto(sub), "titular@ejemplo.bo");
    assert.equal((await pedir("/api/v1/perfiles/yo/notificaciones", { method: "PUT", body: JSON.stringify({ push: false, correo: true, versión: 0, correo_destino: "x@y.z" }) })).status, 422);
    const guardadas = await (await pedir("/api/v1/perfiles/yo/notificaciones", { method: "PUT", headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ push: true, correo: false, versión: 0 }) })).json();
    assert.deepEqual(guardadas.preferencias, { push: true, correo: false, versión: 1, correo_disponible: true });
    assert.equal((await pedir("/api/v1/perfiles/yo/notificaciones", { method: "PUT", headers: { "idempotency-key": "no-uuid" },
      body: JSON.stringify({ push: true, correo: false, versión: 1 }) })).status, 422);
    assert.equal((await pedir(`/api/v1/perfiles/yo/dispositivos/${instalacion}`, { method: "PUT", body: JSON.stringify({ token: `token-${randomUUID()}`, secreto: llave }) })).status, 204);
    assert.equal((await pedir(`/api/v1/dispositivos/${instalacion}`, { method: "DELETE" }, null)).status, 401);
    assert.equal((await pedir(`/api/v1/dispositivos/${instalacion}`, { method: "DELETE", headers: { "x-clb-instalacion-secreto": secreto() } }, null)).status, 403);
    assert.equal((await pedir(`/api/v1/dispositivos/${instalacion}`, { method: "DELETE", headers: { "x-clb-instalacion-secreto": llave } }, null)).status, 204);
    assert.equal((await pedir(`/api/v1/dispositivos/${instalacion}`, { method: "DELETE", headers: { "x-clb-instalacion-secreto": llave } }, null)).status, 204);
    assert.equal(await repositorio.instalacion(instalacion), null);
    const lote = { eventos: [{ evento: "ventas:1", tipo: "pedido_confirmado", cliente: sub, pedido: randomUUID() }] };
    assert.equal((await pedir("/api/v1/interno/notificaciones/registrar", { method: "POST", body: JSON.stringify(lote) })).status, 403);
    const servicio = await emisor.firmar(randomUUID(), ["servicio"]);
    assert.equal((await pedir("/api/v1/interno/notificaciones/registrar", { method: "POST", body: JSON.stringify(lote) }, servicio)).status, 202);
    assert.equal((await pedir("/api/v1/interno/notificaciones/registrar", { method: "POST", body: JSON.stringify({ eventos: [{ ...lote.eventos[0], evento: "otro" }] }) }, servicio)).status, 422);
    const procesado = await (await pedir("/api/v1/interno/notificaciones/procesar?limite=5", { method: "POST" }, servicio)).json();
    assert.ok(procesado.resultado);
  } finally {
    await aplicación.close();
  }
});

test("nombres para reportes: perfil editado > nombre de cuenta del token > sin nombre (DynamoDB real)", async () => {
  const { RepositorioPerfilesDynamoDB } = await import("../fuente/perfiles/datos/repositorio-perfiles.js");
  const perfiles = new RepositorioPerfilesDynamoDB(dynamodb, tabla);
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  await perfiles.guardar({ identificador_cliente: a, nombre: "Ana Perfil", teléfono: null, medidas: {}, versión: 1, fecha_actualización: "" }, 0);
  const { servicio } = nuevo();
  await servicio.registrarContacto(a, undefined, "Ana Cuenta");
  await servicio.registrarContacto(b, undefined, "Beto Cuenta");
  assert.deepEqual(await perfiles.nombres([a, b, c]), [
    { cliente: a, nombre: "Ana Perfil", origen: "PERFIL" },
    { cliente: b, nombre: "Beto Cuenta", origen: "CUENTA" },
    { cliente: c, nombre: null, origen: null },
  ]);
});

test("HTTP: el claim name se registra al consultar avisos; el contrato de nombres es solo para servicios", async () => {
  const emisor = await emisorDePrueba();
  const perfilesMemoria = new RepositorioPerfilesEnMemoria();
  const aplicación: INestApplication = await crearAplicacion(new RepositorioEnMemoria(), perfilesMemoria, emisor.verificador,
    { repositorio, push: new Proveedor(), correo: new Proveedor(), reloj });
  await aplicación.listen(0, "127.0.0.1");
  const base = await aplicación.getUrl();
  try {
    const sub = randomUUID();
    const pedir = async (ruta: string, token: string, init: RequestInit = {}) => fetch(base + ruta, { ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
    const titular = await emisor.firmar(sub, ["cliente"], { nombre: "Carla <b>Compradora</b>" });
    assert.equal((await pedir("/api/v1/perfiles/yo/notificaciones", titular)).status, 200);
    assert.equal(await repositorio.nombreCuenta(sub), "Carla bCompradora/b");
    perfilesMemoria.perfiles.set(sub, { identificador_cliente: sub, nombre: "Carla P.", teléfono: null, medidas: {}, versión: 1, fecha_actualización: "" });
    const servicio = await emisor.firmar(randomUUID(), ["servicio"]);
    const nombres = (cuerpo: unknown, token: string) => pedir("/api/v1/interno/clientes/nombres", token, { method: "POST", body: JSON.stringify(cuerpo) });
    const ok = await nombres({ clientes: [sub] }, servicio);
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).clientes, [{ cliente: sub, nombre: "Carla P.", origen: "PERFIL" }]);
    assert.equal((await nombres({ clientes: [sub] }, titular)).status, 403);
    assert.equal((await nombres({ clientes: ["no-uuid"] }, servicio)).status, 422);
    assert.equal((await nombres({ clientes: [] }, servicio)).status, 422);
  } finally {
    await aplicación.close();
  }
});
