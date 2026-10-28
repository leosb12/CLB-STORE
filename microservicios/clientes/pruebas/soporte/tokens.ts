import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { VerificadorTokens } from "../../fuente/comun/autenticacion.js";
import type { Perfil, RepositorioPerfiles } from "../../fuente/perfiles/datos/repositorio-perfiles.js";

export const EMISOR = "http://127.0.0.1:18000/identidad/realms/clb";

/** Emisor de tokens de prueba: firma RS256 con una llave propia y expone un verificador con su JWKS local. */
export async function emisorDePrueba() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "prueba", alg: "RS256" };
  const verificador = new VerificadorTokens(createLocalJWKSet({ keys: [jwk] }), EMISOR);
  const firmar = (sub: string, roles: string[], opciones: { emisor?: string; audiencia?: string; vence?: string } = {}) =>
    new SignJWT({ realm_access: { roles } }).setProtectedHeader({ alg: "RS256", kid: "prueba" }).setSubject(sub)
      .setIssuer(opciones.emisor ?? EMISOR).setAudience(opciones.audiencia ?? "clb-api").setIssuedAt()
      .setExpirationTime(opciones.vence ?? "5m").sign(privateKey);
  return { verificador, firmar };
}

export class RepositorioPerfilesEnMemoria implements RepositorioPerfiles {
  readonly perfiles = new Map<string, Perfil>();
  async perfil(cliente: string) { return this.perfiles.get(cliente) ?? null; }
  async guardar(perfil: Perfil, versiónEsperada: number) {
    if ((this.perfiles.get(perfil.identificador_cliente)?.versión ?? 0) !== versiónEsperada) return false;
    this.perfiles.set(perfil.identificador_cliente, perfil);
    return true;
  }
}
