package clb.ventas.aplicacion;

import clb.ventas.aplicacion.Errores.ConflictoDeIdempotencia;
import clb.ventas.aplicacion.Errores.PedidoInexistente;
import clb.ventas.aplicacion.puertos.Puertos.CatalogoInventario;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.dominio.Cantidad;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import clb.ventas.dominio.ReglaDePedidoIncumplida;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/** Caso de uso CU03.4: confirmar un pedido de forma idempotente e iniciar la SAGA de compra. */
public final class ConfirmarPedido {

    public record LineaSolicitada(UUID identificadorVariante, int cantidad) {}

    public record SolicitudPedido(UUID identificador, UUID identificadorCliente, List<LineaSolicitada> líneas) {
        /** Huella independiente del orden de las líneas: el mismo pedido reordenado es la misma solicitud. */
        String huella() {
            String canónica = identificador + "|" + identificadorCliente + "|" + líneas.stream()
                    .sorted(Comparator.comparing(LineaSolicitada::identificadorVariante))
                    .map(línea -> línea.identificadorVariante() + ":" + línea.cantidad())
                    .collect(Collectors.joining(","));
            try {
                return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canónica.getBytes(StandardCharsets.UTF_8)));
            } catch (NoSuchAlgorithmException imposible) {
                throw new IllegalStateException(imposible);
            }
        }
    }

    private final RepositorioPedidos repositorio;
    private final CatalogoInventario catálogo;
    private final OrquestadorSagaCompra orquestador;
    private final Clock reloj;

    public ConfirmarPedido(RepositorioPedidos repositorio, CatalogoInventario catálogo, OrquestadorSagaCompra orquestador, Clock reloj) {
        this.repositorio = repositorio;
        this.catálogo = catálogo;
        this.orquestador = orquestador;
        this.reloj = reloj;
    }

    public Map<String, Object> ejecutar(UUID clave, SolicitudPedido solicitud) {
        String huella = solicitud.huella();
        var previo = repositorio.clave(clave);
        if (previo.isPresent()) {
            if (!previo.get().huella().equals(huella)) throw new ConflictoDeIdempotencia("Esta Idempotency-Key ya se utilizó con otra solicitud. No se aplicó ningún cambio.");
            return continuar(previo.get().identificadorPedido());
        }
        var huellaExistente = repositorio.huellaDelPedido(solicitud.identificador());
        if (huellaExistente.isPresent()) {
            if (!huellaExistente.get().equals(huella)) throw new ConflictoDeIdempotencia("El identificador del pedido ya pertenece a otra solicitud.");
            // Mismo pedido con otra clave (p. ej., reenvío desde la cola offline): no se crea otro, y la clave queda
            // asociada para que no pueda reutilizarse con otra solicitud.
            if (!repositorio.registrarClave(clave, huella, solicitud.identificador())) return ejecutar(clave, solicitud);
            return continuar(solicitud.identificador());
        }
        // Se validan las cantidades y el tamaño antes de consultar a Inventario.
        if (solicitud.líneas().isEmpty() || solicitud.líneas().size() > Pedido.MÁXIMO_LÍNEAS) {
            throw new ReglaDePedidoIncumplida("El pedido requiere entre 1 y " + Pedido.MÁXIMO_LÍNEAS + " líneas.");
        }
        var cantidades = solicitud.líneas().stream().map(línea -> new Cantidad(línea.cantidad())).toList();
        // El precio lo fija el servidor con la copia actual del catálogo, nunca el carrito del dispositivo.
        var copias = catálogo.copias(solicitud.líneas().stream().map(LineaSolicitada::identificadorVariante).toList());
        List<LineaPedido> líneas = new ArrayList<>();
        for (int i = 0; i < cantidades.size(); i++) líneas.add(new LineaPedido(copias.get(i), cantidades.get(i)));
        var ahora = reloj.instant();
        var pedido = Pedido.crear(solicitud.identificador(), solicitud.identificadorCliente(), líneas, ahora);
        if (!repositorio.registrar(pedido, SagaCompra.iniciar(pedido.identificador(), ahora), clave, huella)) {
            // Otra solicitud registró la misma clave o el mismo pedido en paralelo: ahora es una repetición.
            return ejecutar(clave, solicitud);
        }
        return continuar(pedido.identificador());
    }

    /** Un cliente solo ve sus pedidos: uno ajeno responde como inexistente, sin revelar que existe. */
    public List<Map<String, Object>> listar(UUID solicitante, UUID antes, int límite) {
        return repositorio.pedidosDelCliente(solicitante, antes, límite).stream()
                .map(id -> consultar(id, solicitante, false)).toList();
    }

    /** Un cliente solo ve sus pedidos: uno ajeno responde como inexistente, sin revelar que existe. */
    public Map<String, Object> consultar(UUID identificador, UUID solicitante, boolean administrador) {
        var pedido = repositorio.pedido(identificador).orElseThrow(PedidoInexistente::new);
        if (!administrador && !pedido.identificadorCliente().equals(solicitante)) throw new PedidoInexistente();
        return consultar(identificador);
    }

    private Map<String, Object> consultar(UUID identificador) {
        var pedido = repositorio.pedido(identificador).orElseThrow(PedidoInexistente::new);
        var saga = repositorio.saga(identificador).orElseThrow(PedidoInexistente::new);
        return RepresentacionPedido.conSaga(pedido, saga);
    }

    private Map<String, Object> continuar(UUID identificador) {
        orquestador.avanzar(identificador);
        return consultar(identificador);
    }
}
