import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorRemoto } from "../fuente/catalogo/dominio/modelos";
import { GestionRest } from "../fuente/gestion/adaptadores/gestion-rest";
import { formatoCelda, procedenciaDe, salidaDe, type EspecificacionV2 } from "../fuente/gestion/dominio/reportes-v2";

const conSesión = { cabeceras: async () => ({ Authorization: "Bearer token-de-prueba" }) };
const base: EspecificacionV2 = {
  version: 2, titulo: "Ventas", fuente: "VENTAS", tipo: "DETALLE", columnas: ["CLIENTE", "SUBTOTAL"], filtros: [],
  periodo: "ESTA_SEMANA", orden: [], limite: 200, grafico: { tipo: "NINGUNO" }, formatos: [],
};

test("formato boliviano: dinero desde centavos, fechas dd/mm/aaaa y sí/no", () => {
  assert.equal(formatoCelda(123450, "DINERO"), "Bs 1.234,50");
  assert.equal(formatoCelda(5, "DINERO"), "Bs 0,05");
  assert.equal(formatoCelda("2026-11-09", "FECHA"), "09/11/2026");
  assert.equal(formatoCelda(true, "BOOLEANO"), "Sí");
  assert.equal(formatoCelda(null, "ENTERO"), "—");
  assert.equal(formatoCelda(1500, "ENTERO"), "1.500");
});

test("salida pedida: solo PDF no muestra la tabla ni ofrece Excel; sin formato se muestra y se ofrecen ambos", () => {
  assert.deepEqual(salidaDe({ ...base, formatos: ["PDF"] }), { pantalla: false, archivos: ["PDF"], pedidos: true });
  assert.deepEqual(salidaDe({ ...base, formatos: ["EXCEL"] }), { pantalla: false, archivos: ["EXCEL"], pedidos: true });
  assert.deepEqual(salidaDe({ ...base, formatos: ["PDF", "EXCEL"] }), { pantalla: false, archivos: ["PDF", "EXCEL"], pedidos: true });
  assert.deepEqual(salidaDe({ ...base, formatos: ["PANTALLA"] }), { pantalla: true, archivos: ["PDF", "EXCEL"], pedidos: false });
  assert.deepEqual(salidaDe({ ...base, formatos: ["PANTALLA", "PDF"] }), { pantalla: true, archivos: ["PDF"], pedidos: true });
  assert.deepEqual(salidaDe(base), { pantalla: true, archivos: ["PDF", "EXCEL"], pedidos: false });
});

test("procedencia veraz, también para el historial sin el campo", () => {
  assert.equal(procedenciaDe({ procedencia: "REGLAS", generativa: false, observacion: "x" }), "REGLAS");
  assert.equal(procedenciaDe({ generativa: true, observacion: null }), "MODELO");
  assert.equal(procedenciaDe({ generativa: false, observacion: "Especificación editada por el usuario." }), "MANUAL");
  assert.equal(procedenciaDe({ generativa: false, observacion: "Modelo de lenguaje no disponible" }), "REGLAS");
});

test("la elección de formato viaja por GraphQL y «no disponible» llega con sus motivos", async () => {
  const cuerpos: string[] = [];
  globalThis.fetch = (async (_url: string, opciones: RequestInit) => {
    cuerpos.push(String(opciones.body));
    return new Response(JSON.stringify({ errors: [{ message: "No se registra el costo.", extensions: {
      codigo: "NO_DISPONIBLE", estado_http: 422, motivos: ["No se registra el costo de las prendas."] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const rest = new GestionRest("/api/v1", conSesión);
  await assert.rejects(rest.reporte({ peticion: "margen por producto", formatos: ["PDF"] }), (error: ErrorRemoto) =>
    error.estado === 422 && error.detalles?.["código"] === "NO_DISPONIBLE" && Array.isArray(error.detalles?.["motivos"]));
  const enviado = JSON.parse(cuerpos[0]);
  assert.deepEqual(enviado.variables.f, ["PDF"]);
  assert.match(enviado.query, /formatos: \$f/);
  assert.match(enviado.query, /procedencia/);
});
