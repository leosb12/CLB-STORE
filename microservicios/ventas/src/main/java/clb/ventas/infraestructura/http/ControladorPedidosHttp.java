package clb.ventas.infraestructura.http;

import clb.ventas.aplicacion.ComprobantesDeVenta;
import clb.ventas.aplicacion.ConfirmarPedido;
import clb.ventas.aplicacion.ConfirmarPedido.LineaSolicitada;
import clb.ventas.aplicacion.ConfirmarPedido.SolicitudPedido;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Adaptador REST del caso de uso Confirmar pedido (CU03). */
@RestController
@RequestMapping("/api/v1/pedidos")
public class ControladorPedidosHttp {

    private static final Pattern UUID_V4 = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

    private final ConfirmarPedido confirmar;
    private final ComprobantesDeVenta comprobantes;

    public ControladorPedidosHttp(ConfirmarPedido confirmar, ComprobantesDeVenta comprobantes) {
        this.confirmar = confirmar;
        this.comprobantes = comprobantes;
    }

    /** El cliente es siempre el titular del token (sub de Keycloak), nunca un dato del cuerpo. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> confirmar(@RequestHeader(value = "Idempotency-Key", required = false) String clave,
                                         @RequestBody Map<String, Object> cuerpo, @AuthenticationPrincipal Jwt titular) {
        return Map.of("pedido", confirmar.ejecutar(uuid(clave, "Idempotency-Key"), solicitud(cuerpo, uuid(titular.getSubject(), "sub"))));
    }

    @GetMapping("/{identificador}")
    public Map<String, Object> consultar(@PathVariable String identificador, @AuthenticationPrincipal Jwt titular, Authentication autenticación) {
        // Mismo mapeo de roles que la cadena de seguridad (ROLE_admin), sin volver a leer el token.
        boolean administrador = autenticación.getAuthorities().stream().anyMatch(rol -> "ROLE_admin".equals(rol.getAuthority()));
        var pedido = uuid(identificador, "identificador");
        var vista = new LinkedHashMap<>(confirmar.consultar(pedido, uuid(titular.getSubject(), "sub"), administrador));
        vista.put("comprobante_disponible", comprobantes.disponible(pedido));
        return Map.of("pedido", vista);
    }

    /** Historial de la cuenta, también para administradores: nunca admite otro titular por parámetro. */
    @GetMapping
    public Map<String, Object> listar(@AuthenticationPrincipal Jwt titular,
            @RequestParam(required = false) String antes, @RequestParam(defaultValue = "50") int limite) {
        if (limite < 1 || limite > 100) throw new DatosInvalidos("limite debe estar entre 1 y 100.");
        var encontrados = confirmar.listar(uuid(titular.getSubject(), "sub"),
                antes == null ? null : uuid(antes, "antes"), limite + 1);
        var pedidos = encontrados.stream().limit(limite).map(pedido -> {
            var vista = new LinkedHashMap<>(pedido);
            vista.put("comprobante_disponible", comprobantes.disponible(UUID.fromString(pedido.get("identificador").toString())));
            return vista;
        }).toList();
        var respuesta = new LinkedHashMap<String, Object>();
        respuesta.put("pedidos", pedidos);
        respuesta.put("siguiente", encontrados.size() > limite ? pedidos.getLast().get("identificador") : null);
        return respuesta;
    }

    private static SolicitudPedido solicitud(Map<String, Object> cuerpo, UUID cliente) {
        exigirCampos(cuerpo, Set.of("identificador", "líneas"));
        if (!(cuerpo.get("líneas") instanceof List<?> líneas)) throw new DatosInvalidos("líneas debe ser un arreglo.");
        List<LineaSolicitada> solicitadas = new ArrayList<>();
        for (Object elemento : líneas) {
            if (!(elemento instanceof Map<?, ?> línea)) throw new DatosInvalidos("Cada línea debe ser un objeto.");
            exigirCampos(línea, Set.of("identificador_variante", "cantidad"));
            if (!(línea.get("cantidad") instanceof Integer cantidad)) throw new DatosInvalidos("cantidad debe ser un entero.");
            solicitadas.add(new LineaSolicitada(uuid(línea.get("identificador_variante"), "identificador_variante"), cantidad));
        }
        return new SolicitudPedido(uuid(cuerpo.get("identificador"), "identificador"), cliente, solicitadas);
    }

    private static void exigirCampos(Map<?, ?> objeto, Set<String> campos) {
        if (!campos.equals(objeto.keySet())) throw new DatosInvalidos("Se requieren exactamente los campos " + campos + ".");
    }

    static UUID uuid(Object valor, String campo) {
        if (!(valor instanceof String texto) || !UUID_V4.matcher(texto).matches()) throw new DatosInvalidos(campo + " debe ser un UUID v4 válido.");
        return UUID.fromString(texto.toLowerCase());
    }

    static final class DatosInvalidos extends RuntimeException {
        DatosInvalidos(String mensaje) { super(mensaje); }
    }
}
