import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { SESION } from "../adaptadores/sesion-oidc";
import { EstadoSesion } from "../aplicacion/estado-sesion";

/** Destino del login de Keycloak: completa el intercambio del código (PKCE) y vuelve a donde estaba el cliente. */
@Component({
  selector: "clb-pagina-retorno", imports: [RouterLink],
  template: `<section class="pagina-retorno" role="status">
    @if (error()) {
      <h1>No se pudo iniciar sesión</h1><p class="aviso-error">{{ error() }}</p><a class="botón-secundario" routerLink="/catalogo">Volver al catálogo</a>
    } @else { <p>Iniciando sesión…</p> }
  </section>`,
})
export class PaginaRetorno {
  readonly error = signal("");

  constructor() {
    const sesion = inject(SESION), estado = inject(EstadoSesion), router = inject(Router);
    void sesion.completar()
      .then(async retorno => { await estado.cargar(); await router.navigateByUrl(retorno); })
      .catch(() => this.error.set("La respuesta de inicio de sesión no es válida o venció. Inténtalo de nuevo."));
  }
}
