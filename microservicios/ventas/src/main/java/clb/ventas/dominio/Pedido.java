package clb.ventas.dominio;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/** Raíz del agregado: protege sus invariantes y sus transiciones de estado. */
public final class Pedido {

    public static final int MÁXIMO_LÍNEAS = 50;

    private final UUID identificador;
    private final UUID identificadorCliente;
    private final List<LineaPedido> líneas;
    private final Instant fechaCreación;
    private EstadoPedido estado;
    private String motivo;
    private Instant fechaActualización;

    private Pedido(UUID identificador, UUID identificadorCliente, List<LineaPedido> líneas, EstadoPedido estado,
                   String motivo, Instant fechaCreación, Instant fechaActualización) {
        this.identificador = identificador;
        this.identificadorCliente = identificadorCliente;
        this.líneas = List.copyOf(líneas);
        this.estado = estado;
        this.motivo = motivo;
        this.fechaCreación = fechaCreación;
        this.fechaActualización = fechaActualización;
    }

    public static Pedido crear(UUID identificador, UUID identificadorCliente, List<LineaPedido> líneas, Instant ahora) {
        if (identificador == null || identificadorCliente == null) throw new ReglaDePedidoIncumplida("El pedido requiere identificador y cliente.");
        if (líneas == null || líneas.isEmpty() || líneas.size() > MÁXIMO_LÍNEAS) {
            throw new ReglaDePedidoIncumplida("El pedido requiere entre 1 y " + MÁXIMO_LÍNEAS + " líneas.");
        }
        var variantes = new HashSet<UUID>();
        for (LineaPedido línea : líneas) {
            if (!variantes.add(línea.producto().identificadorVariante())) throw new ReglaDePedidoIncumplida("Una variante no puede repetirse en el pedido.");
        }
        var pedido = new Pedido(identificador, identificadorCliente, líneas, EstadoPedido.PENDIENTE, null, ahora, ahora);
        pedido.total(); // Valida que el total no desborde.
        return pedido;
    }

    /** Reconstruye un pedido persistido; no repite validaciones de creación. */
    public static Pedido reconstituir(UUID identificador, UUID identificadorCliente, List<LineaPedido> líneas, EstadoPedido estado,
                                      String motivo, Instant fechaCreación, Instant fechaActualización) {
        return new Pedido(identificador, identificadorCliente, líneas, estado, motivo, fechaCreación, fechaActualización);
    }

    public Dinero total() {
        return líneas.stream().map(LineaPedido::subtotal).reduce(Dinero.CERO, Dinero::sumar);
    }

    public void confirmar(Instant ahora) {
        exigirAbierto();
        cambiar(EstadoPedido.CONFIRMADO, null, ahora);
    }

    public void cancelar(String motivo, Instant ahora) {
        exigirAbierto();
        cambiar(EstadoPedido.CANCELADO, motivo, ahora);
    }

    public void ponerEnRevisión(String motivo, Instant ahora) {
        exigirAbierto();
        cambiar(EstadoPedido.EN_REVISION, motivo, ahora);
    }

    /** El servicio que faltaba respondió: el pedido vuelve a estar en curso y se descarta el motivo ya resuelto. */
    public void reanudar(Instant ahora) {
        if (estado == EstadoPedido.EN_REVISION) cambiar(EstadoPedido.PENDIENTE, null, ahora);
    }

    public boolean terminado() {
        return estado == EstadoPedido.CONFIRMADO || estado == EstadoPedido.CANCELADO;
    }

    private void exigirAbierto() {
        if (terminado()) throw new ReglaDePedidoIncumplida("El pedido ya está " + estado + " y no admite cambios.");
    }

    private void cambiar(EstadoPedido nuevo, String nuevoMotivo, Instant ahora) {
        estado = nuevo;
        motivo = nuevoMotivo;
        fechaActualización = ahora;
    }

    public UUID identificador() { return identificador; }
    public UUID identificadorCliente() { return identificadorCliente; }
    public List<LineaPedido> líneas() { return líneas; }
    public EstadoPedido estado() { return estado; }
    public String motivo() { return motivo; }
    public Instant fechaCreación() { return fechaCreación; }
    public Instant fechaActualización() { return fechaActualización; }
}
