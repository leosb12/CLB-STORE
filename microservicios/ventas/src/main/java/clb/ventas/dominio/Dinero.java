package clb.ventas.dominio;

import java.math.BigDecimal;

/** Importe en bolivianos (BOB) como centavos enteros: nunca se usa coma flotante para dinero. */
public record Dinero(long centavos) {

    public static final Dinero CERO = new Dinero(0);

    public Dinero {
        if (centavos < 0) throw new ReglaDePedidoIncumplida("El importe no puede ser negativo.");
    }

    /** Convierte el texto decimal publicado por Inventario ("149.90") en centavos exactos. */
    public static Dinero deDecimal(String texto) {
        if (texto == null || !texto.matches("\\d{1,9}(\\.\\d{1,2})?")) throw new ReglaDePedidoIncumplida("Precio decimal inválido.");
        return new Dinero(new BigDecimal(texto).movePointRight(2).longValueExact());
    }

    public Dinero sumar(Dinero otro) {
        return new Dinero(Math.addExact(centavos, otro.centavos));
    }

    public Dinero por(Cantidad cantidad) {
        return new Dinero(Math.multiplyExact(centavos, (long) cantidad.valor()));
    }

    public String decimal() {
        return BigDecimal.valueOf(centavos, 2).toPlainString();
    }
}
