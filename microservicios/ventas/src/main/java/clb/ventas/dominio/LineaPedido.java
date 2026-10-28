package clb.ventas.dominio;

/** Línea del agregado Pedido; solo existe dentro de él. */
public record LineaPedido(CopiaProducto producto, Cantidad cantidad) {
    public LineaPedido {
        if (producto == null || cantidad == null) throw new ReglaDePedidoIncumplida("La línea del pedido está incompleta.");
    }

    public Dinero subtotal() {
        return producto.precio().por(cantidad);
    }
}
