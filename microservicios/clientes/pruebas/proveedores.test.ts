import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { CorreoResend, PushFcm, cuentaDesdeEntorno } from "../fuente/notificaciones/datos/proveedores.js";

// Sin red: un fetch falso registra cada petición y responde lo indicado.
function falso(respuestas: Response[]) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return respuestas.shift() ?? new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { http, llamadas };
}
const mensaje = { titulo: "CLB Store · Pedido #ABC confirmado", cuerpo: "Tu pedido…", datos: { destino: "pedidos", pedido: "p" }, clave: "ventas:9:push" };
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cuenta = { project_id: "clb-prueba", client_email: "fcm@clb-prueba.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

test("Resend: Idempotency-Key por evento y destinatario", async () => {
  const { http, llamadas } = falso([new Response("{}", { status: 200 })]);
  const correo = new CorreoResend("re_prueba", "CLB Store <avisos@clb.ejemplo>", http);
  assert.deepEqual(await correo.enviar("a@b.bo", { ...mensaje, clave: "ventas:9:correo" }), { ok: true });
  assert.equal((llamadas[0]!.init.headers as Record<string, string>)["Idempotency-Key"], "ventas:9:correo");
  assert.deepEqual(JSON.parse(String(llamadas[0]!.init.body)).to, ["a@b.bo"]);
});

test("Resend: 429/5xx transitorio, 4xx definitivo, sin red transitorio", async () => {
  const { http } = falso([new Response("{}", { status: 429 }), new Response("{}", { status: 503 }), new Response("{}", { status: 422 })]);
  const correo = new CorreoResend("re_prueba", "avisos@clb.ejemplo", http);
  assert.deepEqual(await correo.enviar("a@b.bo", mensaje), { ok: false, tipo: "transitorio", codigo: "HTTP_429" });
  assert.deepEqual(await correo.enviar("a@b.bo", mensaje), { ok: false, tipo: "transitorio", codigo: "HTTP_503" });
  assert.deepEqual(await correo.enviar("a@b.bo", mensaje), { ok: false, tipo: "definitivo", codigo: "HTTP_422" });
  const sinRed = new CorreoResend("re_prueba", "avisos@clb.ejemplo", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
  assert.deepEqual(await sinRed.enviar("a@b.bo", mensaje), { ok: false, tipo: "transitorio", codigo: "RED" });
});

test("FCM v1: OAuth con la cuenta de servicio en caché, mensaje con tag/collapse_key y token inválido", async () => {
  const oauth = () => new Response(JSON.stringify({ access_token: "ya29.prueba", expires_in: 3600 }), { status: 200 });
  const { http, llamadas } = falso([oauth(), new Response("{}", { status: 200 }),
    new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 }),
    new Response("{}", { status: 503 })]);
  const push = new PushFcm(cuenta, http);
  assert.deepEqual(await push.enviar("token-1", mensaje), { ok: true });
  assert.equal(llamadas[0]!.url, "https://oauth2.googleapis.com/token");
  const asercion = new URLSearchParams(String(llamadas[0]!.init.body)).get("assertion")!;
  const carga = JSON.parse(Buffer.from(asercion.split(".")[1]!, "base64url").toString());
  assert.equal(carga.iss, cuenta.client_email);
  assert.equal(carga.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(llamadas[1]!.url, "https://fcm.googleapis.com/v1/projects/clb-prueba/messages:send");
  const enviado = JSON.parse(String(llamadas[1]!.init.body)).message;
  assert.deepEqual(enviado.android, { ttl: "3600s", collapse_key: "ventas:9:push", notification: { tag: "ventas:9:push" } });
  assert.deepEqual(enviado.data, { destino: "pedidos", pedido: "p" });
  assert.deepEqual(await push.enviar("token-2", mensaje), { ok: false, tipo: "token_invalido", codigo: "UNREGISTERED" });
  assert.deepEqual(await push.enviar("token-3", mensaje), { ok: false, tipo: "transitorio", codigo: "HTTP_503" });
  assert.equal(llamadas.filter(l => l.url.includes("oauth2")).length, 1, "el token OAuth se reutiliza");
});

test("cuenta de servicio desde el entorno (Base64 o campos sueltos)", () => {
  const base64 = Buffer.from(JSON.stringify({ ...cuenta, type: "service_account" })).toString("base64");
  assert.equal(cuentaDesdeEntorno({ CLB_FIREBASE_SERVICE_ACCOUNT_BASE64: base64 })?.client_email, cuenta.client_email);
  assert.equal(cuentaDesdeEntorno({ CLB_FIREBASE_PROJECT_ID: "p", CLB_FIREBASE_CLIENT_EMAIL: "c", CLB_FIREBASE_PRIVATE_KEY: "a\\nb" })?.private_key, "a\nb");
  assert.equal(cuentaDesdeEntorno({}), null);
});
