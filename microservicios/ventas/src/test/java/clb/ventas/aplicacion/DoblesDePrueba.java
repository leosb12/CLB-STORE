package clb.ventas.aplicacion;

import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import clb.ventas.aplicacion.puertos.Puertos.CatalogoInventario;
import clb.ventas.aplicacion.puertos.Puertos.EventoPublicado;
import clb.ventas.aplicacion.puertos.Puertos.EventoVenta;
import clb.ventas.aplicacion.puertos.Puertos.FidelizacionClientes;
import clb.ventas.aplicacion.puertos.Puertos.RegistroIdempotencia;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.aplicacion.puertos.Puertos.ReservasInventario;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Dobles de los puertos: simulan participantes reales con idempotencia por clave, caídas y respuestas perdidas. */
final class DoblesDePrueba {

    private DoblesDePrueba() {}

    static final class Catálogo implements CatalogoInventario {
        final Map<UUID, CopiaProducto> variantes = new HashMap<>();

        UUID agregar(String precio) {
            var id = UUID.randomUUID();
            variantes.put(id, new CopiaProducto(id, "p".repeat(32), "SKU-" + id.toString().substring(0, 6), "Polera", "Poleras", "L", "Azul", Dinero.deDecimal(precio)));
            return id;
        }

        @Override
        public List<CopiaProducto> copias(List<UUID> identificadores) {
            return identificadores.stream().map(variante -> {
                var copia = variantes.get(variante);
                if (copia == null) throw new RechazoDefinitivo("VARIANTE_NO_DISPONIBLE", "La variante no está disponible.");
                return copia;
            }).toList();
        }
    }

    /** Inventario: stock por variante, reservas idempotentes por clave y fallas configurables. */
    static final class Inventario implements ReservasInventario {
        final Map<UUID, Integer> disponible = new HashMap<>();
        final Map<UUID, String> reservas = new HashMap<>();
        final Set<UUID> clavesAplicadas = new HashSet<>();
        boolean caído;
        boolean consumoCaído;
        boolean consumoRechazado;
        String códigoRechazoReserva = "CONFLICTO_EXISTENCIAS";
        int perderRespuestas;

        @Override
        public void reservar(UUID reserva, UUID pedido, List<LineaPedido> líneas, UUID clave) {
            if (caído) throw new ServicioNoDisponible("Inventario no responde.");
            if (clavesAplicadas.add(clave)) {
                for (var línea : líneas) {
                    if (disponible.getOrDefault(línea.producto().identificadorVariante(), 0) < línea.cantidad().valor()) {
                        clavesAplicadas.remove(clave);
                        throw new RechazoDefinitivo(códigoRechazoReserva, "Variante inactiva o disponibilidad insuficiente.");
                    }
                }
                líneas.forEach(línea -> disponible.merge(línea.producto().identificadorVariante(), -línea.cantidad().valor(), Integer::sum));
                reservas.put(reserva, "ACTIVA");
            }
            perderRespuesta();
        }

        @Override
        public void consumir(UUID reserva, UUID clave) {
            if (consumoCaído) throw new ServicioNoDisponible("Inventario no responde al consumir.");
            if (consumoRechazado) throw new RechazoDefinitivo("CONFLICTO_EXISTENCIAS", "La reserva está LIBERADA; no permite CONSUMIDA.");
            terminar(reserva, "CONSUMIDA");
        }

        @Override
        public void liberar(UUID reserva, UUID clave) {
            if (caído) throw new ServicioNoDisponible("Inventario no responde.");
            if (!reservas.containsKey(reserva)) throw new RechazoDefinitivo("HTTP_404", "La reserva no existe.");
            reservas.put(reserva, "LIBERADA");
        }

        private void terminar(UUID reserva, String estado) {
            if (caído) throw new ServicioNoDisponible("Inventario no responde.");
            reservas.put(reserva, estado);
        }

        private void perderRespuesta() {
            if (perderRespuestas > 0) {
                perderRespuestas--;
                throw new ServicioNoDisponible("Se perdió la respuesta de Inventario.");
            }
        }
    }

    /** Clientes: acreditación única por pedido; una reversa previa bloquea la acreditación tardía. */
    static final class Clientes implements FidelizacionClientes {
        final Map<UUID, Long> puntos = new HashMap<>();
        final Set<UUID> revertidos = new HashSet<>();
        boolean caído;
        int llamadasAcreditar;

        @Override
        public void acreditar(UUID pedido, UUID cliente, Dinero total, UUID clave) {
            llamadasAcreditar++;
            if (caído) throw new ServicioNoDisponible("Clientes no responde.");
            if (revertidos.contains(pedido)) throw new RechazoDefinitivo("PEDIDO_REVERTIDO", "El pedido ya fue revertido.");
            puntos.putIfAbsent(pedido, total.centavos() / 1000);
        }

        @Override
        public void revertir(UUID pedido, UUID cliente, UUID clave) {
            if (caído) throw new ServicioNoDisponible("Clientes no responde.");
            revertidos.add(pedido);
            puntos.remove(pedido);
        }
    }

    /** Repositorio en memoria con las mismas garantías de unicidad y arrendamiento que PostgreSQL. */
    static final class Repositorio implements RepositorioPedidos {
        final Map<UUID, RegistroIdempotencia> claves = new HashMap<>();
        final Map<UUID, Pedido> pedidos = new HashMap<>();
        final Map<UUID, String> huellas = new HashMap<>();
        final Map<UUID, SagaCompra> sagas = new HashMap<>();
        final Map<UUID, Instant> reclamos = new HashMap<>();
        final Map<UUID, UUID> dueños = new HashMap<>();
        final List<EventoPublicado> eventos = new ArrayList<>();

        @Override public List<UUID> pedidosDelCliente(UUID cliente, UUID antes, int límite) {
            var ordenados = pedidos.values().stream().filter(p -> p.identificadorCliente().equals(cliente))
                    .sorted(java.util.Comparator.comparing(Pedido::fechaCreación).thenComparing(p -> p.identificador().toString()).reversed())
                    .map(Pedido::identificador).toList();
            int inicio = antes == null ? 0 : ordenados.indexOf(antes) + 1;
            if (antes != null && inicio == 0) return List.of();
            return ordenados.stream().skip(inicio).limit(límite).toList();
        }

        @Override public Optional<RegistroIdempotencia> clave(UUID clave) { return Optional.ofNullable(claves.get(clave)); }
        @Override public Optional<String> huellaDelPedido(UUID pedido) { return Optional.ofNullable(huellas.get(pedido)); }
        @Override public Optional<Pedido> pedido(UUID id) { return Optional.ofNullable(pedidos.get(id)); }
        @Override public Optional<SagaCompra> saga(UUID id) { return Optional.ofNullable(sagas.get(id)); }

        @Override
        public synchronized boolean registrar(Pedido pedido, SagaCompra saga, UUID clave, String huella) {
            if (pedidos.containsKey(pedido.identificador()) || claves.containsKey(clave)) return false;
            pedidos.put(pedido.identificador(), pedido);
            huellas.put(pedido.identificador(), huella);
            sagas.put(pedido.identificador(), saga);
            claves.put(clave, new RegistroIdempotencia(clave, huella, pedido.identificador()));
            saga.marcarPersistida();
            return true;
        }

        @Override
        public synchronized boolean registrarClave(UUID clave, String huella, UUID pedido) {
            if (claves.containsKey(clave)) return false;
            claves.put(clave, new RegistroIdempotencia(clave, huella, pedido));
            return true;
        }

        @Override
        public synchronized void guardar(Pedido pedido, SagaCompra saga, Optional<EventoVenta> evento, UUID propietario, Instant renovarHasta) {
            if (!propietario.equals(dueños.get(saga.identificadorPedido()))) throw new Errores.ArrendamientoPerdido();
            reclamos.put(saga.identificadorPedido(), renovarHasta);
            evento.ifPresent(e -> eventos.add(new EventoPublicado(eventos.size() + 1, e.tipo(), e.identificadorPedido(), e.datos(), Instant.now())));
            saga.marcarPersistida();
        }

        @Override
        public synchronized boolean reclamar(UUID pedido, UUID propietario, Instant hasta, Instant ahora) {
            var actual = reclamos.get(pedido);
            if (actual != null && !actual.isBefore(ahora)) return false;
            reclamos.put(pedido, hasta);
            dueños.put(pedido, propietario);
            return true;
        }

        @Override
        public synchronized void liberarReclamo(UUID pedido, UUID propietario) {
            if (propietario.equals(dueños.get(pedido))) {
                reclamos.remove(pedido);
                dueños.remove(pedido);
            }
        }

        @Override
        public List<UUID> sagasPendientes(Instant ahora, int límite) {
            return sagas.values().stream().filter(s -> !s.terminada() && !s.próximoIntento().isAfter(ahora))
                    .map(SagaCompra::identificadorPedido).limit(límite).toList();
        }

        @Override
        public List<EventoPublicado> eventosDesde(long desde, int límite) {
            return eventos.stream().filter(e -> e.identificador() > desde).limit(límite).toList();
        }
    }
}
