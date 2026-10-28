package clb.ventas.dominio;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Reglas del agregado Pedido, sin Spring ni base de datos. */
class PedidoTest {

    private static final Instant AHORA = Instant.parse("2026-10-22T12:00:00Z");

    static LineaPedido línea(String precio, int cantidad) {
        return new LineaPedido(new CopiaProducto(UUID.randomUUID(), "a".repeat(32), "CLB-M-NEGRO", "Camiseta básica", "Camisetas",
                "M", "Negro", Dinero.deDecimal(precio)), new Cantidad(cantidad));
    }

    @Test
    void total_es_la_suma_exacta_de_subtotales_en_centavos() {
        var pedido = Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), List.of(línea("149.90", 2), línea("0.10", 3)), AHORA);
        assertEquals(new Dinero(30_010), pedido.total());
        assertEquals("300.10", pedido.total().decimal());
        assertEquals(EstadoPedido.PENDIENTE, pedido.estado());
    }

    @Test
    void exige_entre_1_y_50_lineas_sin_variantes_repetidas() {
        assertThrows(ReglaDePedidoIncumplida.class, () -> Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), List.of(), AHORA));
        var muchas = Collections.nCopies(51, (LineaPedido) null).stream().map(nada -> línea("1", 1)).toList();
        assertThrows(ReglaDePedidoIncumplida.class, () -> Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), muchas, AHORA));
        var repetida = línea("10", 1);
        assertThrows(ReglaDePedidoIncumplida.class, () -> Pedido.crear(UUID.randomUUID(), UUID.randomUUID(),
                List.of(repetida, new LineaPedido(repetida.producto(), new Cantidad(2))), AHORA));
    }

    @Test
    void dinero_y_cantidad_rechazan_valores_invalidos() {
        assertThrows(ReglaDePedidoIncumplida.class, () -> Dinero.deDecimal("1.999"));
        assertThrows(ReglaDePedidoIncumplida.class, () -> Dinero.deDecimal("-1"));
        assertThrows(ReglaDePedidoIncumplida.class, () -> new Cantidad(0));
        assertThrows(ArithmeticException.class, () -> new Dinero(Long.MAX_VALUE).sumar(new Dinero(1)));
    }

    @Test
    void solo_un_pedido_abierto_cambia_de_estado() {
        var pedido = Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), List.of(línea("50", 1)), AHORA);
        pedido.ponerEnRevisión("INVENTARIO_NO_DISPONIBLE", AHORA);
        pedido.confirmar(AHORA.plusSeconds(5));
        assertTrue(pedido.terminado());
        assertEquals(EstadoPedido.CONFIRMADO, pedido.estado());
        assertThrows(ReglaDePedidoIncumplida.class, () -> pedido.cancelar("TARDE", AHORA));
    }
}
