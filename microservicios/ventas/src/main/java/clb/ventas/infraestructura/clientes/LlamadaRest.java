package clb.ventas.infraestructura.clientes;

import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;

/**
 * Traduce HTTP a la semántica de la SAGA. Son fallas temporales, que se reintentan con la misma Idempotency-Key: red
 * caída, timeouts, respuestas ilegibles, 5xx, 408/425/429 y 401/403 (configuración de acceso interno o credenciales
 * corregibles sin cambiar la solicitud). Todo otro 4xx es un rechazo definitivo del participante.
 */
final class LlamadaRest {

    private static final Set<Integer> TEMPORALES_4XX = Set.of(401, 403, 408, 425, 429);

    private LlamadaRest() {}

    static <T> T ejecutar(String servicio, Supplier<T> llamada) {
        try {
            return llamada.get();
        } catch (HttpStatusCodeException error) {
            int estado = error.getStatusCode().value();
            if (estado >= 500 || estado < 400 || TEMPORALES_4XX.contains(estado)) throw new ServicioNoDisponible(servicio + " respondió HTTP " + estado + ".");
            Map<?, ?> cuerpo = cuerpo(error);
            Object código = cuerpo.get("código");
            Object mensaje = cuerpo.get("mensaje");
            throw new RechazoDefinitivo(código != null ? código.toString() : "HTTP_" + estado,
                    mensaje != null ? mensaje.toString() : servicio + " rechazó la operación.");
        } catch (ResourceAccessException error) {
            throw new ServicioNoDisponible(servicio + " no responde.");
        } catch (RestClientException | ClassCastException ilegible) {
            throw new ServicioNoDisponible(servicio + " devolvió una respuesta ilegible.");
        }
    }

    static void ejecutar(String servicio, Runnable llamada) {
        ejecutar(servicio, () -> { llamada.run(); return null; });
    }

    private static Map<?, ?> cuerpo(HttpStatusCodeException error) {
        try {
            Map<?, ?> cuerpo = error.getResponseBodyAs(Map.class);
            return cuerpo != null ? cuerpo : Map.of();
        } catch (RuntimeException ilegible) {
            return Map.of();
        }
    }
}
