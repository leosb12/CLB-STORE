package clb.ventas.aplicacion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import clb.ventas.aplicacion.ConfirmarPedido.LineaSolicitada;
import clb.ventas.aplicacion.ConfirmarPedido.SolicitudPedido;
import clb.ventas.aplicacion.Errores.ConflictoDeIdempotencia;
import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.SagaCompra.Paso;
import clb.ventas.dominio.EstadoPedido;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** SAGA de compra entre Ventas, Inventario y Clientes con dobles de los participantes. */
class SagaCompraTest {

    /** Reloj controlable para probar la espera exponencial del reanudador. */
    static final class Reloj extends Clock {
        Instant ahora = Instant.parse("2026-10-22T12:00:00Z");
        void avanzar(Duration duración) { ahora = ahora.plus(duración); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zona) { return this; }
        @Override public Instant instant() { return ahora; }
    }

    private final Reloj reloj = new Reloj();
    private final DoblesDePrueba.Catálogo catálogo = new DoblesDePrueba.Catálogo();
    private final DoblesDePrueba.Inventario inventario = new DoblesDePrueba.Inventario();
    private final DoblesDePrueba.Clientes clientes = new DoblesDePrueba.Clientes();
    private final DoblesDePrueba.Repositorio repositorio = new DoblesDePrueba.Repositorio();
    private OrquestadorSagaCompra orquestador;
    private ConfirmarPedido confirmar;
    private UUID variante;

    @BeforeEach
    void preparar() {
        orquestador = new OrquestadorSagaCompra(repositorio, inventario, clientes, reloj, 3, Duration.ZERO);
        confirmar = new ConfirmarPedido(repositorio, catálogo, orquestador, reloj);
        variante = catálogo.agregar("120.00");
        inventario.disponible.put(variante, 5);
    }

    private SolicitudPedido solicitud(int cantidad) {
        return new SolicitudPedido(UUID.randomUUID(), UUID.randomUUID(), List.of(new LineaSolicitada(variante, cantidad)));
    }

    private EstadoPedido estado(SolicitudPedido solicitud) {
        return repositorio.pedidos.get(solicitud.identificador()).estado();
    }

    private Paso paso(SolicitudPedido solicitud) {
        return repositorio.sagas.get(solicitud.identificador()).paso();
    }

    @Test
    void compra_completa_entre_tres_servicios() {
        var solicitud = solicitud(2);
        var vista = confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals("CONFIRMADO", vista.get("estado"));
        assertEquals("240.00", vista.get("total"));
        assertEquals(3, inventario.disponible.get(variante));
        assertEquals(24L, clientes.puntos.get(solicitud.identificador()));
        assertEquals(List.of("pedido_confirmado"), repositorio.eventos.stream().map(e -> e.tipo()).toList());
        var pasos = repositorio.sagas.get(solicitud.identificador()).historial().stream().map(r -> r.paso() + ":" + r.resultado()).toList();
        assertEquals(List.of("RESERVAR:INICIADA", "RESERVAR:OK", "ACREDITAR:OK", "CONSUMIR:OK"), pasos);
    }

    @Test
    void stock_insuficiente_cancela_sin_tocar_clientes() {
        var solicitud = solicitud(9);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals(EstadoPedido.CANCELADO, estado(solicitud));
        assertEquals("STOCK_INSUFICIENTE", repositorio.pedidos.get(solicitud.identificador()).motivo());
        assertEquals(0, clientes.llamadasAcreditar);
        assertEquals(5, inventario.disponible.get(variante));
        assertEquals(List.of("pedido_cancelado"), repositorio.eventos.stream().map(e -> e.tipo()).toList());
    }

    @Test
    void falla_de_clientes_compensa_liberando_reserva_y_revierte_puntos_al_volver() {
        clientes.caído = true;
        var solicitud = solicitud(1);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals(EstadoPedido.CANCELADO, estado(solicitud));
        assertEquals("CLIENTES_NO_DISPONIBLE", repositorio.pedidos.get(solicitud.identificador()).motivo());
        assertEquals("LIBERADA", inventario.reservas.values().iterator().next());
        // La reversa de puntos queda pendiente mientras Clientes siga caído.
        assertEquals(Paso.COMPENSAR_PUNTOS, paso(solicitud));
        clientes.caído = false;
        reloj.avanzar(Duration.ofSeconds(5));
        orquestador.reanudarPendientes(10);
        assertEquals(Paso.TERMINADA, paso(solicitud));
        assertTrue(clientes.revertidos.contains(solicitud.identificador()));
    }

    @Test
    void respuesta_perdida_se_reintenta_con_la_misma_clave_sin_doble_reserva() {
        inventario.perderRespuestas = 1;
        var solicitud = solicitud(2);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals(EstadoPedido.CONFIRMADO, estado(solicitud));
        assertEquals(3, inventario.disponible.get(variante));
        assertEquals(1, inventario.reservas.size());
    }

    @Test
    void misma_clave_o_mismo_pedido_no_duplican_y_otra_solicitud_es_conflicto() {
        var clave = UUID.randomUUID();
        var solicitud = solicitud(1);
        var primera = confirmar.ejecutar(clave, solicitud);
        assertEquals(primera, confirmar.ejecutar(clave, solicitud));
        // Reenvío del mismo pedido desde la cola offline con otra clave.
        assertEquals(primera, confirmar.ejecutar(UUID.randomUUID(), solicitud));
        assertEquals(1, repositorio.pedidos.size());
        assertEquals(1, repositorio.eventos.size());
        assertEquals(4, inventario.disponible.get(variante));
        assertThrows(ConflictoDeIdempotencia.class, () -> confirmar.ejecutar(clave, solicitud(2)));
        assertThrows(ConflictoDeIdempotencia.class, () -> confirmar.ejecutar(UUID.randomUUID(),
                new SolicitudPedido(solicitud.identificador(), solicitud.identificadorCliente(), List.of(new LineaSolicitada(variante, 2)))));
    }

    @Test
    void inventario_caido_al_consumir_queda_en_revision_y_el_reanudador_confirma() {
        var segunda = solicitud(1);
        // Inventario reserva bien, pero cae justo al consumir (después de que Clientes acreditó).
        inventario.consumoCaído = true;
        confirmar.ejecutar(UUID.randomUUID(), segunda);
        assertEquals(EstadoPedido.EN_REVISION, estado(segunda));
        assertEquals("CONFIRMACION_PENDIENTE", repositorio.pedidos.get(segunda.identificador()).motivo());
        // Antes de vencer la espera exponencial no se reintenta.
        orquestador.reanudarPendientes(10);
        assertEquals(EstadoPedido.EN_REVISION, estado(segunda));
        inventario.consumoCaído = false;
        reloj.avanzar(Duration.ofSeconds(3));
        orquestador.reanudarPendientes(10);
        assertEquals(EstadoPedido.CONFIRMADO, estado(segunda));
    }

    @Test
    void reserva_no_consumible_compensa_puntos_y_reserva() {
        inventario.consumoRechazado = true;
        var solicitud = solicitud(1);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals(EstadoPedido.CANCELADO, estado(solicitud));
        assertEquals("RESERVA_NO_CONSUMIBLE", repositorio.pedidos.get(solicitud.identificador()).motivo());
        assertEquals(Paso.TERMINADA, paso(solicitud));
        assertTrue(clientes.revertidos.contains(solicitud.identificador()), "Los puntos acreditados deben revertirse.");
        assertTrue(clientes.puntos.isEmpty());
    }

    @Test
    void el_motivo_de_cancelacion_refleja_el_rechazo_real_de_inventario() {
        inventario.códigoRechazoReserva = "HTTP_404";
        var solicitud = solicitud(9);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals("RESERVA_RECHAZADA", repositorio.pedidos.get(solicitud.identificador()).motivo());
    }

    @Test
    void al_recuperarse_inventario_el_pedido_sale_de_revision_y_se_confirma() {
        inventario.caído = true;
        var solicitud = solicitud(1);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        assertEquals(EstadoPedido.EN_REVISION, estado(solicitud));
        assertEquals("INVENTARIO_NO_DISPONIBLE", repositorio.pedidos.get(solicitud.identificador()).motivo());
        inventario.caído = false;
        reloj.avanzar(Duration.ofSeconds(3));
        orquestador.reanudarPendientes(10);
        assertEquals(EstadoPedido.CONFIRMADO, estado(solicitud));
        assertEquals(null, repositorio.pedidos.get(solicitud.identificador()).motivo());
    }

    @Test
    void otra_clave_del_mismo_pedido_queda_asociada_y_no_se_puede_reutilizar() {
        var solicitud = solicitud(1);
        confirmar.ejecutar(UUID.randomUUID(), solicitud);
        var otra = UUID.randomUUID();
        confirmar.ejecutar(otra, solicitud);
        assertThrows(ConflictoDeIdempotencia.class, () -> confirmar.ejecutar(otra, solicitud(2)));
        assertEquals(1, repositorio.pedidos.size());
    }

    @Test
    void variante_inexistente_no_crea_pedido() {
        var solicitud = new SolicitudPedido(UUID.randomUUID(), UUID.randomUUID(), List.of(new LineaSolicitada(UUID.randomUUID(), 1)));
        assertThrows(RechazoDefinitivo.class, () -> confirmar.ejecutar(UUID.randomUUID(), solicitud));
        assertTrue(repositorio.pedidos.isEmpty());
    }
}
