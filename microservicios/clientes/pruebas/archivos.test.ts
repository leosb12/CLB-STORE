import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { crearAplicacion } from "../fuente/aplicacion.js";
import { ServicioArchivos, nombreLegible, type Archivo, type RegistroArchivos, type AlmacenArchivos } from "../fuente/archivos/negocio.js";
import { RepositorioEnMemoria } from "./soporte/repositorio-en-memoria.js";
import { emisorDePrueba, RepositorioPerfilesEnMemoria } from "./soporte/tokens.js";

const registros = new Map<string, Archivo>();
const registro: RegistroArchivos = {
  async obtener(id) { return registros.get(id) ?? null; },
  async crear(a) { if (!registros.has(a.identificador)) registros.set(a.identificador, a); },
  async estado(id, estado) { registros.set(id, { ...registros.get(id)!, estado }); },
  async listar(titular) { return { archivos: [...registros.values()].filter(a => a.titular === titular) }; },
};
let completo = false;
let borrados = 0;
const almacen: AlmacenArchivos = {
  async subida() { return { url: "https://s3.example/subida", cabeceras: { "if-none-match": "*" } }; },
  async comprobar() { if (!completo) throw new Error("subida interrumpida"); },
  async descarga() { return "https://s3.example/descarga"; },
  async borrar() { borrados++; },
};
const servicio = new ServicioArchivos(registro, almacen, "clb-pruebas");
const persona = { sub: randomUUID(), roles: ["cliente" as const] };
const otro = { sub: randomUUID(), roles: ["cliente" as const] };
const admin = { sub: randomUUID(), roles: ["admin" as const] };
const datos = { tipo: "foto-probador" as const, descripcion: "Persona con camiseta negra frontal", mime: "image/png", bytes: 100,
  sha256: "a".repeat(64), origen: "android" as const };

test("rutas legibles: dos carpetas, milisegundos UTC y sufijo corto; IDs rechazados", async () => {
  const { archivo } = await servicio.preparar(randomUUID(), datos, persona);
  assert.match(archivo.objeto, /^PROBADOR-VIRTUAL\/FOTOS-ORIGINALES\/persona-con-camiseta-negra-frontal_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}_UTC_[a-z]{6}\.png$/);
  for (const descripcion of [randomUUID(), "producto " + "ab".repeat(32), "foto 123456789"])
    assert.throws(() => nombreLegible(descripcion, new Date().toISOString(), "png"));
});
test("respuesta incierta reutiliza ruta; cambio de contenido con la misma clave da conflicto", async () => {
  const id = randomUUID();
  const primero = await servicio.preparar(id, datos, persona);
  assert.equal((await servicio.preparar(id, datos, persona)).archivo.ruta_s3, primero.archivo.ruta_s3);
  const reordenado = { sha256: datos.sha256, bytes: datos.bytes, origen: datos.origen, mime: datos.mime, descripcion: datos.descripcion, tipo: datos.tipo };
  assert.equal((await servicio.preparar(id, reordenado, persona)).archivo.ruta_s3, primero.archivo.ruta_s3);
  await assert.rejects(servicio.preparar(id, { ...datos, bytes: 99 }, persona), { status: 409 });
  await assert.rejects(servicio.preparar(id, datos, otro), { status: 409 });
});
test("privacidad, subida incompleta y borrado repetible sin resucitar el registro", async () => {
  const id = randomUUID();
  await servicio.preparar(id, datos, persona);
  await assert.rejects(servicio.descargar(id, persona), { status: 409 });
  await assert.rejects(servicio.confirmar(id, persona));
  assert.equal(registros.get(id)?.estado, "PENDIENTE");
  completo = true;
  await servicio.confirmar(id, persona);
  await assert.rejects(servicio.descargar(id, otro), { status: 404 });
  assert.ok((await servicio.descargar(id, persona)).url.startsWith("https:"));
  await servicio.borrar(id, persona);
  await servicio.borrar(id, persona);
  assert.equal(borrados, 2);
  await assert.rejects(servicio.confirmar(id, persona), { status: 409 });
  await assert.rejects(servicio.preparar(id, datos, persona), { status: 409 });
});
test("cliente no puede subir productos ni reportes y un administrador sí", async () => {
  await assert.rejects(servicio.preparar(randomUUID(), { ...datos, tipo: "producto" }, persona), { status: 403 });
  await assert.rejects(servicio.preparar(randomUUID(), { ...datos, tipo: "reporte-pdf" }, admin), { status: 422 });
  assert.ok((await servicio.preparar(randomUUID(), { ...datos, tipo: "producto" }, admin)).subida);
  const excel = await servicio.preparar(randomUUID(), { ...datos, tipo: "comprobante-excel",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, admin);
  assert.match(excel.archivo.objeto, /^COMPROBANTES\/EXCEL\/.+\.xlsx$/);
});

let app: INestApplication;
let base: string;
let token: string;
let tokenSinRol: string;
before(async () => {
  const emisor = await emisorDePrueba();
  token = await emisor.firmar(persona.sub, ["cliente"]);
  tokenSinRol = await emisor.firmar(persona.sub, []);
  app = await crearAplicacion(new RepositorioEnMemoria(), new RepositorioPerfilesEnMemoria(), emisor.verificador, undefined, servicio);
  await app.listen(0, "127.0.0.1"); base = await app.getUrl();
});
after(() => app.close());
test("HTTP rechaza anonimato, UUID ausente, tamaño excesivo y campos adicionales", async () => {
  const subir = (cuerpo: unknown, autenticar = true, clave: string = randomUUID()) => fetch(base + "/api/v1/archivos/subidas", {
    method: "POST", headers: { "content-type": "application/json", ...(autenticar ? { authorization: `Bearer ${token}` } : {}), "idempotency-key": clave }, body: JSON.stringify(cuerpo) });
  assert.equal((await subir(datos, false)).status, 401);
  assert.equal((await fetch(base + "/api/v1/archivos", { headers: { authorization: `Bearer ${tokenSinRol}` } })).status, 403);
  assert.equal((await subir(datos, true, "incorrecta")).status, 422);
  assert.equal((await subir({ ...datos, bytes: 999999999 })).status, 422);
  assert.equal((await subir({ ...datos, titular: otro.sub })).status, 422);
  assert.equal((await subir(datos)).status, 201);
});
