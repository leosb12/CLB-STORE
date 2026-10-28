package clb.ventas.aplicacion.puertos;

import clb.ventas.aplicacion.SagaCompra;
import clb.ventas.dominio.Comprobante;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Puertos de la aplicación: el dominio y los casos de uso dependen de estas abstracciones, nunca de Spring, JDBC ni HTTP.
 * Los adaptadores REST lanzan Errores.ServicioNoDisponible o Errores.RechazoDefinitivo.
 */
public final class Puertos {

    private Puertos() {}

    public interface CatalogoInventario {
        /** Copia actual de cada variante, en el mismo orden; reutiliza el producto compartido entre tallas y colores. */
        List<CopiaProducto> copias(List<UUID> identificadoresVariante);
    }

    public interface ReservasInventario {
        void reservar(UUID reserva, UUID pedido, List<LineaPedido> líneas, UUID clave);
        void consumir(UUID reserva, UUID clave);
        void liberar(UUID reserva, UUID clave);
    }

    public interface FidelizacionClientes {
        void acreditar(UUID pedido, UUID cliente, Dinero total, UUID clave);
        void revertir(UUID pedido, UUID cliente, UUID clave);
    }

    public record RegistroIdempotencia(UUID clave, String huella, UUID identificadorPedido) {}

    public record EventoVenta(String tipo, UUID identificadorPedido, Map<String, Object> datos) {}

    public record EventoPublicado(long identificador, String tipo, UUID identificadorPedido, Map<String, Object> datos, Instant fecha) {}

    public interface RepositorioPedidos {
        List<UUID> pedidosDelCliente(UUID cliente, UUID antes, int límite);
        Optional<RegistroIdempotencia> clave(UUID clave);
        Optional<String> huellaDelPedido(UUID pedido);
        Optional<Pedido> pedido(UUID identificador);
        Optional<SagaCompra> saga(UUID identificadorPedido);
        /** Inserta pedido, SAGA y clave en una transacción; false si la clave o el pedido ya existían. */
        boolean registrar(Pedido pedido, SagaCompra saga, UUID clave, String huella);
        /** Asocia otra Idempotency-Key a un pedido existente; false si la clave ya pertenecía a otra solicitud. */
        boolean registrarClave(UUID clave, String huella, UUID identificadorPedido);
        /**
         * Guarda pedido, SAGA, historial nuevo y evento (outbox) en una transacción, renueva el arriendo y marca la SAGA
         * como persistida. Lanza ArrendamientoPerdido sin aplicar nada si el proceso ya no es el dueño.
         */
        void guardar(Pedido pedido, SagaCompra saga, Optional<EventoVenta> evento, UUID propietario, Instant renovarHasta);
        /** Arrendamiento: solo un proceso avanza una SAGA a la vez; vence solo si el proceso cae. */
        boolean reclamar(UUID identificadorPedido, UUID propietario, Instant hasta, Instant ahora);
        void liberarReclamo(UUID identificadorPedido, UUID propietario);
        List<UUID> sagasPendientes(Instant ahora, int límite);
        List<EventoPublicado> eventosDesde(long desde, int límite);
    }

    public interface RepositorioComprobantes {
        /** Inserta el comprobante si el pedido aún no tiene uno; false si ya existía (no se reemplaza). */
        boolean registrar(Comprobante comprobante);
        Optional<Comprobante> comprobante(UUID identificadorPedido);
        boolean existe(UUID identificadorPedido);
    }
}
