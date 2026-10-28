import { test } from "node:test";
import assert from "node:assert/strict";
import { conjuntoInicial, elegir, opciones, prendasDe, quitar } from "../fuente/dominio/conjunto";

const p = (identificador: string, categoría: string) => ({ identificador, sku: identificador, nombre: identificador, categoría, imagen: `/${identificador}.svg`, tallas: [] });
const polera = p("polera", "Poleras"), jean = p("jean", "Pantalones"), vestido = p("vestido", "Vestidos"), camisa = p("camisa", "Camisas");

test("conjunto: arriba y abajo a la vez; se dibujan primero los de abajo", () => {
  const c = elegir(conjuntoInicial(polera), jean);
  assert.deepEqual(prendasDe(c).map((x) => x.identificador), ["jean", "polera"]);
  assert.equal(elegir(c, camisa).superior?.identificador, "camisa", "la nueva prenda de arriba reemplaza a la anterior");
  assert.equal(elegir(c, camisa).inferior?.identificador, "jean");
});

test("conjunto: el vestido ocupa las dos zonas y una prenda de abajo lo desplaza", () => {
  const conVestido = elegir(elegir(conjuntoInicial(polera), jean), vestido);
  assert.deepEqual(prendasDe(conVestido).map((x) => x.identificador), ["vestido"]);
  assert.deepEqual(prendasDe(elegir(conVestido, jean)).map((x) => x.identificador), ["jean"]);
  assert.deepEqual(prendasDe(quitar(elegir(conjuntoInicial(polera), jean), "superior")).map((x) => x.identificador), ["jean"]);
  assert.deepEqual(conjuntoInicial(null), {});
});

test("opciones: la prenda inicial primero y sin repetidos", () => {
  assert.deepEqual(opciones(jean, [polera, jean, vestido]).map((x) => x.identificador), ["jean", "polera", "vestido"]);
});
