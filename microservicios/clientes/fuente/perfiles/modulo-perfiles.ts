import { Module, type DynamicModule } from "@nestjs/common";
import { AutenticacionJwt } from "../comun/autenticacion.js";
import { REPOSITORIO_PERFILES, type RepositorioPerfiles } from "./datos/repositorio-perfiles.js";
import { ServicioPerfiles } from "./negocio/servicio-perfiles.js";
import { ControladorPerfiles } from "./presentacion/controlador-perfiles.js";

// Capas: presentacion → negocio → datos.
@Module({})
export class ModuloPerfiles {
  static con(repositorio: RepositorioPerfiles): DynamicModule {
    return {
      module: ModuloPerfiles,
      controllers: [ControladorPerfiles],
      providers: [ServicioPerfiles, AutenticacionJwt, { provide: REPOSITORIO_PERFILES, useValue: repositorio }],
    };
  }
}
