import "reflect-metadata";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { crearClienteDynamoDB, RepositorioDynamoDB } from "../fuente/fidelizacion/datos/repositorio-dynamodb.js";
import { ServicioFidelizacion } from "../fuente/fidelizacion/negocio/servicio-fidelizacion.js";

// Integración real con DynamoDB Local: tabla temporal clb_prueba_* que se elimina al terminar.
const cliente = crearClienteDynamoDB();
const tabla = `clb_prueba_${randomBytes(6).toString("hex")}`;
const repositorio = new RepositorioDynamoDB(cliente, tabla);
const servicio = new ServicioFidelizacion(repositorio);

before(() => repositorio.asegurarTabla());
after(async () => {
  if (tabla.startsWith("clb_prueba_")) await cliente.send(new DeleteTableCommand({ TableName: tabla }));
  cliente.destroy();
});

test("acreditación y reversa persisten con saldo exacto", async () => {
  const [pedido, persona] = [randomUUID(), randomUUID()];
  await servicio.acreditar(randomUUID(), pedido, persona, 47_500);
  assert.equal((await repositorio.saldoYMovimientos(persona)).saldo, 47);
  await servicio.revertir(randomUUID(), pedido, persona);
  const estado = await repositorio.saldoYMovimientos(persona);
  assert.equal(estado.saldo, 0);
  assert.deepEqual(estado.movimientos.map(m => m.tipo), ["ACREDITACION", "REVERSA"]);
});

test("reintentos concurrentes del mismo pedido acreditan una sola vez", async () => {
  const [pedido, persona] = [randomUUID(), randomUUID()];
  const resultados = await Promise.all(Array.from({ length: 8 }, () => servicio.acreditar(randomUUID(), pedido, persona, 30_000)));
  assert.equal(new Set(resultados.map(r => r.fecha)).size, 1);
  assert.equal((await repositorio.saldoYMovimientos(persona)).saldo, 30);
});

test("la consulta por cliente usa el índice y el pedido es único en el sistema", async () => {
  const [pedido, dueño, otro] = [randomUUID(), randomUUID(), randomUUID()];
  await servicio.acreditar(randomUUID(), pedido, dueño, 12_000);
  await assert.rejects(servicio.revertir(randomUUID(), pedido, otro));
  const { movimientos } = await repositorio.saldoYMovimientos(dueño);
  assert.deepEqual(movimientos.map(m => [m.tipo, m.identificador_pedido]), [["ACREDITACION", pedido]]);
});

test("acreditación y compensación en carrera terminan consistentes", async () => {
  for (let ronda = 0; ronda < 5; ronda++) {
    const [pedido, persona] = [randomUUID(), randomUUID()];
    await Promise.allSettled([servicio.acreditar(randomUUID(), pedido, persona, 20_000), servicio.revertir(randomUUID(), pedido, persona)]);
    const { saldo, movimientos } = await repositorio.saldoYMovimientos(persona);
    // Cualquiera haya llegado primero, la reversa existe y el saldo neto es cero.
    assert.equal(saldo, 0);
    assert.ok(movimientos.some(m => m.tipo === "REVERSA"));
  }
});

test("perfiles: versión optimista real en DynamoDB", async () => {
  const { RepositorioPerfilesDynamoDB } = await import("../fuente/perfiles/datos/repositorio-perfiles.js");
  const perfiles = new RepositorioPerfilesDynamoDB(cliente, tabla);
  const titular = randomUUID();
  const perfil = { identificador_cliente: titular, nombre: "Ana", teléfono: null, medidas: { altura_cm: 165 }, versión: 1, fecha_actualización: new Date().toISOString() };
  assert.equal(await perfiles.guardar(perfil, 0), true);
  assert.equal(await perfiles.guardar({ ...perfil, nombre: "Otro" }, 0), false, "No se crea dos veces.");
  assert.equal(await perfiles.guardar({ ...perfil, nombre: "Ana María", versión: 2 }, 1), true);
  assert.equal(await perfiles.guardar({ ...perfil, nombre: "Pisada", versión: 2 }, 1), false, "Una versión vieja no pisa la nueva.");
  assert.equal((await perfiles.perfil(titular))?.nombre, "Ana María");
});
