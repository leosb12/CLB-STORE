import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorRemoto } from "../fuente/catalogo/dominio/modelos";
import { GestionRest } from "../fuente/gestion/adaptadores/gestion-rest";
import { VentasRest } from "../fuente/pedidos/adaptadores/ventas-rest";

const conSesión = { cabeceras: async () => ({ Authorization: "Bearer token-de-prueba" }), sub: async () => "titular" };
const llamadas: { url: string; opciones: RequestInit }[] = [];

function respondiendo(estado: number, cuerpo: BodyInit, tipo = "application/json"): void {
  llamadas.length = 0;
  globalThis.fetch = (async (url: string, opciones: RequestInit) => {
    llamadas.push({ url, opciones });
    return new Response(cuerpo, { status: estado, headers: { "Content-Type": tipo } });
  }) as typeof fetch;
}

test("alertas de n8n: se listan solo las nuevas y se atienden con el token del admin", async () => {
  const rest = new GestionRest("/api/v1", conSesión);
  respondiendo(200, JSON.stringify({ data: { notificaciones: [{ evento: "e-1", sku: "CLB-M" }] } }));
  assert.equal((await rest.notificaciones())[0].evento, "e-1");
  assert.equal(llamadas[0].url, "/api/v1/graphql");
  assert.match(JSON.parse(llamadas[0].opciones.body as string).query, /notificaciones\(estado: NUEVA\)/);
  respondiendo(200, JSON.stringify({ data: { atenderNotificacion: { evento: "e-1", estado: "ATENDIDA" } } }));
  assert.equal((await rest.atender("e-1")).estado, "ATENDIDA");
  assert.equal(llamadas[0].url, "/api/v1/graphql");
  assert.deepEqual(JSON.parse(llamadas[0].opciones.body as string).variables, { e: "e-1" });
  assert.equal(llamadas[0].opciones.method, "POST");
  assert.equal((llamadas[0].opciones.headers as Record<string, string>)["Authorization"], "Bearer token-de-prueba");
});

test("comprobante: se descarga como archivo; si aún se genera, llega el mensaje de Ventas", async () => {
  const ventas = new VentasRest("/api/v1", conSesión);
  respondiendo(200, new Uint8Array([0x50, 0x4b, 3, 4]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const archivo = await ventas.comprobante("p-1");
  assert.equal(archivo.size, 4);
  assert.equal(llamadas[0].url, "/api/v1/pedidos/p-1/comprobante");
  respondiendo(404, JSON.stringify({ mensaje: "El comprobante de este pedido todavía se está generando.", código: "COMPROBANTE_NO_DISPONIBLE" }));
  await assert.rejects(ventas.comprobante("p-1"), (error: ErrorRemoto) => error.estado === 404 && /se está generando/.test(error.message));
  const sinSesión = new VentasRest("/api/v1", { cabeceras: async () => ({}), sub: async () => null });
  await assert.rejects(sinSesión.comprobante("p-1"), (error: ErrorRemoto) => error.estado === 401);
});
