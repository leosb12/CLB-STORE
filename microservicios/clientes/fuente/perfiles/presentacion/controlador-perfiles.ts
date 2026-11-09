import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from "class-validator";
import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AutenticacionJwt, Roles, type SolicitudAutenticada } from "../../comun/autenticacion.js";
import { ServicioPerfiles } from "../negocio/servicio-perfiles.js";

class MedidasSolicitud {
  @IsOptional() @IsInt({ message: "altura_cm debe ser un entero." }) @Min(100) @Max(230) altura_cm?: number;
  @IsOptional() @IsInt({ message: "peso_kg debe ser un entero." }) @Min(30) @Max(250) peso_kg?: number;
  @IsOptional() @IsInt({ message: "pecho_cm debe ser un entero." }) @Min(50) @Max(200) pecho_cm?: number;
  @IsOptional() @IsInt({ message: "cintura_cm debe ser un entero." }) @Min(40) @Max(200) cintura_cm?: number;
  @IsOptional() @IsInt({ message: "cadera_cm debe ser un entero." }) @Min(50) @Max(200) cadera_cm?: number;
}

class SolicitudPerfil {
  @IsString() @Length(1, 120, { message: "nombre debe tener entre 1 y 120 caracteres." }) nombre!: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9 ]{6,20}$/, { message: "teléfono debe tener entre 6 y 20 dígitos." }) teléfono?: string | null;
  @IsOptional() @ValidateNested() @Type(() => MedidasSolicitud) medidas?: MedidasSolicitud;
  @IsInt({ message: "versión_esperada debe ser un entero." }) @Min(0) versión_esperada!: number;
}

/** CU01.4 — Editar perfil. El titular siempre es el del token: no hay forma de editar el perfil de otro. */
@Controller("api/v1/perfiles")
@UseGuards(AutenticacionJwt)
@Roles("cliente", "admin")
export class ControladorPerfiles {
  constructor(private readonly servicio: ServicioPerfiles) {}

  @Get("yo")
  async perfil(@Req() solicitud: SolicitudAutenticada) {
    return { perfil: await this.servicio.perfil(solicitud.titular.sub) };
  }

  @Put("yo")
  async editar(@Req() solicitud: SolicitudAutenticada, @Body() cambios: SolicitudPerfil) {
    return { perfil: await this.servicio.editar(solicitud.titular.sub, {
      nombre: cambios.nombre, teléfono: cambios.teléfono ?? null, medidas: { ...(cambios.medidas ?? {}) }, versión_esperada: cambios.versión_esperada,
    }) };
  }
}

class SolicitudNombres {
  @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID("4", { each: true, message: "clientes debe contener UUID v4." }) clientes!: string[];
}

/** Solo servicios internos (IA alimenta su modelo de lectura); la pasarela no publica /interno. */
@Controller("api/v1/interno/clientes")
@UseGuards(AutenticacionJwt)
@Roles("servicio")
export class ControladorPerfilesInterno {
  constructor(private readonly servicio: ServicioPerfiles) {}

  @Post("nombres") @HttpCode(200)
  async nombres(@Body() cuerpo: SolicitudNombres) {
    return { clientes: await this.servicio.nombres(cuerpo.clientes) };
  }
}
