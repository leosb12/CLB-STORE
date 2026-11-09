import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorRemoto } from "../fuente/catalogo/dominio/modelos";
import { GestionRest } from "../fuente/gestion/adaptadores/gestion-rest";
import { compacto, formatoValor, marcasEje, minutosDesde } from "../fuente/gestion/dominio/modelos";

const conSesión = { cabeceras: async () => ({ Authorization: "Bearer token-de-prueba" }) };

function respondiendo(estado: number, cuerpo: unknown, registro: RequestInit[] = []): void {
  globalThis.fetch = (async (_url: string, opciones: RequestInit) => {
    registro.push(opciones);
    return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("el eje usa marcas limpias que cubren el máximo y etiquetas compactas", () => {
  assert.deepEqual(marcasEje(11), [0, 5, 10, 15]);
  assert.deepEqual(marcasEje(4), [0, 1, 2, 3, 4]);
  assert.deepEqual(marcasEje(10122), [0, 5000, 10000, 15000]);
  assert.deepEqual(marcasEje(0), [0, 1]);
  assert.equal(compacto(15000), "15 mil");
  assert.equal(formatoValor(1320, "Bs"), "Bs 1.320,00");
  assert.equal(formatoValor(42, ""), "42");
});

test("GraphQL: los errores llegan como error y los datos se desenvuelven; siempre con el token del admin", async () => {
  const registro: RequestInit[] = [];
  respondiendo(200, { data: { segmentosClientes: { clientes: 3, silueta: 0.6, datosAl: null, segmentos: [] } } }, registro);
  const rest = new GestionRest("/api/v1", conSesión);
  assert.equal((await rest.segmentos()).clientes, 3);
  assert.equal((registro[0].headers as Record<string, string>)["Authorization"], "Bearer token-de-prueba");
  respondiendo(200, { errors: [{ message: "limite debe estar entre 1 y 50." }] });
  await assert.rejects(rest.segmentos(), /limite debe estar/);
});

test("IA apagada: el mensaje aclara que catálogo y compras siguen funcionando; 429 conserva el mensaje del servidor", async () => {
  const rest = new GestionRest("/api/v1", conSesión);
  respondiendo(502, {});
  await assert.rejects(rest.mision("Monitorea mi negocio"), (error: ErrorRemoto) => error.estado === 502 && /compras siguen funcionando/.test(error.message));
  respondiendo(429, { mensaje: "Los agentes están atendiendo otra solicitud.", código: "OCUPADO" });
  await assert.rejects(rest.mision("Monitorea mi negocio"), /otra solicitud/);
});

test("solo se listan propuestas abiertas y sin sesión no se llama al servidor", async () => {
  respondiendo(200, { data: { propuestas: [{ estado: "PENDIENTE" }, { estado: "CONFIRMADA" }, { estado: "REQUIERE_REVISION" }] } });
  const abiertas = await new GestionRest("/api/v1", conSesión).propuestas();
  assert.deepEqual(abiertas.map(p => p.estado), ["PENDIENTE", "REQUIERE_REVISION"]);
  const registro: RequestInit[] = [];
  respondiendo(200, {}, registro);
  await assert.rejects(new GestionRest("/api/v1", { cabeceras: async () => ({}) }).historial(), (error: ErrorRemoto) => error.estado === 401);
  assert.equal(registro.length, 0);
});

test("R5: las acciones de gestión van por GraphQL y sus errores conservan el estado HTTP y el código", async () => {
  const registro: RequestInit[] = [];
  respondiendo(200, { data: { ejecutarMision: { mision: "Monitorea", agentes: [], generativa: false, fecha: "f" } } }, registro);
  const rest = new GestionRest("/api/v1", conSesión);
  assert.equal((await rest.mision("Monitorea")).mision, "Monitorea");
  const cuerpo = JSON.parse(registro[0].body as string);
  assert.match(cuerpo.query, /mutation\(\$m: String!\) \{ ejecutarMision/);
  assert.deepEqual(cuerpo.variables, { m: "Monitorea" });
  respondiendo(200, { data: null, errors: [{ message: "Los agentes están atendiendo otra solicitud.", extensions: { codigo: "OCUPADO", estado_http: 429 } }] });
  await assert.rejects(rest.mision("Monitorea"),
    (error: ErrorRemoto) => error.estado === 429 && error.detalles?.["código"] === "OCUPADO" && /otra solicitud/.test(error.message));
  respondiendo(200, { data: null, errors: [{ message: "Inválida", extensions: { codigo: "ESPECIFICACION_INVALIDA", estado_http: 422, errores: [{ msg: "x" }] } }] });
  await assert.rejects(rest.reporte({ peticion: "ventas" }), (error: ErrorRemoto) => error.estado === 422 && Array.isArray(error.detalles?.["errores"]));
});

test("R5: solo la transferencia de archivos usa REST (voz y Excel)", async () => {
  const registro: RequestInit[] = [];
  const urls: string[] = [];
  globalThis.fetch = (async (url: string, opciones: RequestInit) => {
    urls.push(url); registro.push(opciones);
    return new Response(JSON.stringify({ texto: "hola" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const rest = new GestionRest("/api/v1", conSesión);
  assert.equal(await rest.transcribir(new Blob(["a"])), "hola");
  await rest.excel("r-1");
  assert.deepEqual(urls, ["/api/v1/voz", "/api/v1/reportes/r-1/excel"]);
});

test("F4: el PDF se descarga por REST con el mismo identificador; una petición ambigua conserva sus sugerencias", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "Content-Type": "application/pdf" } });
  }) as typeof fetch;
  const rest = new GestionRest("/api/v1", conSesión);
  assert.equal((await rest.archivo("r-9", "pdf")).size, 4);
  assert.deepEqual(urls, ["/api/v1/reportes/r-9/pdf"]);
  respondiendo(200, { data: null, errors: [{ message: "No se entiende qué reporte necesitas.",
    extensions: { codigo: "AMBIGUA", estado_http: 422, sugerencias: ["Ventas por talla"] } }] });
  await assert.rejects(rest.reporte({ peticion: "hola" }), (error: ErrorRemoto) =>
    error.estado === 422 && error.detalles?.["código"] === "AMBIGUA" && (error.detalles?.["sugerencias"] as string[])[0] === "Ventas por talla");
});

test("F4: la antigüedad de los datos se mide en minutos y sin datos es nula", () => {
  const ahora = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(minutosDesde("2026-11-09T11:40:30Z", ahora), 19);
  assert.equal(minutosDesde(null, ahora), null);
  assert.equal(minutosDesde("no-es-fecha", ahora), null);
});
