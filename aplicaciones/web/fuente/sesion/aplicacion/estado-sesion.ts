import { Injectable, InjectionToken, computed, inject, signal } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";
import { SESION } from "../adaptadores/sesion-oidc";
import { EstadoCatalogo } from "../../catalogo/aplicacion/estado-catalogo";
import { esAdministrador, type Titular } from "../dominio/modelos";

/** Datos privados de otras funcionalidades que no deben quedar para el siguiente usuario del navegador. */
export const LIMPIEZAS_AL_CERRAR = new InjectionToken<ReadonlyArray<() => Promise<void>>>("LIMPIEZAS_AL_CERRAR");

/** CU01: iniciar y cerrar sesión una sola vez para toda la aplicación (SSO). */
@Injectable({ providedIn: "root" })
export class EstadoSesion {
  private readonly sesion = inject(SESION);
  private readonly local = inject(EstadoCatalogo).local;
  private readonly limpiezas = inject(LIMPIEZAS_AL_CERRAR, { optional: true }) ?? [];
  readonly titular = signal<Titular | null>(null);
  readonly administrador = computed(() => esAdministrador(this.titular()));
  readonly error = signal("");

  constructor() {
    this.sesion.alCambiar(() => void this.cargar());
  }

  async cargar(): Promise<void> {
    this.titular.set(await this.sesion.titular());
  }

  // El retorno conserva filtros y anclas de la pantalla actual.
  async iniciar(retorno = location.pathname + location.search + location.hash): Promise<void> {
    if (!navigator.onLine) {
      this.error.set("Sin conexión no se puede iniciar una sesión nueva. Tus datos guardados siguen disponibles.");
      return;
    }
    this.error.set("");
    await this.sesion.iniciar(retorno);
  }

  async cerrar(): Promise<void> {
    // Los datos administrativos descargados no deben quedar para el siguiente usuario del navegador.
    await this.local.borrarDatosAdministrativos();
    // Fotos del probador, claves de publicación…: un fallo se registra y no impide cerrar la sesión.
    for (const limpiar of this.limpiezas) await limpiar().catch((error) => console.error("Limpieza al cerrar sesión", error));
    await this.sesion.cerrar();
    this.titular.set(null);
  }
}

/** Solo un administrador entra al panel; sin sesión se le pide iniciarla y un cliente vuelve al catálogo. */
export const soloAdministradores: CanActivateFn = async (_ruta, estado) => {
  // inject() solo funciona antes del primer await.
  const sesion = inject(EstadoSesion), enrutador = inject(Router);
  await sesion.cargar();
  if (sesion.administrador()) return true;
  if (!sesion.titular()) await sesion.iniciar(estado.url);
  return enrutador.parseUrl("/catalogo");
};
