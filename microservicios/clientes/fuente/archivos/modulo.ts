import { Body, Controller, Delete, Get, Headers, Module, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, type DynamicModule } from "@nestjs/common";
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
import { AutenticacionJwt, Roles, type SolicitudAutenticada } from "../comun/autenticacion.js";
import { destinos, ServicioArchivos, type TipoArchivo } from "./negocio.js";

class NuevaSubida {
  @IsIn(Object.keys(destinos)) tipo!: TipoArchivo;
  @IsString() @Length(3, 120) descripcion!: string;
  @IsString() @Length(3, 100) mime!: string;
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) bytes!: number;
  @Matches(/^[a-f0-9]{64}$/) sha256!: string;
  @IsIn(["web", "android", "microservicio"]) origen!: "web" | "android" | "microservicio";
  @IsOptional() @IsObject() referencias?: Record<string, string>;
}
const uuid = () => new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 422 });

@Controller("api/v1/archivos")
@UseGuards(AutenticacionJwt)
@Roles("cliente", "admin", "servicio")
class ControladorArchivos {
  constructor(private readonly servicio: ServicioArchivos) {}
  @Post("subidas") preparar(@Headers("idempotency-key") id: string, @Body() cuerpo: NuevaSubida, @Req() s: SolicitudAutenticada) {
    return this.servicio.preparar(id, cuerpo, s.titular);
  }
  @Post(":id/confirmar") confirmar(@Param("id", uuid()) id: string, @Req() s: SolicitudAutenticada) { return this.servicio.confirmar(id, s.titular); }
  @Get() listar(@Req() s: SolicitudAutenticada, @Query("cursor") cursor?: string) { return this.servicio.listar(s.titular, cursor); }
  @Get(":id") consultar(@Param("id", uuid()) id: string, @Req() s: SolicitudAutenticada) { return this.servicio.consultar(id, s.titular); }
  @Get(":id/descarga") descargar(@Param("id", uuid()) id: string, @Req() s: SolicitudAutenticada) { return this.servicio.descargar(id, s.titular); }
  @Delete(":id") borrar(@Param("id", uuid()) id: string, @Req() s: SolicitudAutenticada) { return this.servicio.borrar(id, s.titular); }
}
@Module({})
export class ModuloArchivos {
  static con(servicio: ServicioArchivos): DynamicModule {
    return { module: ModuloArchivos, controllers: [ControladorArchivos], providers: [{ provide: ServicioArchivos, useValue: servicio }] };
  }
}
