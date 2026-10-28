package clb.ventas.infraestructura.http;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;

/**
 * Ventas valida cada token de Keycloak (firma por JWKS, emisor público estable y audiencia clb-api) aunque la pasarela
 * ya lo haya enrutado: defensa en profundidad. Los roles de realm se convierten en ROLE_cliente, ROLE_admin y ROLE_servicio.
 */
@Configuration
public class ConfiguracionSeguridad {

    static final String AUDIENCIA = "clb-api";

    @Bean
    SecurityFilterChain cadenaDeSeguridad(HttpSecurity http) throws Exception {
        // Un solo par de manejadores para el filtro JWT y el de autorización: siempre la misma respuesta.
        AuthenticationEntryPoint sinSesión = (solicitud, respuesta, error) ->
                responder(respuesta, 401, "Se requiere iniciar sesión.", "NO_AUTENTICADO");
        AccessDeniedHandler sinPermiso = (solicitud, respuesta, error) ->
                responder(respuesta, 403, "No tienes permiso para esta operación.", "ACCESO_DENEGADO");
        http.csrf(csrf -> csrf.disable())
                .sessionManagement(sesión -> sesión.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(acceso -> acceso
                        .requestMatchers("/salud").permitAll()
                        .requestMatchers("/api/v1/pedidos", "/api/v1/pedidos/**").hasAnyRole("cliente", "admin")
                        // Registrar un comprobante es exclusivo de la automatización (B01): un admin no inserta archivos.
                        .requestMatchers(HttpMethod.POST, "/api/v1/interno/pedidos/*/comprobante").hasRole("servicio")
                        .requestMatchers("/api/v1/interno/**").hasAnyRole("servicio", "admin")
                        .anyRequest().denyAll())
                .oauth2ResourceServer(servidor -> servidor
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(convertidorDeRoles()))
                        .authenticationEntryPoint(sinSesión).accessDeniedHandler(sinPermiso))
                .exceptionHandling(excepciones -> excepciones.authenticationEntryPoint(sinSesión).accessDeniedHandler(sinPermiso));
        return http.build();
    }

    /** El JWKS se descarga por la red interna; el emisor esperado es la URL pública por la pasarela. */
    @Bean
    JwtDecoder decodificadorJwt(@Value("${clb.identidad.jwks}") String jwks, @Value("${clb.identidad.emisor}") String emisor) {
        var decodificador = NimbusJwtDecoder.withJwkSetUri(jwks).build();
        decodificador.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(emisor),
                new JwtClaimValidator<Object>("aud", audiencia ->
                        audiencia instanceof Collection<?> lista ? lista.contains(AUDIENCIA) : AUDIENCIA.equals(audiencia))));
        return decodificador;
    }

    static JwtAuthenticationConverter convertidorDeRoles() {
        var convertidor = new JwtAuthenticationConverter();
        convertidor.setJwtGrantedAuthoritiesConverter(jwt -> {
            Map<String, Object> acceso = jwt.getClaimAsMap("realm_access");
            Object roles = acceso == null ? null : acceso.get("roles");
            if (!(roles instanceof Collection<?> lista)) return List.<GrantedAuthority>of();
            return lista.stream().map(rol -> (GrantedAuthority) new SimpleGrantedAuthority("ROLE_" + rol)).toList();
        });
        return convertidor;
    }

    private static void responder(HttpServletResponse respuesta, int estado, String mensaje, String código) throws IOException {
        respuesta.setStatus(estado);
        respuesta.setContentType("application/json;charset=UTF-8");
        respuesta.getOutputStream().write(("{\"mensaje\":\"" + mensaje + "\",\"código\":\"" + código + "\"}").getBytes(StandardCharsets.UTF_8));
    }
}
