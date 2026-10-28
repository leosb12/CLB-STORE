import { setTimeout as esperar } from "node:timers/promises";
import { crearAplicacion } from "./aplicacion.js";
import { configuracion } from "./configuracion.js";
import { VerificadorTokens } from "./comun/autenticacion.js";
import { crearClienteDynamoDB, RepositorioDynamoDB } from "./fidelizacion/datos/repositorio-dynamodb.js";
import { RepositorioPerfilesDynamoDB } from "./perfiles/datos/repositorio-perfiles.js";

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
const aplicación = await crearAplicacion(repositorio, new RepositorioPerfilesDynamoDB(dynamodb, configuracion.tabla), VerificadorTokens.remoto());
await aplicación.listen(configuracion.puerto, "0.0.0.0");
