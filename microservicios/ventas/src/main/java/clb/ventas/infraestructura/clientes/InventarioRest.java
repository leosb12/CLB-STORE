package clb.ventas.infraestructura.clientes;

import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import clb.ventas.aplicacion.puertos.Puertos.CatalogoInventario;
import clb.ventas.aplicacion.puertos.Puertos.ReservasInventario;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.LineaPedido;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.client.RestClient;

/** Adaptador REST hacia Inventario: catálogo público y reservas internas. Nunca accede a su base MongoDB. */
public final class InventarioRest implements CatalogoInventario, ReservasInventario {

    private static final String SERVICIO = "Inventario";

    private final RestClient rest;

    public InventarioRest(RestClient rest) {
        this.rest = rest;
    }

    @Override
    public List<CopiaProducto> copias(List<UUID> identificadoresVariante) {
        // Varias tallas o colores de la misma prenda comparten producto: se consulta una sola vez por pedido.
        var productos = new HashMap<String, Map<?, ?>>();
        return identificadoresVariante.stream().map(id -> LlamadaRest.ejecutar(SERVICIO, () -> {
            Map<?, ?> variante = (Map<?, ?>) cuerpo(rest.get().uri("/api/v1/variantes/{id}", id).retrieve().body(Map.class)).get("variante");
            if (variante == null || !Boolean.TRUE.equals(variante.get("activo"))) throw new RechazoDefinitivo("VARIANTE_NO_DISPONIBLE", "La variante no está disponible.");
            String producto = texto(variante, "identificador_producto");
            Map<?, ?> datos = productos.computeIfAbsent(producto,
                    clave -> (Map<?, ?>) cuerpo(rest.get().uri("/api/v1/productos/{id}", clave).retrieve().body(Map.class)).get("producto"));
            if (datos == null) throw new ServicioNoDisponible("Inventario devolvió un producto incompleto.");
            return new CopiaProducto(id, producto, texto(variante, "sku"), texto(datos, "nombre"), texto(datos, "categoría"),
                    texto(variante, "talla"), texto(variante, "color"), Dinero.deDecimal(texto(datos, "precio")));
        })).toList();
    }

    @Override
    public void reservar(UUID reserva, UUID pedido, List<LineaPedido> líneas, UUID clave) {
        var cuerpo = Map.of("identificador", reserva.toString(), "identificador_pedido", pedido.toString(),
                "líneas", líneas.stream().map(línea -> Map.of("identificador_variante", línea.producto().identificadorVariante().toString(),
                        "cantidad", línea.cantidad().valor())).toList());
        LlamadaRest.ejecutar(SERVICIO, () -> rest.post().uri("/api/v1/interno/reservas").header("Idempotency-Key", clave.toString())
                .body(cuerpo).retrieve().toBodilessEntity());
    }

    @Override
    public void consumir(UUID reserva, UUID clave) {
        terminar(reserva, "consumir", clave);
    }

    @Override
    public void liberar(UUID reserva, UUID clave) {
        terminar(reserva, "liberar", clave);
    }

    private void terminar(UUID reserva, String acción, UUID clave) {
        LlamadaRest.ejecutar(SERVICIO, () -> rest.post().uri("/api/v1/interno/reservas/{id}/" + acción, reserva)
                .header("Idempotency-Key", clave.toString()).body(Map.of()).retrieve().toBodilessEntity());
    }

    private static Map<?, ?> cuerpo(Map<?, ?> respuesta) {
        if (respuesta == null) throw new ServicioNoDisponible("Inventario devolvió una respuesta vacía.");
        return respuesta;
    }

    private static String texto(Map<?, ?> datos, String campo) {
        Object valor = datos.get(campo);
        if (!(valor instanceof String texto)) throw new ServicioNoDisponible("Inventario devolvió datos incompletos (" + campo + ").");
        return texto;
    }
}
