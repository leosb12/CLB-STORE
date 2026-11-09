import { setTimeout as esperar } from "node:timers/promises";
import { crearAplicacion } from "./aplicacion.js";
import { configuracion } from "./configuracion.js";
import { VerificadorTokens } from "./comun/autenticacion.js";
import { crearClienteDynamoDB, RepositorioDynamoDB } from "./fidelizacion/datos/repositorio-dynamodb.js";
import { RepositorioPerfilesDynamoDB } from "./perfiles/datos/repositorio-perfiles.js";
import { RepositorioNotificacionesDynamoDB } from "./notificaciones/datos/repositorio-notificaciones.js";
import { CorreoResend, PushFcm, cuentaDesdeEntorno, sinConfigurar } from "./notificaciones/datos/proveedores.js";

const dynamodb = crearClienteDynamoDB();
const repositorio = new RepositorioDynamoDB(dynamodb, configuracion.tabla);

// En local la tabla se crea si falta; DynamoDB Local puede tardar en aceptar conexiones tras arrancar.
// En cloud se aprovisiona fuera de la aplicación.
if (configuracion.entorno === "local") {
  for (let intento = 1; ; intento++) {
    try { await repositorio.asegurarTabla(); break; } catch (error) {
      if (intento >= 30) throw error;
      await esperar(1000);
    }
  }
}
// Proveedores de avisos: sin claves configuradas el canal queda registrado como NO_CONFIGURADO y nada se bloquea.
const { habilitadas, correoHabilitado, correo: claveCorreo, remitente } = configuracion.notificaciones;
const cuentaFcm = habilitadas ? cuentaDesdeEntorno() : null;
const aplicación = await crearAplicacion(repositorio, new RepositorioPerfilesDynamoDB(dynamodb, configuracion.tabla), VerificadorTokens.remoto(), {
  repositorio: new RepositorioNotificacionesDynamoDB(dynamodb, configuracion.tabla),
  push: cuentaFcm ? new PushFcm(cuentaFcm) : sinConfigurar,
  correo: habilitadas && correoHabilitado && claveCorreo && remitente ? new CorreoResend(claveCorreo, remitente) : sinConfigurar,
});
await aplicación.listen(configuracion.puerto, "0.0.0.0");
