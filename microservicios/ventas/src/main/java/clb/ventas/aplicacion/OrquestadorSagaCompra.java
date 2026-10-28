package clb.ventas.aplicacion;

import clb.ventas.aplicacion.Errores.ArrendamientoPerdido;
import clb.ventas.aplicacion.Errores.PedidoInexistente;
import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import clb.ventas.aplicacion.SagaCompra.Paso;
import clb.ventas.aplicacion.puertos.Puertos.EventoVenta;
import clb.ventas.aplicacion.puertos.Puertos.FidelizacionClientes;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.aplicacion.puertos.Puertos.ReservasInventario;
import clb.ventas.dominio.Pedido;
import java.time.Clock;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Orquestador de la SAGA de compra entre Ventas, Inventario y Clientes:
 * RESERVAR (Inventario) → ACREDITAR (Clientes) → CONSUMIR (Inventario) → pedido CONFIRMADO.
 * No hay rollback global: si un paso posterior a la reserva falla, se compensa liberando la reserva y revirtiendo los puntos.
 * Cada paso se persiste antes de seguir (con renovación del arriendo), así una caída se retoma desde el último paso.
 */
public final class OrquestadorSagaCompra {

    private static final Logger REGISTRO = Logger.getLogger(OrquestadorSagaCompra.class.getName());
    // Cada guardado renueva el arriendo; un paso con todos sus reintentos tarda bastante menos que esto.
    private static final Duration ARRIENDO = Duration.ofSeconds(60);

    private enum Tipo { OK, RECHAZO, NO_DISPONIBLE }

    private record Resultado(Tipo tipo, String código, String detalle) {}

    /** Contexto de una ejecución: el dueño del arriendo identifica a este proceso ante el repositorio. */
    private record Ejecución(Pedido pedido, SagaCompra saga, UUID propietario) {}

    private final RepositorioPedidos repositorio;
    private final ReservasInventario reservas;
    private final FidelizacionClientes fidelización;
    private final Clock reloj;
    private final int intentos;
    private final Duration espera;

    public OrquestadorSagaCompra(RepositorioPedidos repositorio, ReservasInventario reservas, FidelizacionClientes fidelización,
                                 Clock reloj, int intentos, Duration espera) {
        this.repositorio = repositorio;
        this.reservas = reservas;
        this.fidelización = fidelización;
        this.reloj = reloj;
        this.intentos = intentos;
        this.espera = espera;
    }

    /** Avanza la SAGA hasta terminarla o hasta que un servicio no responda; si otro proceso la tiene reclamada, no hace nada. */
    public void avanzar(UUID identificadorPedido) {
        var propietario = UUID.randomUUID();
        var ahora = reloj.instant();
        if (!repositorio.reclamar(identificadorPedido, propietario, ahora.plus(ARRIENDO), ahora)) return;
        try {
            var ejecución = new Ejecución(repositorio.pedido(identificadorPedido).orElseThrow(PedidoInexistente::new),
                    repositorio.saga(identificadorPedido).orElseThrow(PedidoInexistente::new), propietario);
            while (!ejecución.saga().terminada() && ejecutarPaso(ejecución)) {
                // Cada paso ya quedó persistido; se continúa con el siguiente.
            }
        } catch (ArrendamientoPerdido perdido) {
            REGISTRO.info("La SAGA del pedido " + identificadorPedido + " fue retomada por otro proceso.");
        } finally {
            repositorio.liberarReclamo(identificadorPedido, propietario);
        }
    }

    /** Reanudador: retoma en paralelo (hilos virtuales) las SAGA no terminadas cuyo próximo intento ya venció. */
    public void reanudarPendientes(int límite) {
        try (var hilos = Executors.newVirtualThreadPerTaskExecutor()) {
            for (UUID pedido : repositorio.sagasPendientes(reloj.instant(), límite)) {
                hilos.submit(() -> {
                    try {
                        avanzar(pedido);
                    } catch (RuntimeException error) {
                        REGISTRO.log(Level.WARNING, "No se pudo reanudar la SAGA del pedido " + pedido, error);
                    }
                });
            }
        }
    }

    /** Ejecuta el paso actual; devuelve true si la SAGA puede seguir avanzando ahora mismo. */
    private boolean ejecutarPaso(Ejecución e) {
        var pedido = e.pedido();
        var saga = e.saga();
        var claves = saga.claves();
        var id = pedido.identificador();
        switch (saga.paso()) {
            case RESERVAR -> {
                var resultado = intentar(() -> reservas.reservar(saga.identificadorReserva(), id, pedido.líneas(), claves.reserva()));
                return switch (resultado.tipo()) {
                    case OK -> continuar(e, Paso.ACREDITAR, "OK", "Stock reservado en Inventario");
                    case RECHAZO -> {
                        // Sin reserva no hay nada que compensar. El motivo refleja el rechazo real de Inventario.
                        pedido.cancelar("CONFLICTO_EXISTENCIAS".equals(resultado.código()) ? "STOCK_INSUFICIENTE" : "RESERVA_RECHAZADA", reloj.instant());
                        saga.avanzar(Paso.TERMINADA, "RECHAZADO", resultado.detalle(), reloj.instant());
                        guardar(e, "pedido_cancelado");
                        yield false;
                    }
                    case NO_DISPONIBLE -> esperarServicio(e, "INVENTARIO_NO_DISPONIBLE", resultado.detalle());
                };
            }
            case ACREDITAR -> {
                var resultado = intentar(() -> fidelización.acreditar(id, pedido.identificadorCliente(), pedido.total(), claves.acreditación()));
                if (resultado.tipo() == Tipo.OK) return continuar(e, Paso.CONSUMIR, "OK", "Puntos acreditados en Clientes");
                return compensar(e, resultado.tipo() == Tipo.RECHAZO ? "FIDELIZACION_RECHAZADA" : "CLIENTES_NO_DISPONIBLE", resultado.detalle());
            }
            case CONSUMIR -> {
                var resultado = intentar(() -> reservas.consumir(saga.identificadorReserva(), claves.consumo()));
                return switch (resultado.tipo()) {
                    case OK -> {
                        pedido.confirmar(reloj.instant());
                        saga.avanzar(Paso.TERMINADA, "OK", "Reserva consumida; pedido CONFIRMADO", reloj.instant());
                        guardar(e, "pedido_confirmado");
                        yield false;
                    }
                    case NO_DISPONIBLE -> esperarServicio(e, "CONFIRMACION_PENDIENTE", resultado.detalle());
                    // La reserva ya no se puede consumir: los puntos acreditados también deben revertirse.
                    case RECHAZO -> compensar(e, "RESERVA_NO_CONSUMIBLE", resultado.detalle());
                };
            }
            case COMPENSAR_RESERVA -> {
                var resultado = intentar(() -> reservas.liberar(saga.identificadorReserva(), claves.liberación()));
                if (resultado.tipo() == Tipo.NO_DISPONIBLE) return reintentarDespués(e, resultado.detalle());
                // Un rechazo aquí significa que no había reserva activa: la compensación no tiene efecto.
                return continuar(e, Paso.COMPENSAR_PUNTOS, resultado.tipo() == Tipo.OK ? "OK" : "SIN_EFECTO",
                        resultado.tipo() == Tipo.OK ? "Reserva liberada en Inventario" : resultado.detalle());
            }
            case COMPENSAR_PUNTOS -> {
                // Siempre se compensa: la acreditación pudo aplicarse aunque su respuesta se perdiera.
                var resultado = intentar(() -> fidelización.revertir(id, pedido.identificadorCliente(), claves.reversa()));
                if (resultado.tipo() == Tipo.NO_DISPONIBLE) return reintentarDespués(e, resultado.detalle());
                saga.avanzar(Paso.TERMINADA, resultado.tipo() == Tipo.OK ? "OK" : "SIN_EFECTO",
                        resultado.tipo() == Tipo.OK ? "Puntos revertidos o bloqueados en Clientes" : resultado.detalle(), reloj.instant());
                guardar(e, null);
                return false;
            }
            case TERMINADA -> { return false; }
        }
        return false;
    }

    /** Cancela el pedido y empieza las compensaciones (liberar reserva y revertir puntos). */
    private boolean compensar(Ejecución e, String motivo, String detalle) {
        e.pedido().cancelar(motivo, reloj.instant());
        e.saga().avanzar(Paso.COMPENSAR_RESERVA, "FALLO", detalle, reloj.instant());
        guardar(e, "pedido_cancelado");
        return true;
    }

    private boolean continuar(Ejecución e, Paso siguiente, String resultado, String detalle) {
        e.pedido().reanudar(reloj.instant());
        e.saga().avanzar(siguiente, resultado, detalle, reloj.instant());
        guardar(e, null);
        return true;
    }

    private boolean esperarServicio(Ejecución e, String motivo, String detalle) {
        e.pedido().ponerEnRevisión(motivo, reloj.instant());
        return reintentarDespués(e, detalle);
    }

    private boolean reintentarDespués(Ejecución e, String detalle) {
        e.saga().fallóTemporalmente(detalle, reloj.instant());
        guardar(e, null);
        return false;
    }

    private void guardar(Ejecución e, String tipoEvento) {
        Optional<EventoVenta> evento = Optional.ofNullable(tipoEvento)
                .map(tipo -> new EventoVenta(tipo, e.pedido().identificador(), RepresentacionPedido.pedido(e.pedido())));
        repositorio.guardar(e.pedido(), e.saga(), evento, e.propietario(), reloj.instant().plus(ARRIENDO));
    }

    /** Reintentos cortos dentro de la misma solicitud; si persiste la falla, el reanudador continúa más tarde. */
    private Resultado intentar(Runnable acción) {
        for (int intento = 1; ; intento++) {
            try {
                acción.run();
                return new Resultado(Tipo.OK, null, null);
            } catch (RechazoDefinitivo rechazo) {
                return new Resultado(Tipo.RECHAZO, rechazo.código(), rechazo.código() + ": " + rechazo.getMessage());
            } catch (RuntimeException caída) {
                // Cualquier otra falla (red, respuesta ilegible, error inesperado del adaptador) se trata como temporal.
                if (!(caída instanceof ServicioNoDisponible)) REGISTRO.log(Level.WARNING, "Falla inesperada en un paso de la SAGA", caída);
                if (intento >= intentos) return new Resultado(Tipo.NO_DISPONIBLE, null, caída.getMessage());
                dormir(espera.multipliedBy(intento));
            }
        }
    }

    private static void dormir(Duration duración) {
        try {
            Thread.sleep(duración);
        } catch (InterruptedException interrupción) {
            Thread.currentThread().interrupt();
            throw new ServicioNoDisponible("La espera entre reintentos fue interrumpida.");
        }
    }
}
