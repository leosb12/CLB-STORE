import "fake-indexeddb/auto";
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RepositorioLocal} from "../fuente/catalogo/adaptadores/repositorio-local";
import {descargarTextura} from "../fuente/catalogo/adaptadores/descargar-textura";
import {validarRecurso} from "../fuente/catalogo/dominio/recurso-probador";
import {Sincronizador} from "../fuente/catalogo/aplicacion/sincronizador";
import type {Producto} from "../fuente/catalogo/dominio/modelos";

const fixture = JSON.parse(readFileSync(new URL("../../../compartido/prendas/fixtures/ajuste-fotografico.json",import.meta.url),"utf8"));
const producto: Producto = {identificador: "a".repeat(32),sku: "CLB-PRUEBA",nombre: "Polera",descripción: "",categoría: "Poleras",precio: "99.00",moneda: "BOB",activo: true,fecha_creación: "2026-10-23T00:00:00Z",fecha_actualización: "2026-10-23T00:00:00Z",versión_sincronización: 2,recurso_probador: fixture.recurso};

test('recursos generativos: tres categorías sin anclas; dimensiones incorrectas se rechazan', () => {
  for (const tipo of ['superior','inferior','completo']) {
    const recurso = {...fixture.recurso, esquema: 2, tipo, ancho: 768, alto: 1024};
    delete recurso.anclas;
    assert.doesNotThrow(() => validarRecurso(recurso));
    assert.throws(() => validarRecurso({...recurso, ancho: 512}), /768/);
  }
});

test("textura publicada: verifica bytes, hash y dimensiones antes de persistir",async () => {
  const solicitar: typeof fetch = async () => new Response(Buffer.from(fixture.png_base64,"base64"),{headers: {"Content-Type":"image/png"}});
  const t = await descargarTextura(fixture.recurso,solicitar,"/api/v1");
  assert.equal(t.sha256,fixture.recurso.sha256);
  const alterada = {...fixture.recurso,sha256:"b".repeat(64),ruta:`/api/v1/recursos-probador/${"b".repeat(64)}.png`};
  await assert.rejects(descargarTextura(alterada,solicitar,"/api/v1"),/corrupta/);
  await assert.rejects(descargarTextura({...fixture.recurso,bytes:30},solicitar,"/api/v1"),/tamaño/);
});

test("catálogo y textura sobreviven al cierre; generación incompleta conserva la anterior",async () => {
  const nombre = crypto.randomUUID();
  const local = new RepositorioLocal(nombre);
  const blob = new Blob([Buffer.from(fixture.png_base64,"base64")],{type:"image/png"});
  await local.guardarCatalogo([producto],[{sha256: fixture.recurso.sha256,blob}]);
  await local.cerrar();
  const otra = new RepositorioLocal(nombre);
  assert.equal((await otra.texturas())[0]?.blob.size,fixture.recurso.bytes);
  await assert.rejects(otra.guardarCatalogo([{...producto,nombre:"No debe activarse"}]),/incompleto/);
  assert.equal((await otra.productos())[0]?.nombre,"Polera");
  await otra.cerrar();
});

test("corte de descarga no reemplaza catálogo ni operaciones pendientes",async () => {
  const local = new RepositorioLocal(crypto.randomUUID());
  await local.guardarCatalogo([{...producto,recurso_probador:undefined}]);
  await local.alternarFavorito(producto.identificador);
  const motor = new Sincronizador(local,{disponible:async()=>true,descargar:async()=>[producto],consultar:async()=>producto,
    descargarRecursos:async()=>{throw new Error("corte de red");}});
  assert.equal((await motor.sincronizar(true)).actualizado,false);
  assert.equal((await local.productos())[0]?.recurso_probador,undefined);
  assert.equal((await local.operaciones()).length,1);
  await local.cerrar();
});

test("manifiesto rechaza rutas ajenas, NaN y anclas invertidas",() => {
  assert.throws(()=>validarRecurso({...fixture.recurso,ruta:"https://externo/foto.png"}));
  assert.throws(()=>validarRecurso({...fixture.recurso,anclas:{...fixture.recurso.anclas,arriba:NaN}}));
  assert.throws(()=>validarRecurso({...fixture.recurso,anclas:{...fixture.recurso.anclas,izquierda:.9}}));
  for(const zonas of ['incorrecto',[[0,0,NaN,1]],[[.6,.1,.2,.7]],Array(17).fill([.1,.2,.7,.8])])
    assert.throws(()=>validarRecurso({...fixture.recurso,anclas:{...fixture.recurso.anclas,estampados:zonas}}));
  const preparado={...fixture.recurso,anclas:{...fixture.recurso.anclas,estampados:[[.3,.2,.7,.5]]}};
  validarRecurso(preparado);
});

test("modelo 3D: la espalda se valida y un paquete sin ella no reemplaza al anterior (la RA debe funcionar sin red)",async () => {
  const espalda = {sha256: "c".repeat(64), bytes: 900, ruta: `/api/v1/recursos-probador/${"c".repeat(64)}.png`};
  const generativo = {...fixture.recurso, esquema: 2, tipo: "superior", ancho: 768, alto: 1024, modelo3d: {version: 1}, espalda,
    calidad: {nivel: "apta", puntuacion: 100, comprobaciones: []}};
  delete generativo.anclas;
  assert.doesNotThrow(() => validarRecurso(generativo));
  assert.throws(() => validarRecurso({...generativo, espalda: {...espalda, ruta: "/otra/ruta.png"}}), /espalda/);
  assert.throws(() => validarRecurso({...generativo, modelo3d: undefined}), /espalda/);
  assert.throws(() => validarRecurso({...generativo, calidad: {nivel: "perfecta"}}), /calidad/);
  const local = new RepositorioLocal(crypto.randomUUID());
  const blob = new Blob([Buffer.from(fixture.png_base64,"base64")],{type:"image/png"});
  const conModelo = {...producto, recurso_probador: generativo};
  // Solo la textura frontal: el paquete está incompleto y no se activa.
  await assert.rejects(local.guardarCatalogo([conModelo],[{sha256: fixture.recurso.sha256,blob}]),/incompleto/);
  await local.guardarCatalogo([conModelo],[{sha256: fixture.recurso.sha256,blob},{sha256: espalda.sha256,blob}]);
  assert.equal((await local.texturas()).length,2);
  await local.cerrar();
});
