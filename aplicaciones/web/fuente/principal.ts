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
import { VENTAS_REST, VentasRest } from "./pedidos/adaptadores/ventas-rest";
import { PaginaPedidos } from "./pedidos/presentacion/pagina-pedidos";
import { SESION, SesionOidc, type ConfiguracionIdentidad } from "./sesion/adaptadores/sesion-oidc";
import { LIMPIEZAS_AL_CERRAR, soloAdministradores } from "./sesion/aplicacion/estado-sesion";
import { borrarClavesFotografia } from "./administracion/presentacion/panel-fotografia";
import { PaginaRetorno } from "./sesion/presentacion/pagina-retorno";
import { GESTION_REST, GestionRest } from "./gestion/adaptadores/gestion-rest";
import { PaginaGestion } from "./gestion/presentacion/pagina-gestion";
import { PaginaReporte } from "./gestion/presentacion/pagina-reporte";
import { PaginaProbador } from "./probador/presentacion/pagina-probador";
import { borrarDatosProbador, precargarArchivosProbador } from "./probador/adaptadores/cargador-probador";

async function iniciar(): Promise<void> {
  const respuesta = await fetch("/configuracion.json");
  if (!respuesta.ok)
    throw new Error("No se pudo cargar la configuración de CLB Store.");
  const configuración: { apiInventario: string; apiVentas: string; identidad: ConfiguracionIdentidad } = await respuesta.json();
  const sesión = new SesionOidc(configuración.identidad);
  await bootstrapApplication(Aplicacion, {
    providers: [
      {
        provide: ADMINISTRACION_REST,
        useValue: new AdministracionRest(configuración.apiInventario, sesión),
      },
      // Una configuración guardada antes de la fase 6 no trae apiVentas: Nginx enruta /api/v1/pedidos a Ventas igualmente.
      { provide: VENTAS_REST, useValue: new VentasRest(configuración.apiVentas ?? configuración.apiInventario, sesión) },
      { provide: SESION, useValue: sesión },
      { provide: LIMPIEZAS_AL_CERRAR, useValue: [borrarDatosProbador, async () => borrarClavesFotografia()] },
      // La gestión empresarial (IA) entra por la misma pasarela: /api/v1/{agentes,reportes,graphql,voz}.
      { provide: GESTION_REST, useValue: new GestionRest(configuración.apiInventario, sesión) },
      {
        provide: FUENTE_CATALOGO,
        useValue: new CatalogoRest(configuración.apiInventario),
      },
      provideRouter([
        { path: "carrito", component: PaginaCarrito },
        { path: "pedidos", component: PaginaPedidos },
        { path: "administracion/productos", component: PaginaAdministracion, canActivate: [soloAdministradores] },
        { path: "gestion", component: PaginaGestion, canActivate: [soloAdministradores] },
        { path: "gestion/reportes/:identificador", component: PaginaReporte, canActivate: [soloAdministradores] },
        { path: "sesion/retorno", component: PaginaRetorno },
        { path: "catalogo", component: PaginaCatalogo },
        {
          path: "favoritos",
          component: PaginaCatalogo,
          data: { favoritos: true },
        },
        { path: "probador", component: PaginaProbador },
        { path: "productos/:identificador/probador", component: PaginaProbador },
        { path: "productos/:identificador", component: PaginaDetalle },
        { path: "**", redirectTo: "catalogo" },
      ]),
      provideServiceWorker("ngsw-worker.js", {
        enabled: !isDevMode(),
        registrationStrategy: "registerImmediately",
      }),
    ],
  });
  // Los archivos del probador (microfrontend React) se descargan en segundo plano, sin ejecutarlos, para abrirlo sin conexión.
  if (!isDevMode()) precargarArchivosProbador();
}
void iniciar().catch(() => {
  document.body.textContent =
    "No se pudo iniciar CLB Store. Conéctate para completar la primera descarga y vuelve a abrir la aplicación.";
});
