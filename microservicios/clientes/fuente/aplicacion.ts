import "reflect-metadata";
import { Controller, Get, Global, Module, Res, UnprocessableEntityException, ValidationPipe, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Response } from "express";
import { VERIFICADOR_TOKENS, type VerificadorTokens } from "./comun/autenticacion.js";
import { FiltroErrores } from "./comun/filtro-errores.js";
import type { RepositorioPerfiles } from "./perfiles/datos/repositorio-perfiles.js";
import { ModuloPerfiles } from "./perfiles/modulo-perfiles.js";
import type { RepositorioFidelizacion } from "./fidelizacion/datos/repositorio-fidelizacion.js";
import { ModuloFidelizacion } from "./fidelizacion/modulo-fidelizacion.js";
import { ServicioFidelizacion } from "./fidelizacion/negocio/servicio-fidelizacion.js";
import { ModuloNotificaciones, type DependenciasNotificaciones } from "./notificaciones/modulo-notificaciones.js";
import { ModuloArchivos } from "./archivos/modulo.js";
import type { ServicioArchivos } from "./archivos/negocio.js";
import { configuracion } from "./configuracion.js";

@Controller("salud")
class ControladorSalud {
  constructor(private readonly fidelizacion: ServicioFidelizacion) {}

  @Get()
  async salud(@Res() respuesta: Response): Promise<void> {
    const dynamodb = (await this.fidelizacion.disponible()) ? "ACTIVO" : "INACTIVO";
    const activo = dynamodb === "ACTIVO";
    respuesta.status(activo ? 200 : 503).setHeader("Cache-Control", "no-store")
      .json({ estado: activo ? "ACTIVO" : "DEGRADADO", servicio: "clientes", dependencias: { dynamodb } });
  }
}

/** El verificador de tokens es global: lo usa el guard de cada módulo (fidelización y perfiles). */
@Global()
@Module({})
class ModuloIdentidad {
  static con(verificador: VerificadorTokens): DynamicModule {
    return { module: ModuloIdentidad, providers: [{ provide: VERIFICADOR_TOKENS, useValue: verificador }], exports: [VERIFICADOR_TOKENS] };
  }
}

@Module({})
class ModuloClientes {
  static con(fidelizacion: RepositorioFidelizacion, perfiles: RepositorioPerfiles, verificador: VerificadorTokens,
    notificaciones?: DependenciasNotificaciones, archivos?: ServicioArchivos): DynamicModule {
    return { module: ModuloClientes, controllers: [ControladorSalud],
      imports: [ModuloIdentidad.con(verificador), ModuloFidelizacion.con(fidelizacion), ModuloPerfiles.con(perfiles),
        ...(notificaciones ? [ModuloNotificaciones.con(notificaciones)] : []), ...(archivos ? [ModuloArchivos.con(archivos)] : [])] };
  }
}

export async function crearAplicacion(fidelizacion: RepositorioFidelizacion, perfiles: RepositorioPerfiles, verificador: VerificadorTokens,
  notificaciones?: DependenciasNotificaciones, archivos?: ServicioArchivos): Promise<INestApplication> {
  const aplicación = await NestFactory.create(ModuloClientes.con(fidelizacion, perfiles, verificador, notificaciones, archivos), { logger: ["error", "warn"] });
  if (configuracion.origenes.length) aplicación.enableCors({ origin: configuracion.origenes,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"], maxAge: 300 });
  aplicación.useGlobalPipes(new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true,
    exceptionFactory: errores => new UnprocessableEntityException({
      mensaje: "Los datos enviados no son válidos.",
      errores: Object.fromEntries(errores.map(error => [error.property,
        error.constraints?.whitelistValidation ? ["Campo no admitido."] : Object.values(error.constraints ?? {})])),
    }),
  }));
  aplicación.useGlobalFilters(new FiltroErrores());
  aplicación.enableShutdownHooks();
  return aplicación;
}
