package clb.ventas.infraestructura.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import clb.ventas.aplicacion.ComprobantesDeVenta;
import clb.ventas.aplicacion.ConfirmarPedido;
import clb.ventas.dominio.Comprobante;
import clb.ventas.aplicacion.ConfirmarPedido.SolicitudPedido;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Autorización de Ventas con tokens de Keycloak: quién puede comprar, consultar y leer el outbox. */
@WebMvcTest(controllers = {ControladorPedidosHttp.class, ControladorOperacionHttp.class, ControladorComprobantesHttp.class})
@Import({ConfiguracionSeguridad.class, ManejadorErrores.class})
class SeguridadHttpTest {

    @Autowired MockMvc mvc;
    @MockitoBean ConfirmarPedido confirmar;
    @MockitoBean ComprobantesDeVenta comprobantes;
    @MockitoBean RepositorioPedidos repositorio;
    @MockitoBean JdbcClient jdbc;
    @MockitoBean JwtDecoder decodificador;

    private static final String CUERPO = """
            {"identificador":"%s","líneas":[{"identificador_variante":"%s","cantidad":1}]}""";

    private static JwtRequestPostProcessor token(String sub, String... roles) {
        return jwt().jwt(j -> j.subject(sub).claim("realm_access", Map.of("roles", List.of(roles))))
                .authorities(java.util.Arrays.stream(roles).map(rol -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + rol)).toList());
    }

    private String cuerpo() {
        return CUERPO.formatted(UUID.randomUUID(), UUID.randomUUID());
    }

    @Test
    void sin_token_responde_401_en_espanol() throws Exception {
        mvc.perform(post("/api/v1/pedidos").contentType(MediaType.APPLICATION_JSON).content(cuerpo()).header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.código").value("NO_AUTENTICADO"));
        verifyNoInteractions(confirmar);
    }

    @Test
    void historial_exige_cliente_y_utiliza_sub_incluso_para_admin() throws Exception {
        mvc.perform(get("/api/v1/pedidos")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/pedidos").with(token(UUID.randomUUID().toString(), "servicio")))
                .andExpect(status().isForbidden());
        var cliente = UUID.randomUUID();
        var primero = UUID.randomUUID();
        when(confirmar.listar(cliente, null, 2)).thenReturn(List.of(
                Map.of("identificador", primero.toString()), Map.of("identificador", UUID.randomUUID().toString())));
        mvc.perform(get("/api/v1/pedidos").param("limite", "1").param("identificador_cliente", UUID.randomUUID().toString())
                        .with(token(cliente.toString(), "admin")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.pedidos.length()").value(1))
                .andExpect(jsonPath("$.siguiente").value(primero.toString()));
        verify(confirmar).listar(cliente, null, 2);
    }

    @Test
    void historial_valida_limites_y_cursor() throws Exception {
        for (String limite : List.of("0", "101", "-1"))
            mvc.perform(get("/api/v1/pedidos").param("limite", limite).with(token(UUID.randomUUID().toString(), "cliente")))
                    .andExpect(status().isUnprocessableContent());
        mvc.perform(get("/api/v1/pedidos").param("antes", "' OR 1=1").with(token(UUID.randomUUID().toString(), "cliente")))
                .andExpect(status().isUnprocessableContent());
        verifyNoInteractions(confirmar);
    }

    @Test
    void token_sin_rol_de_cliente_responde_403() throws Exception {
        mvc.perform(post("/api/v1/pedidos").with(token(UUID.randomUUID().toString(), "servicio")).contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo()).header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.código").value("ACCESO_DENEGADO"));
    }

    @Test
    void el_cliente_del_pedido_es_siempre_el_titular_del_token() throws Exception {
        var titular = UUID.randomUUID();
        when(confirmar.ejecutar(any(), any())).thenReturn(Map.of("estado", "CONFIRMADO"));
        mvc.perform(post("/api/v1/pedidos").with(token(titular.toString(), "cliente")).contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo()).header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isCreated());
        var solicitud = ArgumentCaptor.forClass(SolicitudPedido.class);
        verify(confirmar).ejecutar(any(), solicitud.capture());
        assertEquals(titular, solicitud.getValue().identificadorCliente());
    }

    @Test
    void no_se_acepta_un_cliente_enviado_en_el_cuerpo() throws Exception {
        var suplantado = """
                {"identificador":"%s","identificador_cliente":"%s","líneas":[]}""".formatted(UUID.randomUUID(), UUID.randomUUID());
        mvc.perform(post("/api/v1/pedidos").with(token(UUID.randomUUID().toString(), "cliente")).contentType(MediaType.APPLICATION_JSON)
                        .content(suplantado).header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isUnprocessableContent());
        verifyNoInteractions(confirmar);
    }

    @Test
    void la_consulta_pasa_el_titular_y_si_es_administrador() throws Exception {
        var pedido = UUID.randomUUID();
        var cliente = UUID.randomUUID();
        when(confirmar.consultar(eq(pedido), any(), any(Boolean.class))).thenReturn(Map.of("estado", "CONFIRMADO"));
        mvc.perform(get("/api/v1/pedidos/" + pedido).with(token(cliente.toString(), "cliente"))).andExpect(status().isOk());
        verify(confirmar).consultar(pedido, cliente, false);
        var administrador = UUID.randomUUID();
        mvc.perform(get("/api/v1/pedidos/" + pedido).with(token(administrador.toString(), "admin", "cliente"))).andExpect(status().isOk());
        verify(confirmar).consultar(pedido, administrador, true);
    }

    @Test
    void el_pedido_indica_si_ya_tiene_comprobante() throws Exception {
        var pedido = UUID.randomUUID();
        when(confirmar.consultar(eq(pedido), any(), any(Boolean.class))).thenReturn(Map.of("estado", "CONFIRMADO"));
        when(comprobantes.disponible(pedido)).thenReturn(true);
        mvc.perform(get("/api/v1/pedidos/" + pedido).with(token(UUID.randomUUID().toString(), "cliente")))
                .andExpect(jsonPath("$.pedido.comprobante_disponible").value(true));
    }

    @Test
    void solo_un_servicio_registra_comprobantes_y_queda_su_origen() throws Exception {
        var pedido = UUID.randomUUID();
        byte[] xlsx = clb.ventas.dominio.ComprobanteTest.xlsx("base");
        var comprobante = new Comprobante(pedido, "comprobante.xlsx", Comprobante.XLSX, xlsx, "clb-n8n", Instant.parse("2026-10-22T12:00:00Z"));
        when(comprobantes.registrar(eq(pedido), eq("comprobante.xlsx"), eq(Comprobante.XLSX), any(), eq("clb-n8n")))
                .thenReturn(new ComprobantesDeVenta.Registro(comprobante, true));
        var ruta = "/api/v1/interno/pedidos/" + pedido + "/comprobante";
        mvc.perform(post(ruta).contentType(Comprobante.XLSX).content(xlsx))
                .andExpect(status().isUnauthorized());
        mvc.perform(post(ruta).with(token(UUID.randomUUID().toString(), "cliente")).contentType(Comprobante.XLSX).content(xlsx))
                .andExpect(status().isForbidden());
        var servicio = jwt().jwt(j -> j.subject(UUID.randomUUID().toString()).claim("azp", "clb-n8n"))
                .authorities(new SimpleGrantedAuthority("ROLE_servicio"));
        mvc.perform(post(ruta).with(servicio).contentType(Comprobante.XLSX).header("X-Nombre-Archivo", "comprobante.xlsx").content(xlsx))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.comprobante.generado_por").value("clb-n8n"))
                .andExpect(jsonPath("$.comprobante.tamaño").value(xlsx.length));
        // B01: un administrador no registra comprobantes; esa escritura es solo de la automatización.
        mvc.perform(post(ruta).with(token(UUID.randomUUID().toString(), "admin")).contentType(Comprobante.XLSX).content(xlsx))
                .andExpect(status().isForbidden());
    }

    @Test
    void el_titular_descarga_su_comprobante_como_adjunto() throws Exception {
        var pedido = UUID.randomUUID();
        var cliente = UUID.randomUUID();
        byte[] xlsx = clb.ventas.dominio.ComprobanteTest.xlsx("base");
        when(comprobantes.descargar(pedido, cliente, false))
                .thenReturn(new Comprobante(pedido, "comprobante.xlsx", Comprobante.XLSX, xlsx, "clb-n8n", Instant.parse("2026-10-22T12:00:00Z")));
        mvc.perform(get("/api/v1/pedidos/" + pedido + "/comprobante").with(token(cliente.toString(), "cliente")))
                .andExpect(status().isOk()).andExpect(content().bytes(xlsx))
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment")));
    }

    @Test
    void el_outbox_es_solo_para_servicios_o_administradores() throws Exception {
        when(repositorio.eventosDesde(0, 100)).thenReturn(List.of());
        mvc.perform(get("/api/v1/interno/eventos").with(token(UUID.randomUUID().toString(), "cliente"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/interno/eventos").with(token(UUID.randomUUID().toString(), "servicio")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.siguiente").value(0));
    }

    @Test
    void los_roles_de_keycloak_se_convierten_en_autoridades() {
        var jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject("s").issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60))
                .claim("realm_access", Map.of("roles", List.of("cliente", "admin"))).build();
        // Spring Security 7 agrega además una autoridad de factor (FACTOR_BEARER): se comparan solo los roles.
        var autoridades = ConfiguracionSeguridad.convertidorDeRoles().convert(jwt).getAuthorities().stream()
                .map(GrantedAuthority::getAuthority).filter(nombre -> nombre.startsWith("ROLE_")).sorted().toList();
        assertEquals(List.of("ROLE_admin", "ROLE_cliente"), autoridades);
    }
}
