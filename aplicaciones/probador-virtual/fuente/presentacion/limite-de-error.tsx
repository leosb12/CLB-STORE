import { Component, type ReactNode } from "react";

/** Si algo inesperado rompe el render, el probador lo dice en vez de quedar en blanco; la tienda sigue funcionando. */
export class LimiteDeError extends Component<{ children: ReactNode }, { roto: boolean }> {
  override state = { roto: false };

  static getDerivedStateFromError(): { roto: boolean } {
    return { roto: true };
  }

  override render(): ReactNode {
    if (!this.state.roto) return this.props.children;
    return (
      <p className="aviso" role="alert">
        El probador tuvo un problema en este navegador. Recarga la página para intentarlo de nuevo; el resto de la tienda sigue disponible.
      </p>
    );
  }
}
