package clb.ventas.infraestructura.persistencia;

import clb.ventas.aplicacion.Errores.ArrendamientoPerdido;
import clb.ventas.aplicacion.SagaCompra;
import clb.ventas.aplicacion.SagaCompra.Claves;
import clb.ventas.aplicacion.SagaCompra.Paso;
import clb.ventas.aplicacion.SagaCompra.Registro;
import clb.ventas.aplicacion.puertos.Puertos.EventoPublicado;
import clb.ventas.aplicacion.puertos.Puertos.EventoVenta;
import clb.ventas.aplicacion.puertos.Puertos.RegistroIdempotencia;
import clb.ventas.aplicacion.puertos.Puertos.RepositorioPedidos;
import clb.ventas.dominio.Cantidad;
import clb.ventas.dominio.CopiaProducto;
import clb.ventas.dominio.Dinero;
import clb.ventas.dominio.EstadoPedido;
import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Adaptador de persistencia del agregado Pedido y de la SAGA en PostgreSQL (clb_ventas). */
public final class RepositorioPedidosJdbc implements RepositorioPedidos {

    // Serializa las inserciones del outbox para que el orden de los identificadores coincida con el de confirmación:
    // así un consumidor con cursor nunca se salta un evento confirmado más tarde con un identificador menor.
    private static final long BLOQUEO_OUTBOX = 0x434C42_0001L;

    private final JdbcClient jdbc;
    private final TransactionTemplate transacción;
    private final JsonMapper json;

    public RepositorioPedidosJdbc(JdbcClient jdbc, TransactionTemplate transacción, JsonMapper json) {
        this.jdbc = jdbc;
        this.transacción = transacción;
        this.json = json;
    }

    @Override
    public Optional<RegistroIdempotencia> clave(UUID clave) {
        return jdbc.sql("select clave, huella, identificador_pedido from claves_idempotencia where clave = ?").param(clave)
                .query((fila, n) -> new RegistroIdempotencia(fila.getObject(1, UUID.class), fila.getString(2), fila.getObject(3, UUID.class)))
                .optional();
    }

    @Override
    public List<UUID> pedidosDelCliente(UUID cliente, UUID antes, int límite) {
        if (antes == null) return jdbc.sql("""
                select identificador from pedidos where identificador_cliente = ?
                order by fecha_creacion desc, identificador desc limit ?""")
                .params(cliente, límite).query(UUID.class).list();
        return jdbc.sql("""
                select identificador from pedidos where identificador_cliente = ?
                and (fecha_creacion, identificador) <
                    (select fecha_creacion, identificador from pedidos where identificador = ? and identificador_cliente = ?)
                order by fecha_creacion desc, identificador desc limit ?""")
                .params(cliente, antes, cliente, límite).query(UUID.class).list();
    }

    @Override
    public Optional<String> huellaDelPedido(UUID pedido) {
        return jdbc.sql("select huella from pedidos where identificador = ?").param(pedido).query(String.class).optional();
    }

    @Override
    public Optional<Pedido> pedido(UUID identificador) {
        List<LineaPedido> líneas = jdbc.sql("""
                select identificador_variante, identificador_producto, sku, nombre, categoria, talla, color, precio_centavos, cantidad
                from lineas_pedido where identificador_pedido = ? order by posicion""").param(identificador)
                .query((fila, n) -> new LineaPedido(new CopiaProducto(fila.getObject(1, UUID.class), fila.getString(2), fila.getString(3),
                        fila.getString(4), fila.getString(5), fila.getString(6), fila.getString(7), new Dinero(fila.getLong(8))),
                        new Cantidad(fila.getInt(9))))
                .list();
        return jdbc.sql("""
                select identificador, identificador_cliente, estado, motivo, fecha_creacion, fecha_actualizacion
                from pedidos where identificador = ?""").param(identificador)
                .query((fila, n) -> Pedido.reconstituir(fila.getObject(1, UUID.class), fila.getObject(2, UUID.class), líneas,
                        EstadoPedido.valueOf(fila.getString(3)), fila.getString(4), instante(fila, 5), instante(fila, 6)))
                .optional();
    }

    @Override
    public Optional<SagaCompra> saga(UUID pedido) {
        List<Registro> historial = jdbc.sql("select paso, resultado, detalle, fecha from pasos_saga where identificador_pedido = ? order by identificador")
                .param(pedido)
                .query((fila, n) -> new Registro(Paso.valueOf(fila.getString(1)), fila.getString(2), fila.getString(3), instante(fila, 4)))
                .list();
        return jdbc.sql("""
                select identificador_pedido, identificador_reserva, clave_reserva, clave_acreditacion, clave_consumo, clave_liberacion,
                       clave_reversa, paso, intentos, proximo_intento
                from sagas_compra where identificador_pedido = ?""").param(pedido)
                .query((fila, n) -> SagaCompra.reconstituir(fila.getObject(1, UUID.class), fila.getObject(2, UUID.class),
                        new Claves(fila.getObject(3, UUID.class), fila.getObject(4, UUID.class), fila.getObject(5, UUID.class),
                                fila.getObject(6, UUID.class), fila.getObject(7, UUID.class)),
                        Paso.valueOf(fila.getString(8)), fila.getInt(9), instante(fila, 10), historial))
                .optional();
    }

    @Override
    public boolean registrar(Pedido pedido, SagaCompra saga, UUID clave, String huella) {
        Boolean registrado = transacción.execute(estado -> {
            int insertado = jdbc.sql("""
                    insert into pedidos (identificador, identificador_cliente, estado, motivo, total_centavos, huella, fecha_creacion, fecha_actualizacion)
                    values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing""")
                    .params(pedido.identificador(), pedido.identificadorCliente(), pedido.estado().name(), pedido.motivo(),
                            pedido.total().centavos(), huella, fecha(pedido.fechaCreación()), fecha(pedido.fechaActualización()))
                    .update();
            if (insertado == 0) return false;
            if (jdbc.sql("insert into claves_idempotencia (clave, huella, identificador_pedido) values (?, ?, ?) on conflict do nothing")
                    .params(clave, huella, pedido.identificador()).update() == 0) {
                estado.setRollbackOnly();
                return false;
            }
            int posición = 0;
            for (LineaPedido línea : pedido.líneas()) {
                var producto = línea.producto();
                jdbc.sql("""
                        insert into lineas_pedido (identificador_pedido, posicion, identificador_variante, identificador_producto, sku, nombre,
                                                   categoria, talla, color, precio_centavos, cantidad)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                        .params(pedido.identificador(), posición++, producto.identificadorVariante(), producto.identificadorProducto(),
                                producto.sku(), producto.nombre(), producto.categoría(), producto.talla(), producto.color(),
                                producto.precio().centavos(), línea.cantidad().valor())
                        .update();
            }
            var claves = saga.claves();
            jdbc.sql("""
                    insert into sagas_compra (identificador_pedido, paso, identificador_reserva, clave_reserva, clave_acreditacion, clave_consumo,
                                              clave_liberacion, clave_reversa, intentos, proximo_intento)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                    .params(saga.identificadorPedido(), saga.paso().name(), saga.identificadorReserva(), claves.reserva(), claves.acreditación(),
                            claves.consumo(), claves.liberación(), claves.reversa(), saga.intentos(), fecha(saga.próximoIntento()))
                    .update();
            insertarPasos(saga);
            return true;
        });
        if (Boolean.TRUE.equals(registrado)) saga.marcarPersistida();
        return Boolean.TRUE.equals(registrado);
    }

    @Override
    public void guardar(Pedido pedido, SagaCompra saga, Optional<EventoVenta> evento, UUID propietario, Instant renovarHasta) {
        transacción.executeWithoutResult(estado -> {
            // Primero la SAGA, filtrando por el dueño del arriendo: si otro proceso la retomó, no se aplica nada.
            int propia = jdbc.sql("""
                    update sagas_compra set paso = ?, intentos = ?, proximo_intento = ?, reclamada_hasta = ?
                    where identificador_pedido = ? and reclamada_por = ?""")
                    .params(saga.paso().name(), saga.intentos(), fecha(saga.próximoIntento()), fecha(renovarHasta),
                            saga.identificadorPedido(), propietario).update();
            if (propia == 0) throw new ArrendamientoPerdido();
            jdbc.sql("update pedidos set estado = ?, motivo = ?, fecha_actualizacion = ? where identificador = ?")
                    .params(pedido.estado().name(), pedido.motivo(), fecha(pedido.fechaActualización()), pedido.identificador()).update();
            insertarPasos(saga);
            evento.ifPresent(publicado -> {
                jdbc.sql("select pg_advisory_xact_lock(?)").param(BLOQUEO_OUTBOX).query(fila -> {});
                jdbc.sql("insert into eventos (tipo, identificador_pedido, datos, fecha) values (?, ?, cast(? as jsonb), ?)")
                        .params(publicado.tipo(), publicado.identificadorPedido(), json.writeValueAsString(publicado.datos()),
                                fecha(pedido.fechaActualización()))
                        .update();
            });
        });
        saga.marcarPersistida();
    }

    @Override
    public boolean registrarClave(UUID clave, String huella, UUID pedido) {
        return jdbc.sql("insert into claves_idempotencia (clave, huella, identificador_pedido) values (?, ?, ?) on conflict do nothing")
                .params(clave, huella, pedido).update() == 1;
    }

    @Override
    public boolean reclamar(UUID pedido, UUID propietario, Instant hasta, Instant ahora) {
        return jdbc.sql("""
                update sagas_compra set reclamada_hasta = ?, reclamada_por = ?
                where identificador_pedido = ? and (reclamada_hasta is null or reclamada_hasta < ?)""")
                .params(fecha(hasta), propietario, pedido, fecha(ahora)).update() == 1;
    }

    @Override
    public void liberarReclamo(UUID pedido, UUID propietario) {
        // Solo el dueño libera: un proceso con el arriendo vencido no puede soltar el de quien lo retomó.
        jdbc.sql("update sagas_compra set reclamada_hasta = null, reclamada_por = null where identificador_pedido = ? and reclamada_por = ?")
                .params(pedido, propietario).update();
    }

    @Override
    public List<UUID> sagasPendientes(Instant ahora, int límite) {
        return jdbc.sql("""
                select identificador_pedido from sagas_compra
                where paso <> 'TERMINADA' and proximo_intento <= ? and (reclamada_hasta is null or reclamada_hasta < ?)
                order by proximo_intento limit ?""")
                .params(fecha(ahora), fecha(ahora), límite).query(UUID.class).list();
    }

    @Override
    public List<EventoPublicado> eventosDesde(long desde, int límite) {
        return jdbc.sql("select identificador, tipo, identificador_pedido, datos, fecha from eventos where identificador > ? order by identificador limit ?")
                .params(desde, límite)
                .query((fila, n) -> new EventoPublicado(fila.getLong(1), fila.getString(2), fila.getObject(3, UUID.class),
                        json.readValue(fila.getString(4), new TypeReference<Map<String, Object>>() {}), instante(fila, 5)))
                .list();
    }

    private void insertarPasos(SagaCompra saga) {
        for (Registro registro : saga.registrosNuevos()) {
            jdbc.sql("insert into pasos_saga (identificador_pedido, paso, resultado, detalle, fecha) values (?, ?, ?, ?, ?)")
                    .params(saga.identificadorPedido(), registro.paso().name(), registro.resultado(), recortar(registro.detalle()), fecha(registro.fecha()))
                    .update();
        }
    }

    private static String recortar(String texto) {
        return texto == null || texto.length() <= 500 ? texto : texto.substring(0, 500);
    }

    private static OffsetDateTime fecha(Instant instante) {
        return instante.atOffset(ZoneOffset.UTC);
    }

    private static Instant instante(ResultSet fila, int columna) throws SQLException {
        return fila.getObject(columna, OffsetDateTime.class).toInstant();
    }
}
