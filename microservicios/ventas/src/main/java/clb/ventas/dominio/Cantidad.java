package clb.ventas.dominio;

public record Cantidad(int valor) {
    public Cantidad {
        if (valor < 1 || valor > 1_000_000_000) throw new ReglaDePedidoIncumplida("La cantidad debe ser un entero positivo de hasta 1000000000.");
    }
}
