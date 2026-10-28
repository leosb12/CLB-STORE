-- Comprobante de venta (no factura fiscal) que genera la automatización n8n al confirmarse un pedido (fase 10).
-- Uno por pedido: el primero que llega queda; un reintento no lo reemplaza.
create table comprobantes (
    identificador_pedido   uuid primary key references pedidos (identificador),
    nombre                 varchar(120) not null,
    tipo                   varchar(100) not null,
    contenido              bytea not null,
    generado_por           varchar(80) not null,
    fecha                  timestamptz not null
);
