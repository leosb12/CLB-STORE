package clb.ventas.infraestructura.http;

import clb.ventas.aplicacion.Errores.ComprobanteNoDisponible;
import clb.ventas.aplicacion.Errores.ConflictoDeIdempotencia;
import clb.ventas.aplicacion.Errores.PedidoInexistente;
import clb.ventas.aplicacion.Errores.RechazoDefinitivo;
import clb.ventas.aplicacion.Errores.ServicioNoDisponible;
import clb.ventas.dominio.ReglaDePedidoIncumplida;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Todas las respuestas de error en español con forma {mensaje, código}; nunca se exponen detalles internos. */
@RestControllerAdvice
public class ManejadorErrores {

    private static final Logger REGISTRO = Logger.getLogger(ManejadorErrores.class.getName());

    @ExceptionHandler({ReglaDePedidoIncumplida.class, ControladorPedidosHttp.DatosInvalidos.class})
    ResponseEntity<Map<String, String>> datosInvalidos(RuntimeException error) {
        return respuesta(422, error.getMessage(), "DATOS_INVALIDOS");
    }

    @ExceptionHandler(RechazoDefinitivo.class)
    ResponseEntity<Map<String, String>> rechazo(RechazoDefinitivo error) {
        return respuesta(422, error.getMessage(), error.código());
    }

    @ExceptionHandler(ConflictoDeIdempotencia.class)
    ResponseEntity<Map<String, String>> conflicto(ConflictoDeIdempotencia error) {
        return respuesta(409, error.getMessage(), "CONFLICTO_IDEMPOTENCIA");
    }

    @ExceptionHandler(PedidoInexistente.class)
    ResponseEntity<Map<String, String>> inexistente(PedidoInexistente error) {
        return respuesta(404, error.getMessage(), "PEDIDO_INEXISTENTE");
    }

    @ExceptionHandler(ComprobanteNoDisponible.class)
    ResponseEntity<Map<String, String>> sinComprobante(ComprobanteNoDisponible error) {
        return respuesta(404, error.getMessage(), "COMPROBANTE_NO_DISPONIBLE");
    }

    @ExceptionHandler(ServicioNoDisponible.class)
    ResponseEntity<Map<String, String>> noDisponible(ServicioNoDisponible error) {
        return respuesta(503, error.getMessage() + " Reintenta con la misma Idempotency-Key.", "SERVICIO_NO_DISPONIBLE");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> ilegible(HttpMessageNotReadableException error) {
        return respuesta(400, "La solicitud no es un JSON válido.", "SOLICITUD_INVALIDA");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String, String>> tipo(HttpMediaTypeNotSupportedException error) {
        return respuesta(415, "Se requiere Content-Type: application/json.", "TIPO_NO_SOPORTADO");
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, String>> ruta(NoResourceFoundException error) {
        return respuesta(404, "La ruta solicitada no existe.", "NO_ENCONTRADO");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, String>> método(HttpRequestMethodNotSupportedException error) {
        return respuesta(405, "El método HTTP no está permitido para esta ruta.", "METODO_NO_PERMITIDO");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, String>> interno(Exception error) {
        REGISTRO.log(Level.SEVERE, "Error no controlado en Ventas", error);
        return respuesta(500, "Ocurrió un error interno al procesar la solicitud.", "ERROR_INTERNO");
    }

    private static ResponseEntity<Map<String, String>> respuesta(int estado, String mensaje, String código) {
        return ResponseEntity.status(estado).body(Map.of("mensaje", mensaje, "código", código));
    }
}
