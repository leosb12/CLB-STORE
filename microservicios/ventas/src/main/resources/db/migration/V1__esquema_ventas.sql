-- Base privada de Ventas. Ningún otro servicio lee estas tablas: Inventario y Clientes se consultan por REST.

create table pedidos (
    identificador          uuid primary key,
    identificador_cliente  uuid not null,
    estado                 varchar(20) not null check (estado in ('PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'EN_REVISION')),
    motivo                 varchar(80),
    total_centavos         bigint not null check (total_centavos >= 0),
    huella                 char(64) not null,
    fecha_creacion         timestamptz not null,
    fecha_actualizacion    timestamptz not null
);
create index pedidos_por_cliente on pedidos (identificador_cliente, fecha_creacion);

-- Copia del producto al comprar: un cambio posterior del catálogo no altera pedidos pasados.
create table lineas_pedido (
    identificador_pedido   uuid not null references pedidos (identificador),
    posicion               smallint not null,
    identificador_variante uuid not null,
    identificador_producto varchar(64) not null,
    sku                    varchar(64) not null,
    nombre                 varchar(160) not null,
    categoria              varchar(100) not null,
    talla                  varchar(32) not null,
    color                  varchar(80) not null,
    precio_centavos        bigint not null check (precio_centavos >= 0),
    cantidad               integer not null check (cantidad between 1 and 1000000000),
    primary key (identificador_pedido, posicion),
    unique (identificador_pedido, identificador_variante)
);

-- Estado durable de la SAGA: claves fijas por paso, reintento con espera y arrendamiento contra ejecuciones simultáneas.
create table sagas_compra (
    identificador_pedido   uuid primary key references pedidos (identificador),
    paso                   varchar(30) not null check (paso in ('RESERVAR', 'ACREDITAR', 'CONSUMIR', 'COMPENSAR_RESERVA', 'COMPENSAR_PUNTOS', 'TERMINADA')),
    identificador_reserva  uuid not null,
    clave_reserva          uuid not null,
    clave_acreditacion     uuid not null,
    clave_consumo          uuid not null,
    clave_liberacion       uuid not null,
    clave_reversa          uuid not null,
    intentos               integer not null default 0,
    proximo_intento        timestamptz not null,
    reclamada_hasta        timestamptz
);
create index sagas_pendientes on sagas_compra (proximo_intento) where paso <> 'TERMINADA';

create table pasos_saga (
    identificador          bigserial primary key,
    identificador_pedido   uuid not null references pedidos (identificador),
    paso                   varchar(30) not null,
    resultado              varchar(30) not null,
    detalle                varchar(500),
    fecha                  timestamptz not null
);
create index pasos_por_pedido on pasos_saga (identificador_pedido, identificador);

create table claves_idempotencia (
    clave                  uuid primary key,
    huella                 char(64) not null,
    identificador_pedido   uuid not null references pedidos (identificador)
);

-- Outbox: los eventos se guardan en la misma transacción que el cambio de estado y se consumen con cursor.
create table eventos (
    identificador          bigserial primary key,
    tipo                   varchar(40) not null,
    identificador_pedido   uuid not null references pedidos (identificador),
    datos                  jsonb not null,
    fecha                  timestamptz not null
);
