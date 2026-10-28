package clb.ventas.infraestructura.http;

import clb.ventas.aplicacion.puertos.Puertos.EventoPublicado;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Salud operativa y outbox de eventos para consumidores internos (IA en la fase 8, n8n en la fase 10). */
@RestController
public class ControladorOperacionHttp {

    private final JdbcClient jdbc;
    private final RepositorioPedidos repositorio;

    public ControladorOperacionHttp(JdbcClient jdbc, RepositorioPedidos repositorio) {
        this.jdbc = jdbc;
        this.repositorio = repositorio;
    }

    @GetMapping("/salud")
    public ResponseEntity<Map<String, Object>> salud() {
        String postgres;
        try {
            jdbc.sql("select 1").query(Integer.class).single();
            postgres = "ACTIVO";
        } catch (RuntimeException caída) {
            postgres = "INACTIVO";
        }
        boolean activo = postgres.equals("ACTIVO");
        return ResponseEntity.status(activo ? 200 : 503).cacheControl(CacheControl.noStore())
                .body(Map.of("estado", activo ? "ACTIVO" : "DEGRADADO", "servicio", "ventas", "dependencias", Map.of("postgresql", postgres)));
    }

    /** Cursor: el consumidor guarda «siguiente» y lo envía como «desde»; cada uno avanza a su ritmo, sin acuse. */
    @GetMapping("/api/v1/interno/eventos")
    public ResponseEntity<Map<String, Object>> eventos(@RequestParam(defaultValue = "0") String desde,
                                                       @RequestParam(name = "límite", defaultValue = "100") String límite) {
        long cursor;
        int cantidad;
        try {
            cursor = Long.parseLong(desde);
            cantidad = Integer.parseInt(límite);
        } catch (NumberFormatException noEntero) {
            cursor = -1;
            cantidad = 0;
        }
        if (cursor < 0 || cantidad < 1 || cantidad > 100) {
            throw new ControladorPedidosHttp.DatosInvalidos("desde debe ser un entero no negativo y límite un entero de 1 a 100.");
        }
        List<EventoPublicado> eventos = repositorio.eventosDesde(cursor, cantidad);
        var cuerpo = new LinkedHashMap<String, Object>();
        cuerpo.put("eventos", eventos.stream().map(evento -> {
            var vista = new LinkedHashMap<String, Object>();
            vista.put("identificador", evento.identificador());
            vista.put("tipo", evento.tipo());
            vista.put("identificador_pedido", evento.identificadorPedido().toString());
            vista.put("fecha", evento.fecha().toString());
            vista.put("datos", evento.datos());
            return vista;
        }).toList());
        cuerpo.put("siguiente", eventos.isEmpty() ? cursor : eventos.getLast().identificador());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(cuerpo);
    }
}
