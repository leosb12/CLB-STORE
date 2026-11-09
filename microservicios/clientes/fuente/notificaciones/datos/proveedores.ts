import { importPKCS8, SignJWT } from "jose";

/** Resultado de un intento: aceptado, rechazo transitorio (reintentar), definitivo o token del dispositivo inválido. */
export type ResultadoEnvio = { ok: true } | { ok: false; tipo: "transitorio" | "definitivo" | "token_invalido"; codigo: string };

export interface Mensaje { titulo: string; cuerpo: string; datos: Record<string, string>; clave: string }

export interface ProveedorPush { enviar(token: string, mensaje: Mensaje): Promise<ResultadoEnvio> }
export interface ProveedorCorreo { enviar(correo: string, mensaje: Mensaje): Promise<ResultadoEnvio> }

export const PROVEEDOR_PUSH = Symbol("ProveedorPush");
export const PROVEEDOR_CORREO = Symbol("ProveedorCorreo");

const PLAZO_MS = 10_000; // menor que el reclamo (120 s): un envío colgado nunca se solapa con su reintento

function porEstado(estado: number): ResultadoEnvio {
  if (estado >= 200 && estado < 300) return { ok: true };
  return { ok: false, tipo: estado === 429 || estado >= 500 ? "transitorio" : "definitivo", codigo: `HTTP_${estado}` };
}

/** Sin configuración (p. ej. un compañero sin claves): el canal queda registrado como fallido, nunca bloquea nada. */
export const sinConfigurar: ProveedorPush & ProveedorCorreo = {
  enviar: async () => ({ ok: false, tipo: "definitivo", codigo: "NO_CONFIGURADO" }),
};

/** Correo transaccional con la API HTTPS de Resend; la Idempotency-Key evita duplicados del lado del proveedor (24 h). */
export class CorreoResend implements ProveedorCorreo {
  constructor(private readonly clave: string, private readonly remitente: string, private readonly http: typeof fetch = fetch) {}

  async enviar(correo: string, mensaje: Mensaje): Promise<ResultadoEnvio> {
    try {
      const respuesta = await this.http("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(PLAZO_MS),
        headers: { Authorization: `Bearer ${this.clave}`, "Content-Type": "application/json", "Idempotency-Key": mensaje.clave },
        body: JSON.stringify({ from: this.remitente, to: [correo], subject: mensaje.titulo, text: mensaje.cuerpo }),
      });
      return porEstado(respuesta.status);
    } catch {
      return { ok: false, tipo: "transitorio", codigo: "RED" };
    }
  }
}

export interface CuentaServicio { project_id: string; client_email: string; private_key: string }

/** FCM HTTP v1 con la cuenta de servicio (JWT RS256 → token OAuth en caché ~50 min). */
export class PushFcm implements ProveedorPush {
  private acceso: { token: string; vence: number } | null = null;

  constructor(private readonly cuenta: CuentaServicio, private readonly http: typeof fetch = fetch, private readonly reloj = () => Date.now()) {}

  private async tokenAcceso(): Promise<string> {
    if (this.acceso && this.reloj() < this.acceso.vence) return this.acceso.token;
    const llave = await importPKCS8(this.cuenta.private_key, "RS256");
    const asercion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(this.cuenta.client_email).setSubject(this.cuenta.client_email)
      .setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("1h").sign(llave);
    const respuesta = await this.http("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(PLAZO_MS), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: asercion }),
    });
    if (!respuesta.ok) throw new Error(`OAUTH_${respuesta.status}`);
    const datos = await respuesta.json() as { access_token: string; expires_in?: number };
    this.acceso = { token: datos.access_token, vence: this.reloj() + Math.max(60, (datos.expires_in ?? 3600) - 600) * 1000 };
    return this.acceso.token;
  }

  async enviar(token: string, mensaje: Mensaje): Promise<ResultadoEnvio> {
    let acceso: string;
    try {
      acceso = await this.tokenAcceso();
    } catch (error) {
      const codigo = error instanceof Error && error.message.startsWith("OAUTH_") ? error.message : "RED";
      return { ok: false, tipo: codigo === "OAUTH_400" || codigo === "OAUTH_401" ? "definitivo" : "transitorio", codigo };
    }
    try {
      const respuesta = await this.http(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.cuenta.project_id)}/messages:send`, {
        method: "POST", signal: AbortSignal.timeout(PLAZO_MS),
        headers: { Authorization: `Bearer ${acceso}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token, notification: { title: mensaje.titulo, body: mensaje.cuerpo }, data: mensaje.datos,
          // Un duplicado tras una caída reemplaza la notificación visible en vez de apilarse; caduca en 1 h.
          android: { ttl: "3600s", collapse_key: mensaje.clave, notification: { tag: mensaje.clave } },
        } }),
      });
      if (respuesta.ok) return { ok: true };
      const cuerpo = await respuesta.json().catch(() => ({})) as { error?: { status?: string; details?: { errorCode?: string }[] } };
      const codigos = [cuerpo.error?.status, ...(cuerpo.error?.details ?? []).map(d => d.errorCode)];
      if (respuesta.status === 404 || codigos.includes("UNREGISTERED") || (respuesta.status === 400 && codigos.includes("INVALID_ARGUMENT")))
        return { ok: false, tipo: "token_invalido", codigo: "UNREGISTERED" };
      if (respuesta.status === 401) this.acceso = null;
      return porEstado(respuesta.status);
    } catch {
      return { ok: false, tipo: "transitorio", codigo: "RED" };
    }
  }
}

/** Cuenta de servicio desde el entorno: JSON en Base64 (preferido) o los tres campos sueltos. */
export function cuentaDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): CuentaServicio | null {
  if (entorno["CLB_FIREBASE_SERVICE_ACCOUNT_BASE64"]) {
    const json = JSON.parse(Buffer.from(entorno["CLB_FIREBASE_SERVICE_ACCOUNT_BASE64"], "base64").toString("utf8")) as CuentaServicio;
    return { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key };
  }
  const [proyecto, correo, llave] = ["CLB_FIREBASE_PROJECT_ID", "CLB_FIREBASE_CLIENT_EMAIL", "CLB_FIREBASE_PRIVATE_KEY"].map(n => entorno[n]);
  return proyecto && correo && llave ? { project_id: proyecto, client_email: correo, private_key: llave.replace(/\\n/g, "\n") } : null;
}
