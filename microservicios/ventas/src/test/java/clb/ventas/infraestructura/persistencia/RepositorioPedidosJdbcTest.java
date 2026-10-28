package clb.ventas.infraestructura.persistencia;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import clb.ventas.aplicacion.Errores.ArrendamientoPerdido;
import clb.ventas.aplicacion.RepresentacionPedido;
import clb.ventas.aplicacion.SagaCompra;
import clb.ventas.aplicacion.SagaCompra.Paso;
import clb.ventas.aplicacion.puertos.Puertos.EventoVenta;
import clb.ventas.dominio.Cantidad;
import clb.ventas.dominio.Comprobante;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.EstadoPedido;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Integración real con PostgreSQL clb_ventas en un esquema temporal clb_prueba_* que se elimina al terminar. */
class RepositorioPedidosJdbcTest {

    private static final String ESQUEMA = "clb_prueba_" + HexFormat.of().formatHex(UUID.randomUUID().toString().getBytes()).substring(0, 12);
    private static DriverManagerDataSource fuente;
    private static RepositorioPedidosJdbc repositorio;
    private static final Instant AHORA = Instant.now().truncatedTo(ChronoUnit.MILLIS);

    @BeforeAll
    static void preparar() throws Exception {
        var base = new DriverManagerDataSource("jdbc:postgresql://127.0.0.1:" + variable("CLB_POSTGRES_PUERTO", "5433") + "/clb_ventas",
                variable("CLB_POSTGRES_USUARIO", "clb_ventas"), variable("CLB_POSTGRES_CLAVE", ""));
        JdbcClient.create(base).sql("create schema " + ESQUEMA).update();
        fuente = new DriverManagerDataSource(base.getUrl() + "?currentSchema=" + ESQUEMA, base.getUsername(), base.getPassword());
        Flyway.configure().dataSource(fuente).schemas(ESQUEMA).locations("classpath:db/migration").load().migrate();
        repositorio = new RepositorioPedidosJdbc(JdbcClient.create(fuente), new TransactionTemplate(new DataSourceTransactionManager(fuente)),
                JsonMapper.builder().build());
    }

    @AfterAll
    static void limpiar() {
        if (ESQUEMA.startsWith("clb_prueba_")) JdbcClient.create(fuente).sql("drop schema " + ESQUEMA + " cascade").update();
    }

    /** Las claves locales viven en el .env de Compose (no versionado); también pueden llegar por variables de entorno. */
    private static String variable(String nombre, String predeterminado) throws Exception {
        if (System.getenv(nombre) != null) return System.getenv(nombre);
        Path env = Path.of("../../infraestructura/bases-de-datos/.env");
        if (Files.exists(env)) {
            for (String línea : Files.readAllLines(env)) if (línea.startsWith(nombre + "=")) return línea.substring(nombre.length() + 1);
        }
        return predeterminado;
    }

    private static Pedido pedido() {
        var línea = new LineaPedido(new CopiaProducto(UUID.randomUUID(), "b".repeat(32), "CLB-L-AZUL", "Chaqueta de jean", "Chaquetas",
                "L", "Azul", Dinero.deDecimal("349.50")), new Cantidad(2));
        return Pedido.crear(UUID.randomUUID(), UUID.randomUUID(), List.of(línea), AHORA);
    }

    @Test
    void registra_y_reconstituye_pedido_con_copia_y_saga() {
        var pedido = pedido();
        var saga = SagaCompra.iniciar(pedido.identificador(), AHORA);
        assertTrue(repositorio.registrar(pedido, saga, UUID.randomUUID(), "a".repeat(64)));
        var leído = repositorio.pedido(pedido.identificador()).orElseThrow();
        assertEquals(RepresentacionPedido.pedido(pedido), RepresentacionPedido.pedido(leído));
        var sagaLeída = repositorio.saga(pedido.identificador()).orElseThrow();
        assertEquals(saga.claves(), sagaLeída.claves());
        assertEquals(List.of("RESERVAR:INICIADA"), sagaLeída.historial().stream().map(r -> r.paso() + ":" + r.resultado()).toList());
        assertEquals(Optional.of("a".repeat(64)), repositorio.huellaDelPedido(pedido.identificador()));
    }

    @Test
    void historial_filtra_cuenta_y_pagina_empates_sin_repetir_ni_omitir() {
        var cliente = UUID.randomUUID();
        var base = pedido();
        for (int i = 0; i < 4; i++) {
            var p = Pedido.crear(UUID.randomUUID(), cliente, base.líneas(), AHORA);
            assertTrue(repositorio.registrar(p, SagaCompra.iniciar(p.identificador(), AHORA), UUID.randomUUID(), "historial"));
        }
        var ajeno = pedido();
        repositorio.registrar(ajeno, SagaCompra.iniciar(ajeno.identificador(), AHORA), UUID.randomUUID(), "ajeno");
        var todos = repositorio.pedidosDelCliente(cliente, null, 100);
        var primera = repositorio.pedidosDelCliente(cliente, null, 2);
        var segunda = repositorio.pedidosDelCliente(cliente, primera.getLast(), 2);
        assertEquals(4, todos.size());
        assertEquals(todos.subList(0, 2), primera);
        assertEquals(todos.subList(2, 4), segunda);
        assertTrue(repositorio.pedidosDelCliente(cliente, todos.getLast(), 2).isEmpty());
        assertTrue(repositorio.pedidosDelCliente(cliente, ajeno.identificador(), 2).isEmpty());
    }

    @Test
    void clave_repetida_revierte_todo_y_registro_concurrente_gana_uno_solo() throws Exception {
        var clave = UUID.randomUUID();
        var primero = pedido();
        assertTrue(repositorio.registrar(primero, SagaCompra.iniciar(primero.identificador(), AHORA), clave, "b".repeat(64)));
        var otro = pedido();
        assertFalse(repositorio.registrar(otro, SagaCompra.iniciar(otro.identificador(), AHORA), clave, "c".repeat(64)));
        assertTrue(repositorio.pedido(otro.identificador()).isEmpty(), "La transacción debe revertir el pedido si la clave ya existía.");

        var mismo = pedido();
        Callable<Boolean> intento = () -> repositorio.registrar(mismo, SagaCompra.iniciar(mismo.identificador(), AHORA), UUID.randomUUID(), "d".repeat(64));
        try (var hilos = Executors.newFixedThreadPool(4)) {
            long ganadores = hilos.invokeAll(List.of(intento, intento, intento, intento)).stream().filter(f -> {
                try { return f.get(); } catch (Exception error) { return false; }
            }).count();
            assertEquals(1, ganadores);
        }
    }

    @Test
    void guarda_estado_historial_y_outbox_consumible_con_cursor() {
        var pedido = pedido();
        var saga = SagaCompra.iniciar(pedido.identificador(), AHORA);
        repositorio.registrar(pedido, saga, UUID.randomUUID(), "e".repeat(64));
        long antes = repositorio.eventosDesde(0, 100).stream().mapToLong(e -> e.identificador()).max().orElse(0);
        saga.avanzar(Paso.ACREDITAR, "OK", "Stock reservado", AHORA.plusSeconds(1));
        saga.avanzar(Paso.CONSUMIR, "OK", "Puntos", AHORA.plusSeconds(2));
        pedido.confirmar(AHORA.plusSeconds(3));
        saga.avanzar(Paso.TERMINADA, "OK", "Confirmado", AHORA.plusSeconds(3));
        var dueño = UUID.randomUUID();
        assertTrue(repositorio.reclamar(pedido.identificador(), dueño, AHORA.plusSeconds(60), AHORA));
        repositorio.guardar(pedido, saga, Optional.of(new EventoVenta("pedido_confirmado", pedido.identificador(), RepresentacionPedido.pedido(pedido))),
                dueño, AHORA.plusSeconds(60));
        assertEquals(EstadoPedido.CONFIRMADO, repositorio.pedido(pedido.identificador()).orElseThrow().estado());
        assertEquals(4, repositorio.saga(pedido.identificador()).orElseThrow().historial().size());
        var eventos = repositorio.eventosDesde(antes, 100);
        assertEquals(1, eventos.size());
        assertEquals("pedido_confirmado", eventos.getFirst().tipo());
        assertEquals("699.00", eventos.getFirst().datos().get("total"));
        assertTrue(repositorio.eventosDesde(eventos.getFirst().identificador(), 100).isEmpty());
        assertTrue(repositorio.sagasPendientes(AHORA.plusSeconds(60), 100).stream().noneMatch(id -> id.equals(pedido.identificador())));
    }

    @Test
    void arrendamiento_tiene_dueno_y_un_proceso_vencido_no_pisa_al_que_lo_retomo() {
        var pedido = pedido();
        var saga = SagaCompra.iniciar(pedido.identificador(), AHORA);
        repositorio.registrar(pedido, saga, UUID.randomUUID(), "f".repeat(64));
        var lento = UUID.randomUUID();
        var nuevo = UUID.randomUUID();
        assertTrue(repositorio.reclamar(pedido.identificador(), lento, AHORA.plusSeconds(60), AHORA));
        assertFalse(repositorio.reclamar(pedido.identificador(), nuevo, AHORA.plusSeconds(60), AHORA.plusSeconds(1)));
        assertTrue(repositorio.reclamar(pedido.identificador(), nuevo, AHORA.plusSeconds(200), AHORA.plusSeconds(61)), "Un arriendo vencido se puede retomar.");
        saga.avanzar(Paso.ACREDITAR, "OK", "Stock reservado", AHORA.plusSeconds(62));
        assertThrows(ArrendamientoPerdido.class, () -> repositorio.guardar(pedido, saga, Optional.empty(), lento, AHORA.plusSeconds(120)));
        assertEquals(Paso.RESERVAR, repositorio.saga(pedido.identificador()).orElseThrow().paso(), "El proceso vencido no aplica cambios.");
        repositorio.liberarReclamo(pedido.identificador(), lento);
        assertFalse(repositorio.reclamar(pedido.identificador(), UUID.randomUUID(), AHORA.plusSeconds(60), AHORA.plusSeconds(62)),
                "El proceso vencido no puede liberar el arriendo ajeno.");
        repositorio.guardar(pedido, saga, Optional.empty(), nuevo, AHORA.plusSeconds(120));
        assertEquals(Paso.ACREDITAR, repositorio.saga(pedido.identificador()).orElseThrow().paso());
    }

    @Test
    void otra_clave_del_mismo_pedido_queda_registrada_una_sola_vez() {
        var pedido = pedido();
        repositorio.registrar(pedido, SagaCompra.iniciar(pedido.identificador(), AHORA), UUID.randomUUID(), "9".repeat(64));
        var otra = UUID.randomUUID();
        assertTrue(repositorio.registrarClave(otra, "9".repeat(64), pedido.identificador()));
        assertFalse(repositorio.registrarClave(otra, "9".repeat(64), pedido.identificador()));
        assertEquals(pedido.identificador(), repositorio.clave(otra).orElseThrow().identificadorPedido());
    }

    @Test
    void un_pedido_tiene_un_solo_comprobante_y_el_primero_no_se_reemplaza() {
        var pedido = pedido();
        repositorio.registrar(pedido, SagaCompra.iniciar(pedido.identificador(), AHORA), UUID.randomUUID(), "8".repeat(64));
        var comprobantes = new RepositorioComprobantesJdbc(JdbcClient.create(fuente));
        assertFalse(comprobantes.existe(pedido.identificador()));
        byte[] primero = clb.ventas.dominio.ComprobanteTest.xlsx("base");
        assertTrue(comprobantes.registrar(new Comprobante(pedido.identificador(), "comprobante.xlsx", Comprobante.XLSX, primero, "clb-n8n", AHORA)));
        assertFalse(comprobantes.registrar(new Comprobante(pedido.identificador(), "otro.xlsx", Comprobante.XLSX, clb.ventas.dominio.ComprobanteTest.xlsx("v2"), "clb-n8n", AHORA)));
        var leído = comprobantes.comprobante(pedido.identificador()).orElseThrow();
        assertEquals("comprobante.xlsx", leído.nombre());
        assertArrayEquals(primero, leído.contenido(), "El primer comprobante no se reemplaza.");
        assertEquals(AHORA, leído.fecha());
        assertTrue(comprobantes.existe(pedido.identificador()));
    }
}
