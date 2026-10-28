import { InjectionToken } from "@angular/core";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { Titular } from "../dominio/modelos";

export const SESION = new InjectionToken<SesionOidc>("CLB sesión OIDC");

export interface ConfiguracionIdentidad {
  autoridad: string;
  cliente: string;
}

// Un cierre de sesión sin red no alcanza a Keycloak: el próximo inicio exige credenciales (prompt=login).
const FORZAR_CREDENCIALES = "clb_forzar_credenciales";
// Margen para no adjuntar un token que vence en tránsito.
const MARGEN_SEGUNDOS = 30;

/**
 * SSO con Keycloak: Authorization Code + PKCE (cliente público clb-web). La sesión se guarda en localStorage para que una
 * sesión ya validada permita leer los datos locales sin conexión; nunca se inicia una sesión nueva sin red.
 */
export class SesionOidc {
  private readonly gestor: UserManager;

  constructor(configuración: ConfiguracionIdentidad, origen = location.origin) {
    this.gestor = new UserManager({
      authority: configuración.autoridad, client_id: configuración.cliente, response_type: "code", scope: "openid profile email",
      redirect_uri: `${origen}/sesion/retorno`, post_logout_redirect_uri: `${origen}/catalogo`,
      userStore: new WebStorageStateStore({ store: localStorage }), automaticSilentRenew: false, loadUserInfo: false,
    });
  }

  async titular(): Promise<Titular | null> {
    const usuario = await this.gestor.getUser();
    return usuario ? titularDe(usuario) : null;
  }

  iniciar(retorno: string): Promise<void> {
    const forzar = localStorage.getItem(FORZAR_CREDENCIALES) === "1";
    return this.gestor.signinRedirect({ state: { retorno }, ...(forzar ? { prompt: "login" } : {}) });
  }

  /** Notifica cada vez que la sesión cambia (inicio, cierre o pérdida al fallar la renovación). */
  alCambiar(oyente: () => void): void {
    this.gestor.events.addUserLoaded(oyente);
    this.gestor.events.addUserUnloaded(oyente);
  }

  async completar(): Promise<string> {
    const usuario = await this.gestor.signinRedirectCallback();
    localStorage.removeItem(FORZAR_CREDENCIALES);
    const retorno = (usuario.state as { retorno?: string } | undefined)?.retorno;
    // Solo rutas internas: el retorno nunca redirige a otro sitio.
    return retorno?.startsWith("/") && !retorno.startsWith("//") ? retorno : "/catalogo";
  }

  async cerrar(): Promise<void> {
    if (navigator.onLine) return this.gestor.signoutRedirect();
    localStorage.setItem(FORZAR_CREDENCIALES, "1");
    await this.gestor.removeUser();
  }

  /** Token de acceso vigente; si venció y hay red, se renueva con el refresh token. Sin sesión válida devuelve null. */
  async token(): Promise<string | null> {
    let usuario = await this.gestor.getUser();
    if (!usuario) return null;
    if ((usuario.expires_in ?? 0) < MARGEN_SEGUNDOS) {
      if (!navigator.onLine) return null;
      try {
        usuario = await this.gestor.signinSilent();
      } catch {
        // Refresh token vencido o revocado: la sesión ya no sirve; se limpia para pedir un inicio nuevo.
        await this.gestor.removeUser();
        return null;
      }
    }
    return usuario?.access_token ?? null;
  }

  async sub(): Promise<string | null> {
    return (await this.gestor.getUser())?.profile.sub ?? null;
  }

  /** Contrato CredencialesAdministrativas: cabecera Authorization para los adaptadores REST. */
  async cabeceras(): Promise<Record<string, string>> {
    const token = await this.token();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}

function titularDe(usuario: User): Titular {
  const roles = (usuario.profile["realm_access"] as { roles?: unknown } | undefined)?.roles;
  return {
    sub: usuario.profile.sub,
    nombre: usuario.profile.name ?? usuario.profile.preferred_username ?? "Cliente",
    roles: Array.isArray(roles) ? roles.filter((rol): rol is string => typeof rol === "string") : [],
    vencida: usuario.expired ?? false,
  };
}
