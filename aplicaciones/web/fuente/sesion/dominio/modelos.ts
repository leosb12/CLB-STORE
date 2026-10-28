/** Titular de la sesión según Keycloak (una sola cuenta para tienda, pedidos y panel). */
export interface Titular {
  sub: string;
  nombre: string;
  roles: string[];
  /** El token venció: sin red solo permite leer datos locales; con red se renueva al enviar. */
  vencida: boolean;
}

export const esAdministrador = (titular: Titular | null): boolean => !!titular?.roles.includes("admin");
