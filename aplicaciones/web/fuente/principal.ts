import { isDevMode } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideServiceWorker } from "@angular/service-worker";
import { Aplicacion } from "./aplicacion";
import { PaginaCatalogo } from "./catalogo/presentacion/pagina-catalogo";
import { PaginaDetalle } from "./catalogo/presentacion/pagina-detalle";
import { FUENTE_CATALOGO } from "./catalogo/aplicacion/estado-catalogo";
import { CatalogoRest } from "./catalogo/adaptadores/catalogo-rest";
import {
  ADMINISTRACION_REST,
  AdministracionRest,
} from "./administracion/adaptadores/administracion-rest";
import { PaginaAdministracion } from "./administracion/presentacion/pagina-administracion";
import { PaginaCarrito } from "./existencias/presentacion/pagina-carrito";

async function iniciar(): Promise<void> {
  const respuesta = await fetch("/configuracion.json");
  if (!respuesta.ok)
    throw new Error("No se pudo cargar la configuración de CLB Store.");
  const configuración: { apiInventario: string } = await respuesta.json();
  await bootstrapApplication(Aplicacion, {
    providers: [
      {
        provide: ADMINISTRACION_REST,
        useValue: new AdministracionRest(configuración.apiInventario),
      },
      {
        provide: FUENTE_CATALOGO,
        useValue: new CatalogoRest(configuración.apiInventario),
      },
      provideRouter([
        { path: "carrito", component: PaginaCarrito },
        { path: "administracion/productos", component: PaginaAdministracion },
        { path: "catalogo", component: PaginaCatalogo },
        {
          path: "favoritos",
          component: PaginaCatalogo,
          data: { favoritos: true },
        },
        { path: "productos/:identificador", component: PaginaDetalle },
        { path: "**", redirectTo: "catalogo" },
      ]),
      provideServiceWorker("ngsw-worker.js", {
        enabled: !isDevMode(),
        registrationStrategy: "registerImmediately",
      }),
    ],
  });
}
void iniciar().catch(() => {
  document.body.textContent =
    "No se pudo iniciar CLB Store. Conéctate para completar la primera descarga y vuelve a abrir la aplicación.";
});
