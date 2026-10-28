package clb.ventas.dominio;

import java.util.UUID;

/**
 * Copia inmutable de la prenda al momento de comprar. Ventas no comparte tablas con Inventario: guarda lo que el pedido
 * necesita (SKU, talla, color, categoría y precio) para que un cambio posterior del catálogo no altere pedidos pasados.
 */
public record CopiaProducto(UUID identificadorVariante, String identificadorProducto, String sku, String nombre,
                            String categoría, String talla, String color, Dinero precio) {
    public CopiaProducto {
        if (identificadorVariante == null || precio == null) throw new ReglaDePedidoIncumplida("La copia del producto está incompleta.");
        for (String texto : new String[] {identificadorProducto, sku, nombre, categoría, talla, color}) {
            if (texto == null || texto.isBlank()) throw new ReglaDePedidoIncumplida("La copia del producto está incompleta.");
        }
    }
}
