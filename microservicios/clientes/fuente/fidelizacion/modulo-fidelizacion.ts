import { Module, type DynamicModule } from "@nestjs/common";
import { REPOSITORIO_FIDELIZACION, type RepositorioFidelizacion } from "./datos/repositorio-fidelizacion.js";
import { ServicioFidelizacion } from "./negocio/servicio-fidelizacion.js";
import { ControladorFidelizacion } from "./presentacion/controlador-fidelizacion.js";
import { AutenticacionJwt } from "../comun/autenticacion.js";

// Capas: presentacion → negocio → datos. El repositorio concreto se inyecta al arrancar (DynamoDB o memoria en pruebas).
@Module({})
export class ModuloFidelizacion {
  static con(repositorio: RepositorioFidelizacion): DynamicModule {
    return {
      module: ModuloFidelizacion,
      controllers: [ControladorFidelizacion],
      providers: [ServicioFidelizacion, AutenticacionJwt, { provide: REPOSITORIO_FIDELIZACION, useValue: repositorio }],
      exports: [ServicioFidelizacion],
    };
  }
}
