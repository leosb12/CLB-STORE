package clb.ventas.infraestructura.persistencia;

import clb.ventas.aplicacion.puertos.Puertos.RepositorioComprobantes;
import clb.ventas.dominio.Comprobante;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Comprobantes en PostgreSQL (clb_ventas); la clave primaria por pedido garantiza uno solo aunque lleguen dos a la vez. */
public final class RepositorioComprobantesJdbc implements RepositorioComprobantes {

    private final JdbcClient jdbc;

    public RepositorioComprobantesJdbc(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean registrar(Comprobante c) {
        return jdbc.sql("""
                insert into comprobantes (identificador_pedido, nombre, tipo, contenido, generado_por, fecha)
                values (?, ?, ?, ?, ?, ?) on conflict (identificador_pedido) do nothing""")
                .params(c.identificadorPedido(), c.nombre(), c.tipo(), c.contenido(), c.generadoPor(), OffsetDateTime.ofInstant(c.fecha(), ZoneOffset.UTC))
                .update() == 1;
    }

    @Override
    public Optional<Comprobante> comprobante(UUID pedido) {
        return jdbc.sql("select identificador_pedido, nombre, tipo, contenido, generado_por, fecha from comprobantes where identificador_pedido = ?")
                .param(pedido)
                .query((f, n) -> new Comprobante(f.getObject(1, UUID.class), f.getString(2), f.getString(3), f.getBytes(4), f.getString(5),
                        f.getObject(6, OffsetDateTime.class).toInstant()))
                .optional();
    }

    @Override
    public boolean existe(UUID pedido) {
        return jdbc.sql("select exists (select 1 from comprobantes where identificador_pedido = ?)").param(pedido).query(Boolean.class).single();
    }
}
