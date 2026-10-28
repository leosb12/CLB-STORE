import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ErrorDeFidelizacion } from "../fidelizacion/negocio/servicio-fidelizacion.js";

const MENSAJES: Record<number, [string, string]> = {
  400: ["La solicitud no es válida.", "SOLICITUD_INVALIDA"], 404: ["La ruta solicitada no existe.", "NO_ENCONTRADO"],
  405: ["El método HTTP no está permitido para esta ruta.", "METODO_NO_PERMITIDO"],
  413: ["La solicitud supera el tamaño permitido.", "SOLICITUD_DEMASIADO_GRANDE"],
  422: ["Los datos enviados no son válidos.", "DATOS_INVALIDOS"],
};

// Todas las respuestas de error en español con forma {mensaje, código}; nunca se exponen detalles internos.
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly registro = new Logger("Clientes");

  catch(error: unknown, anfitrión: ArgumentsHost): void {
    const respuesta = anfitrión.switchToHttp().getResponse<Response>();
    if (error instanceof ErrorDeFidelizacion) {
      respuesta.status(error.estado).json({ mensaje: error.message, código: error.código, ...error.detalle });
      return;
    }
    if (error instanceof HttpException) {
      const estado = error.getStatus();
      const cuerpo = error.getResponse();
      const propio = typeof cuerpo === "object" && cuerpo !== null && "mensaje" in cuerpo;
      const [mensaje, código] = MENSAJES[estado] ?? ["No se pudo procesar la solicitud.", "SOLICITUD_NO_PROCESADA"];
      respuesta.status(estado).json(propio ? { código, ...cuerpo } : { mensaje, código });
      return;
    }
    this.registro.error(error instanceof Error ? error.stack : String(error));
    respuesta.status(500).json({ mensaje: "Ocurrió un error interno al procesar la solicitud." });
  }
}
