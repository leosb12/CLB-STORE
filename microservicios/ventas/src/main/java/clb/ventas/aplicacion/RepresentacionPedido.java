package clb.ventas.aplicacion;

import clb.ventas.dominio.LineaPedido;
import clb.ventas.dominio.Pedido;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Vista pública del pedido para REST y para los eventos del outbox (precio en texto decimal BOB y fechas UTC). */
public final class RepresentacionPedido {

    private RepresentacionPedido() {}

    public static Map<String, Object> pedido(Pedido pedido) {
        var vista = new LinkedHashMap<String, Object>();
        vista.put("identificador", pedido.identificador().toString());
        vista.put("identificador_cliente", pedido.identificadorCliente().toString());
        vista.put("estado", pedido.estado().name());
        vista.put("motivo", pedido.motivo());
        vista.put("total", pedido.total().decimal());
        vista.put("moneda", "BOB");
        vista.put("líneas", pedido.líneas().stream().map(RepresentacionPedido::línea).toList());
        vista.put("fecha_creación", pedido.fechaCreación().toString());
        vista.put("fecha_actualización", pedido.fechaActualización().toString());
        return vista;
    }

    public static Map<String, Object> conSaga(Pedido pedido, SagaCompra saga) {
        var vista = pedido(pedido);
        List<Map<String, Object>> historial = saga.historial().stream().map(registro -> {
            var paso = new LinkedHashMap<String, Object>();
            paso.put("paso", registro.paso().name());
            paso.put("resultado", registro.resultado());
            paso.put("detalle", registro.detalle());
            paso.put("fecha", registro.fecha().toString());
            return (Map<String, Object>) paso;
        }).toList();
        vista.put("saga", Map.of("paso", saga.paso().name(), "historial", historial));
        return vista;
    }

    private static Map<String, Object> línea(LineaPedido línea) {
        var producto = línea.producto();
        var vista = new LinkedHashMap<String, Object>();
        vista.put("identificador_variante", producto.identificadorVariante().toString());
        vista.put("identificador_producto", producto.identificadorProducto());
        vista.put("sku", producto.sku());
        vista.put("nombre", producto.nombre());
        vista.put("categoría", producto.categoría());
        vista.put("talla", producto.talla());
        vista.put("color", producto.color());
        vista.put("precio", producto.precio().decimal());
        vista.put("cantidad", línea.cantidad().valor());
        vista.put("subtotal", línea.subtotal().decimal());
        return vista;
    }
}
