package clb.ventas.infraestructura;

import clb.ventas.aplicacion.ComprobantesDeVenta;
import clb.ventas.aplicacion.ConfirmarPedido;
import clb.ventas.aplicacion.OrquestadorSagaCompra;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.infraestructura.clientes.ClientesRest;
import clb.ventas.infraestructura.clientes.InventarioRest;
import clb.ventas.infraestructura.clientes.TokenDeServicio;
import clb.ventas.infraestructura.persistencia.RepositorioComprobantesJdbc;
import clb.ventas.infraestructura.persistencia.RepositorioPedidosJdbc;
import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.json.JsonMapper;

/** Composición: el dominio y la aplicación no conocen Spring; aquí se conectan con sus adaptadores. */
@Configuration
public class ConfiguracionVentas {

    @Bean
    Clock reloj() {
        return Clock.systemUTC();
    }

    @Bean
    RepositorioPedidos repositorioPedidos(JdbcClient jdbc, TransactionTemplate transacción, JsonMapper json) {
        return new RepositorioPedidosJdbc(jdbc, transacción, json);
    }

    @Bean
    TokenDeServicio tokenDeServicio(@Value("${clb.identidad.interno}") String identidad, @Value("${clb.identidad.token}") String rutaToken,
                                    @Value("${clb.identidad.cliente}") String cliente, @Value("${clb.identidad.secreto}") String secreto, Clock reloj) {
        return new TokenDeServicio(cliente(identidad).build(), rutaToken, cliente, secreto, reloj);
    }

    @Bean
    InventarioRest inventario(@Value("${clb.inventario.url}") String url, TokenDeServicio token) {
        return new InventarioRest(cliente(url).requestInterceptor(token.interceptor()).build());
    }

    @Bean
    ClientesRest clientes(@Value("${clb.clientes.url}") String url, TokenDeServicio token) {
        return new ClientesRest(cliente(url).requestInterceptor(token.interceptor()).build());
    }

    @Bean
    OrquestadorSagaCompra orquestador(RepositorioPedidos repositorio, InventarioRest inventario, ClientesRest clientes, Clock reloj,
                                      @Value("${clb.saga.intentos}") int intentos, @Value("${clb.saga.espera-ms}") long esperaMs) {
        return new OrquestadorSagaCompra(repositorio, inventario, clientes, reloj, intentos, Duration.ofMillis(esperaMs));
    }

    @Bean
    ConfirmarPedido confirmarPedido(RepositorioPedidos repositorio, InventarioRest inventario, OrquestadorSagaCompra orquestador, Clock reloj) {
        return new ConfirmarPedido(repositorio, inventario, orquestador, reloj);
    }

    @Bean
    ComprobantesDeVenta comprobantesDeVenta(RepositorioPedidos repositorio, JdbcClient jdbc, Clock reloj) {
        return new ComprobantesDeVenta(repositorio, new RepositorioComprobantesJdbc(jdbc), reloj);
    }

    @Bean
    ReanudadorSagas reanudadorSagas(OrquestadorSagaCompra orquestador) {
        return new ReanudadorSagas(orquestador);
    }

    private static RestClient.Builder cliente(String url) {
        // Tiempos acotados: un participante caído no bloquea la solicitud de compra más de unos segundos.
        var fábrica = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        fábrica.setReadTimeout(Duration.ofSeconds(4));
        return RestClient.builder().baseUrl(url).requestFactory(fábrica).defaultHeader("Accept", MediaType.APPLICATION_JSON_VALUE);
    }

    /** Retoma periódicamente las SAGA interrumpidas (servicio caído o proceso reiniciado). */
    public static final class ReanudadorSagas {
        private final OrquestadorSagaCompra orquestador;

        ReanudadorSagas(OrquestadorSagaCompra orquestador) {
            this.orquestador = orquestador;
        }

        @Scheduled(fixedDelayString = "${clb.saga.reanudar-cada-ms}", initialDelayString = "${clb.saga.reanudar-cada-ms}")
        public void reanudar() {
            orquestador.reanudarPendientes(20);
        }
    }
}
