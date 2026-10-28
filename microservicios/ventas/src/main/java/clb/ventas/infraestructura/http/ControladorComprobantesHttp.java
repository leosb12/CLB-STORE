package clb.ventas.infraestructura.http;

import static clb.ventas.infraestructura.http.ControladorPedidosHttp.uuid;

import clb.ventas.aplicacion.ComprobantesDeVenta;
import clb.ventas.dominio.Comprobante;
import clb.ventas.dominio.ReglaDePedidoIncumplida;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Comprobante de venta: la automatización (n8n, rol servicio) lo registra y el titular del pedido lo descarga. */
@RestController
public class ControladorComprobantesHttp {

    private final ComprobantesDeVenta comprobantes;

    public ControladorComprobantesHttp(ComprobantesDeVenta comprobantes) {
        this.comprobantes = comprobantes;
    }

    /** El cuerpo es el archivo tal cual (xlsx o PDF); 201 si es nuevo y 200 si el pedido ya tenía uno (no se reemplaza). */
    @PostMapping("/api/v1/interno/pedidos/{identificador}/comprobante")
    public ResponseEntity<Map<String, Object>> registrar(@PathVariable String identificador, HttpServletRequest solicitud,
                                                         @RequestHeader(HttpHeaders.CONTENT_TYPE) String tipo,
                                                         @RequestHeader(value = "X-Nombre-Archivo", required = false) String nombre,
                                                         @AuthenticationPrincipal Jwt servicio) throws IOException {
        var pedido = uuid(identificador, "identificador");
        // Lectura acotada: un cuerpo mayor a 2 MB se rechaza sin cargarlo entero en memoria (M06).
        if (solicitud.getContentLengthLong() > Comprobante.TAMAÑO_MÁXIMO)
            throw new ReglaDePedidoIncumplida("El comprobante debe pesar entre 1 byte y 2 MB.");
        byte[] archivo = solicitud.getInputStream().readNBytes(Comprobante.TAMAÑO_MÁXIMO + 1);
        String origen = servicio.getClaimAsString("azp") != null ? servicio.getClaimAsString("azp") : servicio.getSubject();
        String tipoBase;
        try {
            tipoBase = MediaType.parseMediaType(tipo).toString().split(";")[0];
        } catch (org.springframework.util.InvalidMimeTypeException error) {
            throw new ReglaDePedidoIncumplida("El tipo de archivo del comprobante no es válido.");
        }
        var registro = comprobantes.registrar(pedido, nombre != null ? nombre : "comprobante-" + pedido + ".xlsx",
                tipoBase, archivo, origen);
        return ResponseEntity.status(registro.nuevo() ? 201 : 200).body(Map.of("comprobante", vista(registro.comprobante())));
    }

    @GetMapping("/api/v1/pedidos/{identificador}/comprobante")
    public ResponseEntity<byte[]> descargar(@PathVariable String identificador, @AuthenticationPrincipal Jwt titular, Authentication autenticación) {
        boolean administrador = autenticación.getAuthorities().stream().anyMatch(rol -> "ROLE_admin".equals(rol.getAuthority()));
        var comprobante = comprobantes.descargar(uuid(identificador, "identificador"), uuid(titular.getSubject(), "sub"), administrador);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(comprobante.tipo()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(comprobante.nombre(), StandardCharsets.UTF_8).build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(comprobante.contenido());
    }

    private static Map<String, Object> vista(Comprobante c) {
        var vista = new LinkedHashMap<String, Object>();
        vista.put("identificador_pedido", c.identificadorPedido().toString());
        vista.put("nombre", c.nombre());
        vista.put("tipo", c.tipo());
        vista.put("tamaño", c.contenido().length);
        vista.put("generado_por", c.generadoPor());
        vista.put("fecha", c.fecha().toString());
        return vista;
    }
}
