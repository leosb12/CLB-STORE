import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorRemoto } from "../fuente/catalogo/dominio/modelos";
import { GestionRest } from "../fuente/gestion/adaptadores/gestion-rest";
import { compacto, formatoValor, marcasEje } from "../fuente/gestion/dominio/modelos";

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
  assert.equal(formatoValor(1320, "Bs"), "1.320,00 Bs");
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
  respondiendo(200, { propuestas: [{ estado: "PENDIENTE" }, { estado: "CONFIRMADA" }, { estado: "REQUIERE_REVISION" }] });
  const abiertas = await new GestionRest("/api/v1", conSesión).propuestas();
  assert.deepEqual(abiertas.map(p => p.estado), ["PENDIENTE", "REQUIERE_REVISION"]);
  const registro: RequestInit[] = [];
  respondiendo(200, {}, registro);
  await assert.rejects(new GestionRest("/api/v1", { cabeceras: async () => ({}) }).historial(), (error: ErrorRemoto) => error.estado === 401);
  assert.equal(registro.length, 0);
});
