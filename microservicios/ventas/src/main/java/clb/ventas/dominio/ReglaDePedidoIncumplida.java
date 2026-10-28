package clb.ventas.dominio;

/** Una regla del dominio de pedidos no se cumple; nunca se aplica un cambio parcial. */
public final class ReglaDePedidoIncumplida extends RuntimeException {
    public ReglaDePedidoIncumplida(String mensaje) {
        super(mensaje);
    }
}
