import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { configuracion } from "../configuracion.js";

export type Rol = "cliente" | "admin" | "servicio";

/** Quién hace la solicitud según su token de Keycloak. */
export interface Titular {
  sub: string;
  roles: Rol[];
  /** Claim `email` del token verificado (solo para avisos al propio titular); nunca se acepta del cuerpo. */
  correo?: string;
  /** Claim `name` del token verificado: nombre de la cuenta (Keycloak). Solo identifica al comprador en reportes internos. */
  nombre?: string;
}

export const VERIFICADOR_TOKENS = Symbol("VerificadorTokens");

/**
 * Valida firma (JWKS), emisor público estable y audiencia clb-api. Clientes valida cada token aunque venga por la pasarela
 * (defensa en profundidad). En pruebas se usa un JWKS local; en ejecución, el JWKS de Keycloak por la red interna.
 */
export class VerificadorTokens {
  constructor(private readonly llaves: JWTVerifyGetKey, private readonly emisor: string, private readonly audiencia = "clb-api") {}

  static remoto(): VerificadorTokens {
    return new VerificadorTokens(createRemoteJWKSet(new URL(configuracion.identidad.jwks)), configuracion.identidad.emisor);
  }

  async verificar(token: string): Promise<Titular> {
    const { payload } = await jwtVerify(token, this.llaves, { issuer: this.emisor, audience: this.audiencia, algorithms: ["RS256"] });
    const roles = (payload["realm_access"] as { roles?: unknown } | undefined)?.roles;
    if (typeof payload.sub !== "string") throw new Error("El token no identifica al titular.");
    const correo = typeof payload["email"] === "string" && /^[^\s@]+@[^\s@]+$/.test(payload["email"]) ? payload["email"] : undefined;
    const nombre = typeof payload["name"] === "string" ? payload["name"].replace(/[\x00-\x1f<>]/g, "").trim().slice(0, 120) : "";
    return { sub: payload.sub, roles: Array.isArray(roles) ? roles.filter((rol): rol is Rol => ["cliente", "admin", "servicio"].includes(rol)) : [],
      ...(correo ? { correo } : {}), ...(nombre ? { nombre } : {}) };
  }
}

const ROLES = "clb_roles";
/** Roles permitidos para la ruta (basta uno). Sin este decorador, la ruta solo exige un token válido. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

export type SolicitudAutenticada = Request & { titular: Titular };

@Injectable()
export class AutenticacionJwt implements CanActivate {
  constructor(@Inject(VERIFICADOR_TOKENS) private readonly verificador: VerificadorTokens, private readonly reflector: Reflector) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const solicitud = contexto.switchToHttp().getRequest<SolicitudAutenticada>();
    const [esquema, token] = (solicitud.headers.authorization ?? "").split(" ");
    if (esquema !== "Bearer" || !token) throw new UnauthorizedException({ mensaje: "Se requiere iniciar sesión.", código: "NO_AUTENTICADO" });
    try {
      solicitud.titular = await this.verificador.verificar(token);
    } catch {
      throw new UnauthorizedException({ mensaje: "La sesión no es válida o venció. Inicia sesión de nuevo.", código: "NO_AUTENTICADO" });
    }
    const permitidos = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLES, [contexto.getHandler(), contexto.getClass()]);
    if (permitidos && !permitidos.some(rol => solicitud.titular.roles.includes(rol)))
      throw new ForbiddenException({ mensaje: "No tienes permiso para esta operación.", código: "ACCESO_DENEGADO" });
    return true;
  }
}
