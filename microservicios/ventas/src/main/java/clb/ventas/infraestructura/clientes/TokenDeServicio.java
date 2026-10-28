package clb.ventas.infraestructura.clientes;

import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Identidad de Ventas ante Inventario y Clientes: token de client credentials (rol servicio) de Keycloak,
 * en caché hasta 30 s antes de vencer. Ningún servicio confía en llamadas internas sin token.
 */
public final class TokenDeServicio {

    private static final Duration MARGEN = Duration.ofSeconds(30);

    private record Vigente(String valor, Instant vence) {}

    private final RestClient identidad;
    private final String rutaToken;
    private final String cliente;
    private final String secreto;
    private final Clock reloj;
    private volatile Vigente actual;

    public TokenDeServicio(RestClient identidad, String rutaToken, String cliente, String secreto, Clock reloj) {
        this.identidad = identidad;
        this.rutaToken = rutaToken;
        this.cliente = cliente;
        this.secreto = secreto;
        this.reloj = reloj;
    }

    public String vigente() {
        // Ruta rápida sin bloqueo: con un token vigente, las llamadas salientes no se serializan.
        var token = actual;
        if (token != null && reloj.instant().isBefore(token.vence().minus(MARGEN))) return token.valor();
        synchronized (this) {
            token = actual;
            if (token != null && reloj.instant().isBefore(token.vence().minus(MARGEN))) return token.valor();
            actual = solicitar();
            return actual.valor();
        }
    }

    /** Un 401 del participante significa que el token dejó de servir (llaves rotadas o revocado): se descarta. */
    public synchronized void descartar(String rechazado) {
        if (actual != null && actual.valor().equals(rechazado)) actual = null;
    }

    private Vigente solicitar() {
        var formulario = new LinkedMultiValueMap<String, String>();
        formulario.add("grant_type", "client_credentials");
        formulario.add("client_id", cliente);
        formulario.add("client_secret", secreto);
        try {
            Map<?, ?> respuesta = identidad.post().uri(rutaToken).contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(formulario).retrieve().body(Map.class);
            if (respuesta == null || !(respuesta.get("access_token") instanceof String nuevo) || !(respuesta.get("expires_in") instanceof Number duración)) {
                throw new ServicioNoDisponible("Identidad devolvió un token inválido.");
            }
            return new Vigente(nuevo, reloj.instant().plusSeconds(duración.longValue()));
        } catch (RestClientException caída) {
            throw new ServicioNoDisponible("Identidad (Keycloak) no responde.");
        }
    }

    /** Agrega «Authorization: Bearer …»; ante un 401 descarta el token y reintenta una sola vez con uno nuevo. */
    public ClientHttpRequestInterceptor interceptor() {
        return (solicitud, cuerpo, ejecución) -> {
            var token = vigente();
            solicitud.getHeaders().setBearerAuth(token);
            var respuesta = ejecución.execute(solicitud, cuerpo);
            if (respuesta.getStatusCode().value() != HttpStatus.UNAUTHORIZED.value()) return respuesta;
            respuesta.close();
            descartar(token);
            solicitud.getHeaders().setBearerAuth(vigente());
            return ejecución.execute(solicitud, cuerpo);
        };
    }
}
