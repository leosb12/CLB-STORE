package clb.ventas.dominio;

public enum EstadoPedido {
    /** Creado; la SAGA de compra aún no terminó. */
    PENDIENTE,
    /** Inventario consumió la reserva y Clientes acreditó los puntos. */
    CONFIRMADO,
    /** Rechazado o compensado; nunca se cobra ni se descuenta stock. */
    CANCELADO,
    /** Un servicio no respondió; el reanudador reintenta la SAGA desde su último paso. */
    EN_REVISION
}
