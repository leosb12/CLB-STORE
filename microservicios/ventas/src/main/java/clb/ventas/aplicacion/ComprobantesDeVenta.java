package clb.ventas.aplicacion;

import clb.ventas.aplicacion.Errores.ComprobanteNoDisponible;
import clb.ventas.aplicacion.Errores.PedidoInexistente;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioComprobantes;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.dominio.Comprobante;
import clb.ventas.dominio.EstadoPedido;
import clb.ventas.dominio.ReglaDePedidoIncumplida;
import java.time.Clock;
import java.util.UUID;

/** Casos de uso del comprobante de venta: lo registra la automatización (n8n) y lo descarga el titular del pedido. */
public final class ComprobantesDeVenta {

    public record Registro(Comprobante comprobante, boolean nuevo) {}

    private final RepositorioPedidos pedidos;
    private final RepositorioComprobantes comprobantes;
    private final Clock reloj;

    public ComprobantesDeVenta(RepositorioPedidos pedidos, RepositorioComprobantes comprobantes, Clock reloj) {
        this.pedidos = pedidos;
        this.comprobantes = comprobantes;
        this.reloj = reloj;
    }

    /** Idempotente por pedido: un reintento devuelve el comprobante ya registrado, sin reemplazarlo. */
    public Registro registrar(UUID pedido, String nombre, String tipo, byte[] contenido, String generadoPor) {
        var existente = pedidos.pedido(pedido).orElseThrow(PedidoInexistente::new);
        if (existente.estado() != EstadoPedido.CONFIRMADO) throw new ReglaDePedidoIncumplida("Solo un pedido confirmado tiene comprobante.");
        boolean nuevo = comprobantes.registrar(new Comprobante(pedido, nombre, tipo, contenido, generadoPor, reloj.instant()));
        return new Registro(comprobantes.comprobante(pedido).orElseThrow(), nuevo);
    }

    /** Igual que la consulta del pedido: uno ajeno responde como inexistente. */
    public Comprobante descargar(UUID pedido, UUID solicitante, boolean administrador) {
        var existente = pedidos.pedido(pedido).orElseThrow(PedidoInexistente::new);
        if (!administrador && !existente.identificadorCliente().equals(solicitante)) throw new PedidoInexistente();
        return comprobantes.comprobante(pedido).orElseThrow(ComprobanteNoDisponible::new);
    }

    public boolean disponible(UUID pedido) {
        return comprobantes.existe(pedido);
    }
}
