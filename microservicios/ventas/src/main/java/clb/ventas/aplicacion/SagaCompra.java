package clb.ventas.aplicacion;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Estado persistido de la SAGA de compra (orquestación). Cada paso usa una Idempotency-Key fija generada al iniciar,
 * así que un reintento tras una respuesta perdida nunca duplica reservas, puntos ni consumos.
 */
public final class SagaCompra {

    public enum Paso { RESERVAR, ACREDITAR, CONSUMIR, COMPENSAR_RESERVA, COMPENSAR_PUNTOS, TERMINADA }

    public record Registro(Paso paso, String resultado, String detalle, Instant fecha) {}

    public record Claves(UUID reserva, UUID acreditación, UUID consumo, UUID liberación, UUID reversa) {
        static Claves nuevas() {
            return new Claves(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        }
    }

    private static final String NO_DISPONIBLE = "NO_DISPONIBLE";

    private final UUID identificadorPedido;
    private final UUID identificadorReserva;
    private final Claves claves;
    private final List<Registro> persistidos;
    private final List<Registro> nuevos = new ArrayList<>();
    private Paso paso;
    private int intentos;
    private Instant próximoIntento;

    private SagaCompra(UUID identificadorPedido, UUID identificadorReserva, Claves claves, Paso paso, int intentos,
                       Instant próximoIntento, List<Registro> persistidos) {
        this.identificadorPedido = identificadorPedido;
        this.identificadorReserva = identificadorReserva;
        this.claves = claves;
        this.paso = paso;
        this.intentos = intentos;
        this.próximoIntento = próximoIntento;
        this.persistidos = new ArrayList<>(persistidos);
    }

    public static SagaCompra iniciar(UUID identificadorPedido, Instant ahora) {
        var saga = new SagaCompra(identificadorPedido, UUID.randomUUID(), Claves.nuevas(), Paso.RESERVAR, 0, ahora, List.of());
        saga.nuevos.add(new Registro(Paso.RESERVAR, "INICIADA", "Pedido PENDIENTE creado", ahora));
        return saga;
    }

    public static SagaCompra reconstituir(UUID identificadorPedido, UUID identificadorReserva, Claves claves, Paso paso,
                                          int intentos, Instant próximoIntento, List<Registro> historial) {
        return new SagaCompra(identificadorPedido, identificadorReserva, claves, paso, intentos, próximoIntento, historial);
    }

    /** El paso actual terminó (bien o con un rechazo que decide el camino) y la SAGA pasa al siguiente. */
    public void avanzar(Paso siguiente, String resultado, String detalle, Instant ahora) {
        nuevos.add(new Registro(paso, resultado, detalle, ahora));
        paso = siguiente;
        intentos = 0;
        próximoIntento = ahora;
    }

    /** El servicio del paso actual no respondió: se reintenta más tarde con espera exponencial (máximo 60 s). */
    public void fallóTemporalmente(String detalle, Instant ahora) {
        List<Registro> historial = historial();
        Registro último = historial.isEmpty() ? null : historial.getLast();
        // Un mismo paso caído no llena el historial: se registra solo la primera vez.
        if (último == null || último.paso() != paso || !NO_DISPONIBLE.equals(último.resultado())) {
            nuevos.add(new Registro(paso, NO_DISPONIBLE, detalle, ahora));
        }
        intentos++;
        próximoIntento = ahora.plusSeconds(Math.min(60, 1L << Math.min(intentos, 6)));
    }

    public boolean terminada() {
        return paso == Paso.TERMINADA;
    }

    public List<Registro> historial() {
        var todos = new ArrayList<>(persistidos);
        todos.addAll(nuevos);
        return List.copyOf(todos);
    }

    public List<Registro> registrosNuevos() {
        return List.copyOf(nuevos);
    }

    public void marcarPersistida() {
        persistidos.addAll(nuevos);
        nuevos.clear();
    }

    public UUID identificadorPedido() { return identificadorPedido; }
    public UUID identificadorReserva() { return identificadorReserva; }
    public Claves claves() { return claves; }
    public Paso paso() { return paso; }
    public int intentos() { return intentos; }
    public Instant próximoIntento() { return próximoIntento; }
}
