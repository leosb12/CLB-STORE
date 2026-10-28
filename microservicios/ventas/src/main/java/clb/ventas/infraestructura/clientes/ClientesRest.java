package clb.ventas.infraestructura.clientes;

import clb.ventas.aplicacion.puertos.Puertos.FidelizacionClientes;
import clb.ventas.dominio.Dinero;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.client.RestClient;

/** Adaptador REST hacia Clientes (fidelización). Nunca accede a su DynamoDB. */
public final class ClientesRest implements FidelizacionClientes {

    private static final String SERVICIO = "Clientes";

    private final RestClient rest;

    public ClientesRest(RestClient rest) {
        this.rest = rest;
    }

    @Override
    public void acreditar(UUID pedido, UUID cliente, Dinero total, UUID clave) {
        enviar("/api/v1/interno/fidelizacion/acreditaciones", clave, Map.of("identificador_pedido", pedido.toString(),
                "identificador_cliente", cliente.toString(), "total_centavos", total.centavos()));
    }

    @Override
    public void revertir(UUID pedido, UUID cliente, UUID clave) {
        enviar("/api/v1/interno/fidelizacion/reversas", clave, Map.of("identificador_pedido", pedido.toString(), "identificador_cliente", cliente.toString()));
    }

    private void enviar(String ruta, UUID clave, Map<String, Object> cuerpo) {
        LlamadaRest.ejecutar(SERVICIO, () -> rest.post().uri(ruta).header("Idempotency-Key", clave.toString())
                .body(cuerpo).retrieve().toBodilessEntity());
    }
}
