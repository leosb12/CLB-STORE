package clb.ventas.aplicacion;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import clb.ventas.aplicacion.Errores.ComprobanteNoDisponible;
import clb.ventas.aplicacion.Errores.PedidoInexistente;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioComprobantes;
import clb.ventas.dominio.Cantidad;
import clb.ventas.dominio.Comprobante;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import clb.ventas.dominio.ReglaDePedidoIncumplida;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Comprobante de venta: solo para pedidos confirmados, uno por pedido y visible solo para su titular o un admin. */
class ComprobantesDeVentaTest {

    private static final Instant AHORA = Instant.parse("2026-10-22T12:00:00Z");
    private static final byte[] XLSX = clb.ventas.dominio.ComprobanteTest.xlsx("base");

    private final DoblesDePrueba.Repositorio pedidos = new DoblesDePrueba.Repositorio();
    private final Map<UUID, Comprobante> guardados = new HashMap<>();
    private final ComprobantesDeVenta casos = new ComprobantesDeVenta(pedidos, new RepositorioComprobantes() {
        @Override public boolean registrar(Comprobante c) { return guardados.putIfAbsent(c.identificadorPedido(), c) == null; }
        @Override public Optional<Comprobante> comprobante(UUID pedido) { return Optional.ofNullable(guardados.get(pedido)); }
        @Override public boolean existe(UUID pedido) { return guardados.containsKey(pedido); }
    }, Clock.fixed(AHORA, ZoneOffset.UTC));

    private Pedido pedido(boolean confirmado) {
        var línea = new LineaPedido(new CopiaProducto(UUID.randomUUID(), "a".repeat(32), "CLB-M", "Camiseta", "Camisetas", "M", "Negro",
                Dinero.deDecimal("100.00")), new Cantidad(1));
        var pedido = Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), List.of(línea), AHORA);
        if (confirmado) pedido.confirmar(AHORA);
        pedidos.registrar(pedido, SagaCompra.iniciar(pedido.identificador(), AHORA), UUID.randomUUID(), "a".repeat(64));
        return pedido;
    }

    @Test
    void registra_una_vez_y_un_reintento_devuelve_el_primero() {
        var pedido = pedido(true);
        assertFalse(casos.disponible(pedido.identificador()));
        assertTrue(casos.registrar(pedido.identificador(), "c.xlsx", Comprobante.XLSX, XLSX, "clb-n8n").nuevo());
        var repetido = casos.registrar(pedido.identificador(), "c.xlsx", Comprobante.XLSX, clb.ventas.dominio.ComprobanteTest.xlsx("v9"), "clb-n8n");
        assertFalse(repetido.nuevo());
        assertArrayEquals(XLSX, repetido.comprobante().contenido());
        assertTrue(casos.disponible(pedido.identificador()));
    }

    @Test
    void un_pedido_no_confirmado_o_inexistente_no_tiene_comprobante() {
        var pendiente = pedido(false);
        assertThrows(ReglaDePedidoIncumplida.class, () -> casos.registrar(pendiente.identificador(), "c.xlsx", Comprobante.XLSX, XLSX, "clb-n8n"));
        assertThrows(PedidoInexistente.class, () -> casos.registrar(UUID.randomUUID(), "c.xlsx", Comprobante.XLSX, XLSX, "clb-n8n"));
    }

    @Test
    void solo_el_titular_o_un_admin_lo_descargan() {
        var pedido = pedido(true);
        assertThrows(ComprobanteNoDisponible.class, () -> casos.descargar(pedido.identificador(), pedido.identificadorCliente(), false));
        casos.registrar(pedido.identificador(), "c.xlsx", Comprobante.XLSX, XLSX, "clb-n8n");
        assertArrayEquals(XLSX, casos.descargar(pedido.identificador(), pedido.identificadorCliente(), false).contenido());
        assertArrayEquals(XLSX, casos.descargar(pedido.identificador(), UUID.randomUUID(), true).contenido());
        assertThrows(PedidoInexistente.class, () -> casos.descargar(pedido.identificador(), UUID.randomUUID(), false));
    }
}
