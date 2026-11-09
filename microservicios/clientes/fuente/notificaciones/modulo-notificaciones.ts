import { Module, type DynamicModule } from "@nestjs/common";
import { AutenticacionJwt } from "../comun/autenticacion.js";
import { REPOSITORIO_NOTIFICACIONES, type RepositorioNotificaciones } from "./datos/repositorio-notificaciones.js";
import { PROVEEDOR_CORREO, PROVEEDOR_PUSH, type ProveedorCorreo, type ProveedorPush } from "./datos/proveedores.js";
import { RELOJ, ServicioNotificaciones } from "./negocio/servicio-notificaciones.js";
import {
  ControladorDispositivos, ControladorNotificacionesInterno, ControladorNotificacionesTitular,
} from "./presentacion/controlador-notificaciones.js";

export interface DependenciasNotificaciones {
  repositorio: RepositorioNotificaciones;
  push: ProveedorPush;
  correo: ProveedorCorreo;
  reloj?: () => Date;
}

// Capas: presentacion → negocio → datos (repositorio DynamoDB y proveedores FCM/Resend).
@Module({})
export class ModuloNotificaciones {
  static con(dependencias: DependenciasNotificaciones): DynamicModule {
    return {
      module: ModuloNotificaciones,
      controllers: [ControladorNotificacionesTitular, ControladorDispositivos, ControladorNotificacionesInterno],
      providers: [ServicioNotificaciones, AutenticacionJwt,
        { provide: REPOSITORIO_NOTIFICACIONES, useValue: dependencias.repositorio },
        { provide: PROVEEDOR_PUSH, useValue: dependencias.push },
        { provide: PROVEEDOR_CORREO, useValue: dependencias.correo },
        { provide: RELOJ, useValue: dependencias.reloj ?? (() => new Date()) }],
    };
  }
}
