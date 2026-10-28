package clb.ventas.infraestructura.clientes;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** El token de servicio se reutiliza mientras está vigente y se descarta si un participante lo rechaza (401). */
class TokenDeServicioTest {

    @Test
    void reutiliza_el_token_y_lo_renueva_al_descartarlo() {
        var constructor = RestClient.builder().baseUrl("http://identidad");
        var servidor = MockRestServiceServer.bindTo(constructor).build();
        servidor.expect(requestTo("http://identidad/token")).andRespond(withSuccess("{\"access_token\":\"A\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
        servidor.expect(requestTo("http://identidad/token")).andRespond(withSuccess("{\"access_token\":\"B\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
        var token = new TokenDeServicio(constructor.build(), "/token", "clb-ventas", "secreto", Clock.systemUTC());
        assertEquals("A", token.vigente());
        assertEquals("A", token.vigente(), "Vigente: no se pide otro a Keycloak.");
        token.descartar("otro");
        assertEquals("A", token.vigente(), "Descartar un token ajeno no afecta al vigente.");
        token.descartar("A");
        assertEquals("B", token.vigente());
        servidor.verify();
    }
}
