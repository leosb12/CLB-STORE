import { Type } from "class-transformer";
import { ArrayMaxSize, IsBoolean, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from "class-validator";
import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException, UnprocessableEntityException, UseGuards,
} from "@nestjs/common";
import { AutenticacionJwt, Roles, type SolicitudAutenticada } from "../../comun/autenticacion.js";
import { ServicioNotificaciones } from "../negocio/servicio-notificaciones.js";

class SolicitudPreferencias {
  @IsBoolean({ message: "push debe ser verdadero o falso." }) push!: boolean;
  @IsBoolean({ message: "correo debe ser verdadero o falso." }) correo!: boolean;
  @IsInt({ message: "versión debe ser un entero." }) @Min(0) versión!: number;
}

class SolicitudDispositivo {
  @IsString() @Length(20, 4096, { message: "token no es válido." }) @Matches(/^[\x21-\x7e]+$/, { message: "token no es válido." }) token!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43,128}$/, { message: "secreto debe tener al menos 256 bits en base64url." }) secreto!: string;
}

class EventoSolicitud {
  @IsString() @Matches(/^ventas:[0-9]{1,19}$/, { message: "evento debe ser ventas:<número>." }) evento!: string;
  @IsIn(["pedido_confirmado", "pedido_cancelado"]) tipo!: "pedido_confirmado" | "pedido_cancelado";
  @IsUUID("4", { message: "cliente debe ser un UUID v4." }) cliente!: string;
  @IsUUID("4", { message: "pedido debe ser un UUID v4." }) pedido!: string;
}

class SolicitudRegistro {
  @ValidateNested({ each: true }) @Type(() => EventoSolicitud) @ArrayMaxSize(100) eventos!: EventoSolicitud[];
}

/** Preferencias, contacto y dispositivo del titular: siempre el del token, nunca otro. */
@Controller("api/v1/perfiles/yo")
@UseGuards(AutenticacionJwt)
@Roles("cliente", "admin")
export class ControladorNotificacionesTitular {
  constructor(private readonly servicio: ServicioNotificaciones) {}

  @Get("notificaciones")
  async preferencias(@Req() solicitud: SolicitudAutenticada) {
    return { preferencias: await this.servicio.preferencias(solicitud.titular.sub, solicitud.titular.correo, solicitud.titular.nombre) };
  }

  @Put("notificaciones")
  async guardar(@Req() solicitud: SolicitudAutenticada, @Body() cuerpo: SolicitudPreferencias, @Headers("idempotency-key") clave?: string) {
    if (clave !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clave))
      throw new UnprocessableEntityException({ mensaje: "Idempotency-Key debe ser un UUID v4.", código: "DATOS_INVALIDOS" });
    const correoDisponible = await this.servicio.correoDisponible(solicitud.titular.sub, solicitud.titular.correo, solicitud.titular.nombre);
    const guardadas = await this.servicio.guardarPreferencias(solicitud.titular.sub, { push: cuerpo.push, correo: cuerpo.correo }, cuerpo.versión, clave);
    // Misma forma que el GET: sin `correo_disponible` la app creería que la cuenta no tiene correo.
    return { preferencias: { ...guardadas, correo_disponible: correoDisponible } };
  }

  /** La web lo llama al iniciar sesión: así Clientes conoce el correo de quien no usa la app. */
  @Put("contacto") @HttpCode(204)
  async contacto(@Req() solicitud: SolicitudAutenticada) {
    await this.servicio.registrarContacto(solicitud.titular.sub, solicitud.titular.correo, solicitud.titular.nombre);
  }

  @Put("dispositivos/:instalacion") @HttpCode(204)
  async vincular(@Req() solicitud: SolicitudAutenticada, @Param("instalacion", new ParseUUIDPipe({ version: "4" })) instalacion: string,
    @Body() cuerpo: SolicitudDispositivo) {
    await this.servicio.registrarContacto(solicitud.titular.sub, solicitud.titular.correo, solicitud.titular.nombre);
    await this.servicio.vincular(solicitud.titular.sub, instalacion, cuerpo.token, cuerpo.secreto);
  }
}

/** Cierre de sesión sin red: el teléfono prueba la instalación con su secreto (no hay sesión del titular anterior). */
@Controller("api/v1/dispositivos")
export class ControladorDispositivos {
  constructor(private readonly servicio: ServicioNotificaciones) {}

  @Delete(":instalacion") @HttpCode(204)
  async desvincular(@Param("instalacion", new ParseUUIDPipe({ version: "4" })) instalacion: string,
    @Headers("x-clb-instalacion-secreto") secreto: string | undefined) {
    if (!secreto) throw new UnauthorizedException({ mensaje: "Falta el secreto de la instalación.", código: "NO_AUTENTICADO" });
    await this.servicio.desvincular(instalacion, secreto);
  }
}

/** Solo la automatización (token de servicio; la pasarela no publica /interno). */
@Controller("api/v1/interno/notificaciones")
@UseGuards(AutenticacionJwt)
@Roles("servicio")
export class ControladorNotificacionesInterno {
  constructor(private readonly servicio: ServicioNotificaciones) {}

  /** 202 solo cuando todo el lote quedó registrado: entonces n8n puede avanzar su cursor. */
  @Post("registrar") @HttpCode(202)
  registrar(@Body() cuerpo: SolicitudRegistro) {
    return this.servicio.registrar(cuerpo.eventos);
  }

  @Post("procesar") @HttpCode(200)
  async procesar(@Query("limite", new ParseIntPipe({ optional: true })) limite = 20) {
    return { resultado: await this.servicio.procesar(Math.min(Math.max(limite, 1), 50)) };
  }
}
