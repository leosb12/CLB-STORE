import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ErrorDeFidelizacion, ServicioFidelizacion, puntosPorTotal } from "../fuente/fidelizacion/negocio/servicio-fidelizacion.js";
import { RepositorioEnMemoria } from "./soporte/repositorio-en-memoria.js";

const preparar = () => { const repositorio = new RepositorioEnMemoria(); return { repositorio, servicio: new ServicioFidelizacion(repositorio) }; };

test("1 punto por cada 10 Bs completos", () => {
  assert.equal(puntosPorTotal(0), 0);
  assert.equal(puntosPorTotal(999), 0);
  assert.equal(puntosPorTotal(1000), 1);
  assert.equal(puntosPorTotal(25_990), 25);
});

test("acreditar es idempotente por clave y por pedido", async () => {
  const { servicio, repositorio } = preparar();
  const [pedido, cliente, clave] = [randomUUID(), randomUUID(), randomUUID()];
  const primera = await servicio.acreditar(clave, pedido, cliente, 35_000);
  assert.deepEqual(await servicio.acreditar(clave, pedido, cliente, 35_000), primera);
  // Respuesta perdida y reintento con otra clave: no duplica puntos.
  assert.deepEqual(await servicio.acreditar(randomUUID(), pedido, cliente, 35_000), primera);
  assert.equal((await repositorio.saldoYMovimientos(cliente)).saldo, 35);
});

test("la misma clave con otra solicitud se rechaza sin aplicar cambios", async () => {
  const { servicio, repositorio } = preparar();
  const [cliente, clave] = [randomUUID(), randomUUID()];
  await servicio.acreditar(clave, randomUUID(), cliente, 10_000);
  await assert.rejects(servicio.acreditar(clave, randomUUID(), cliente, 10_000), (error: ErrorDeFidelizacion) => error.código === "CONFLICTO_IDEMPOTENCIA");
  assert.equal((await repositorio.saldoYMovimientos(cliente)).saldo, 10);
});

test("la reversa descuenta los puntos una sola vez", async () => {
  const { servicio, repositorio } = preparar();
  const [pedido, cliente, clave] = [randomUUID(), randomUUID(), randomUUID()];
  await servicio.acreditar(randomUUID(), pedido, cliente, 50_000);
  const reversa = await servicio.revertir(clave, pedido, cliente);
  assert.equal(reversa.puntos, 50);
  assert.deepEqual(await servicio.revertir(clave, pedido, cliente), reversa);
  assert.deepEqual(await servicio.revertir(randomUUID(), pedido, cliente), reversa);
  assert.equal((await repositorio.saldoYMovimientos(cliente)).saldo, 0);
});

test("una reversa previa bloquea la acreditación tardía (compensación de la SAGA)", async () => {
  const { servicio, repositorio } = preparar();
  const [pedido, cliente] = [randomUUID(), randomUUID()];
  const reversa = await servicio.revertir(randomUUID(), pedido, cliente);
  assert.equal(reversa.puntos, 0);
  await assert.rejects(servicio.acreditar(randomUUID(), pedido, cliente, 90_000), (error: ErrorDeFidelizacion) => error.código === "PEDIDO_REVERTIDO" && error.estado === 409);
  assert.equal((await repositorio.saldoYMovimientos(cliente)).saldo, 0);
});

test("el pedido es único en el sistema: otro cliente no puede acreditarlo ni revertirlo", async () => {
  const { servicio, repositorio } = preparar();
  const [pedido, dueño, otro] = [randomUUID(), randomUUID(), randomUUID()];
  await servicio.acreditar(randomUUID(), pedido, dueño, 50_000);
  await assert.rejects(servicio.acreditar(randomUUID(), pedido, otro, 50_000), (error: ErrorDeFidelizacion) => error.código === "CONFLICTO_ACREDITACION");
  await assert.rejects(servicio.revertir(randomUUID(), pedido, otro), (error: ErrorDeFidelizacion) => error.código === "CONFLICTO_CLIENTE");
  assert.equal((await repositorio.saldoYMovimientos(dueño)).saldo, 50);
  assert.equal((await repositorio.saldoYMovimientos(otro)).saldo, 0);
});

test("una clave nueva que reutiliza un resultado queda registrada y responde igual después", async () => {
  const { servicio } = preparar();
  const [pedido, cliente, nueva] = [randomUUID(), randomUUID(), randomUUID()];
  const original = await servicio.acreditar(randomUUID(), pedido, cliente, 20_000);
  assert.deepEqual(await servicio.acreditar(nueva, pedido, cliente, 20_000), original);
  await servicio.revertir(randomUUID(), pedido, cliente);
  // Sin registrar la clave, este reintento respondería 409 PEDIDO_REVERTIDO.
  assert.deepEqual(await servicio.acreditar(nueva, pedido, cliente, 20_000), original);
  await assert.rejects(servicio.acreditar(nueva, randomUUID(), cliente, 20_000), (error: ErrorDeFidelizacion) => error.código === "CONFLICTO_IDEMPOTENCIA");
});

test("otro total para un pedido ya acreditado es un conflicto", async () => {
  const { servicio } = preparar();
  const [pedido, cliente] = [randomUUID(), randomUUID()];
  await servicio.acreditar(randomUUID(), pedido, cliente, 10_000);
  await assert.rejects(servicio.acreditar(randomUUID(), pedido, cliente, 20_000), (error: ErrorDeFidelizacion) => error.código === "CONFLICTO_ACREDITACION");
});
