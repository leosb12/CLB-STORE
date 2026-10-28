package clb.ventas.aplicacion;

/** Errores de la capa de aplicación que la infraestructura traduce a HTTP. */
public final class Errores {

    private Errores() {}

    /** Un servicio participante no respondió (red, caída, 5xx): se puede reintentar con la misma clave. */
    public static final class ServicioNoDisponible extends RuntimeException {
        public ServicioNoDisponible(String mensaje) { super(mensaje); }
    }

    /** El servicio respondió con un rechazo definitivo (p. ej., stock insuficiente): reintentar no cambia el resultado. */
    public static final class RechazoDefinitivo extends RuntimeException {
        private final String código;
        public RechazoDefinitivo(String código, String mensaje) { super(mensaje); this.código = código; }
        public String código() { return código; }
    }

    public static final class ConflictoDeIdempotencia extends RuntimeException {
        public ConflictoDeIdempotencia(String mensaje) { super(mensaje); }
    }

    /** Otro proceso retomó la SAGA porque este tardó más que su arriendo: se detiene sin pisar su trabajo. */
    public static final class ArrendamientoPerdido extends RuntimeException {
        public ArrendamientoPerdido() { super("Otro proceso retomó la SAGA."); }
    }

    public static final class PedidoInexistente extends RuntimeException {
        public PedidoInexistente() { super("El pedido no existe."); }
    }

    /** El pedido existe pero la automatización todavía no registró su comprobante. */
    public static final class ComprobanteNoDisponible extends RuntimeException {
        public ComprobanteNoDisponible() { super("El comprobante de este pedido todavía se está generando."); }
    }
}
