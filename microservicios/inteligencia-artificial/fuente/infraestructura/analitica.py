"""Modelo de lectura `clb_analitica` en PostgreSQL (CQRS, D3). Propiedad exclusiva del microservicio de IA.

Las consultas son fijas y parametrizadas: la agrupación se elige de un diccionario cerrado, nunca de texto del usuario.
Dinero en centavos enteros; los totales en texto decimal se arman al final.
"""
import json
import re
from datetime import datetime
from decimal import Decimal

from psycopg import AsyncConnection
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

ESQUEMA = """
create table if not exists cursores (
    fuente text primary key, posicion bigint not null default 0, al_dia timestamptz);
create table if not exists eventos_procesados (
    fuente text not null, identificador text not null, fecha timestamptz not null default now(),
    primary key (fuente, identificador));
create table if not exists pedidos (
    identificador uuid primary key, cliente text not null, estado text not null, total_centavos bigint not null,
    motivo text, fecha_creacion timestamptz not null, fecha_actualizacion timestamptz not null);
create table if not exists lineas_venta (
    pedido uuid not null references pedidos on delete cascade, variante uuid not null, producto text not null,
    sku text not null, nombre text not null, categoria text not null, talla text not null, color text not null,
    cantidad integer not null check (cantidad > 0), precio_centavos bigint not null, subtotal_centavos bigint not null,
    primary key (pedido, variante));
create index if not exists clb_lineas_producto on lineas_venta (producto);
create index if not exists clb_pedidos_fecha on pedidos (estado, fecha_creacion);
create table if not exists existencias (
    variante uuid primary key, producto text not null, sku text not null, nombre text not null, categoria text not null,
    talla text not null, color text not null, fisica integer not null, reservada integer not null,
    disponible integer not null, minimo integer not null, version integer not null, stock_bajo boolean not null,
    activo boolean not null, fecha_copia timestamptz not null default now());
create table if not exists alertas_stock (
    identificador text primary key, variante uuid not null, producto text not null, disponible integer not null,
    minimo integer not null, fecha timestamptz not null);
create table if not exists reportes (
    identificador uuid primary key, usuario text not null, peticion text, salida_modelo text, especificacion jsonb not null,
    generativa boolean not null, observacion text, datos jsonb not null, datos_al timestamptz, fecha timestamptz not null);
create table if not exists auditoria_agentes (
    identificador bigserial primary key, fecha timestamptz not null default now(), usuario text not null,
    agente text not null, herramienta text not null, argumentos jsonb not null, permitido boolean not null,
    resultado text not null);
create table if not exists propuestas_reposicion (
    identificador uuid primary key, variante uuid not null, sku text not null, cantidad integer not null,
    motivo text not null, estado text not null, usuario text not null, fecha timestamptz not null default now(),
    fecha_resolucion timestamptz, resultado jsonb);
alter table propuestas_reposicion add column if not exists cuerpo jsonb;
-- Una sola propuesta abierta por variante.
create unique index if not exists clb_propuesta_abierta on propuestas_reposicion (variante)
    where estado in ('PENDIENTE', 'CONFIRMANDO', 'REQUIERE_REVISION');
-- Notificaciones operativas de la automatización n8n (fase 10): una por evento de Inventario, con ciclo de vida.
create table if not exists notificaciones (
    evento uuid primary key, tipo text not null, variante uuid not null, producto text not null, sku text not null,
    talla text not null, color text not null, disponible integer not null, minimo integer not null, mensaje text not null,
    origen text not null, estado text not null default 'NUEVA' check (estado in ('NUEVA', 'ATENDIDA')),
    fecha_evento timestamptz not null, fecha timestamptz not null default now(), atendida_por text, fecha_atencion timestamptz);
create index if not exists clb_notificaciones_estado on notificaciones (estado, fecha desc);
-- Nombres visibles de los clientes con pedidos: proyección por el contrato interno de Clientes (perfil o cuenta).
create table if not exists clientes (
    cliente text primary key, nombre text, origen text, fecha_copia timestamptz not null default now());
alter table reportes add column if not exists procedencia text;
create table if not exists eventos_rechazados (
    fuente text not null, identificador text not null, error text not null, evento jsonb not null,
    fecha timestamptz not null default now(), primary key (fuente, identificador));
"""

ORDEN_METRICA = {"UNIDADES": "unidades desc", "MONTO": "monto desc", "PEDIDOS": "pedidos desc"}
COLUMNA_METRICA = {"UNIDADES": "unidades", "MONTO": "monto", "PEDIDOS": "pedidos"}
# Filtros admitidos (lista blanca de columnas); el valor siempre va como parámetro enlazado.
COLUMNAS_FILTRO = {"categoria": "l.categoria", "talla": "l.talla", "color": "l.color"}

COLUMNAS_GRUPO = {
    "TALLA": "l.talla", "COLOR": "l.color", "CATEGORIA": "l.categoria", "PRODUCTO": "l.nombre",
    "DIA": "to_char(p.fecha_creacion at time zone 'America/La_Paz', 'YYYY-MM-DD')",
}


# Reportes v2: cada campo del catálogo (dominio/catalogo_reportes.py) tiene aquí UNA expresión SQL fija. Nada más llega al SQL.
_DESDE_VENTAS = ("from pedidos p join lineas_venta l on l.pedido = p.identificador "
                 "left join clientes c on c.cliente = p.cliente left join existencias e on e.variante = l.variante")
SQL_CAMPOS = {
    "VENTAS": {
        "FECHA": "to_char(p.fecha_creacion at time zone 'America/La_Paz', 'YYYY-MM-DD')",
        "PEDIDO": "left(p.identificador::text, 8)", "ESTADO": "p.estado",
        "CLIENTE": "coalesce(c.nombre, 'Sin nombre registrado')",
        "PRODUCTO": "l.nombre", "SKU": "l.sku", "CATEGORIA": "l.categoria", "TALLA": "l.talla", "COLOR": "l.color",
        "CANTIDAD": "l.cantidad", "PRECIO_UNITARIO": "l.precio_centavos", "SUBTOTAL": "l.subtotal_centavos",
        "STOCK_ACTUAL": "e.disponible",
        "UNIDADES": "sum(l.cantidad)", "MONTO": "sum(l.subtotal_centavos)", "PEDIDOS": "count(distinct p.identificador)",
        "CLIENTES": "count(distinct p.cliente)",
        "PRECIO_PROMEDIO": "round(sum(l.subtotal_centavos)::numeric / nullif(sum(l.cantidad), 0))",
        "TICKET_PROMEDIO": "round(sum(l.subtotal_centavos)::numeric / nullif(count(distinct p.identificador), 0))",
    },
    "INVENTARIO": {
        "PRODUCTO": "e.nombre", "SKU": "e.sku", "CATEGORIA": "e.categoria", "TALLA": "e.talla", "COLOR": "e.color",
        "STOCK_FISICO": "e.fisica", "STOCK_RESERVADO": "e.reservada", "STOCK_DISPONIBLE": "e.disponible",
        "STOCK_MINIMO": "e.minimo", "STOCK_BAJO": "e.stock_bajo",
        "DISPONIBLE_TOTAL": "sum(e.disponible)", "FISICO_TOTAL": "sum(e.fisica)", "VARIANTES": "count(*)",
        "VARIANTES_STOCK_BAJO": "count(*) filter (where e.stock_bajo)",
    },
}
_FILTRO_TEXTO = {"CLIENTE": "coalesce(c.nombre, '')"}  # filtrar por nombre no debe coincidir con «Sin nombre registrado»
# Totales de un detalle: solo las columnas que se suman con sentido (cantidad, total comprado, stock).
_SUMAS_DETALLE = {"VENTAS": {"CANTIDAD": "sum(l.cantidad)", "SUBTOTAL": "sum(l.subtotal_centavos)"},
                  "INVENTARIO": {"STOCK_FISICO": "sum(e.fisica)", "STOCK_RESERVADO": "sum(e.reservada)",
                                 "STOCK_DISPONIBLE": "sum(e.disponible)"}}
_OPERADOR_SQL = {"IGUAL": "=", "MAYOR_O_IGUAL": ">=", "MENOR_O_IGUAL": "<="}


def _es_metrica(expresion: str) -> bool:
    return expresion.startswith(("sum(", "count(", "round("))


def _plano(valor):
    """Valores JSON: Decimal entero (round/sum) → int; el resto tal cual."""
    return int(valor) if isinstance(valor, Decimal) else valor


def texto_bs(centavos: int | Decimal | None) -> str:
    centavos = int(centavos or 0)
    return f"{'-' if centavos < 0 else ''}{abs(centavos) // 100}.{abs(centavos) % 100:02d}"


def centavos(texto: str) -> int:
    return int((Decimal(str(texto)) * 100).to_integral_value())


def _notificacion(fila: dict) -> dict:
    return {**fila, "evento": str(fila["evento"]), "variante": str(fila["variante"])}


class RepositorioPostgres:
    def __init__(self, conexion: str, esquema: str = "public"):
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", esquema):
            raise ValueError("Nombre de esquema inválido.")
        self.esquema = esquema
        self.pool = AsyncConnectionPool(make_conninfo(conexion, options=f"-c search_path={esquema}"), min_size=1, max_size=8,
                                        open=False, kwargs={"row_factory": dict_row})

    async def abrir(self):
        await self.pool.open()
        async with self.pool.connection() as c:
            if self.esquema != "public":
                await c.execute(f"create schema if not exists {self.esquema}")
            await c.execute(ESQUEMA)

    async def cerrar(self):
        await self.pool.close()

    async def disponible(self) -> bool:
        try:
            async with self.pool.connection(timeout=3) as c:
                await c.execute("select 1")
            return True
        except Exception:
            return False

    # ---- ingesta -------------------------------------------------------------------------------------------------
    async def posicion(self, fuente: str) -> int:
        async with self.pool.connection() as c:
            fila = await (await c.execute("select posicion from cursores where fuente = %s", (fuente,))).fetchone()
            return fila["posicion"] if fila else 0

    async def reiniciar(self, fuente: str) -> None:
        async with self.pool.connection() as c:
            await self._cursor(c, fuente, 0)

    async def marcar_al_dia(self, fuente: str) -> None:
        async with self.pool.connection() as c:
            await c.execute("insert into cursores (fuente, al_dia) values (%s, now()) "
                            "on conflict (fuente) do update set al_dia = now()", (fuente,))

    async def frescura(self) -> dict[str, datetime]:
        async with self.pool.connection() as c:
            filas = await (await c.execute("select fuente, al_dia from cursores where al_dia is not null")).fetchall()
            return {f["fuente"]: f["al_dia"] for f in filas}

    async def aplicar_eventos_ventas(self, eventos: list[dict], siguiente: int) -> int:
        # Clave por contenido, no por la posición del outbox: sobrevive a un outbox recreado.
        return await self._aplicar("ventas", eventos, siguiente, self._evento_venta,
                                   lambda e: f"{e['identificador_pedido']}:{e['tipo']}:{e['datos']['fecha_actualización']}")

    async def aplicar_eventos_inventario(self, eventos: list[dict], siguiente: int) -> int:
        return await self._aplicar("inventario", eventos, siguiente, self._evento_inventario, lambda e: e["identificador"])

    async def _aplicar(self, fuente: str, eventos: list[dict], siguiente: int, aplicar, clave) -> int:
        """Lote y cursor en una transacción. Un evento malformado no bloquea la fuente: queda en eventos_rechazados."""
        aplicados = 0
        async with self.pool.connection() as c, c.transaction():
            for evento in eventos:
                try:
                    async with c.transaction():  # punto de guardado: un error deshace solo este evento
                        if await self._nuevo(c, fuente, str(clave(evento))):
                            aplicados += await aplicar(c, evento)
                except Exception as error:
                    await c.execute("insert into eventos_rechazados (fuente, identificador, error, evento) values (%s, %s, %s, %s) "
                                    "on conflict do nothing",
                                    (fuente, str(evento.get("identificador", "?")), f"{type(error).__name__}: {error}"[:300],
                                     Jsonb(json.loads(json.dumps(evento, default=str)))))
            await self._cursor(c, fuente, siguiente)
        return aplicados

    @staticmethod
    async def _evento_venta(c: AsyncConnection, evento: dict) -> int:
        if evento.get("tipo") not in ("pedido_confirmado", "pedido_cancelado"):
            return 0
        datos = evento["datos"]
        # Un pedido solo avanza de estado: se ignora una versión más vieja que la ya registrada.
        await c.execute(
            "insert into pedidos values (%s, %s, %s, %s, %s, %s, %s) on conflict (identificador) do update set "
            "estado = excluded.estado, motivo = excluded.motivo, fecha_actualizacion = excluded.fecha_actualizacion "
            "where pedidos.fecha_actualizacion <= excluded.fecha_actualizacion",
            (datos["identificador"], datos["identificador_cliente"], datos["estado"], centavos(datos["total"]),
             datos.get("motivo"), datos["fecha_creación"], datos["fecha_actualización"]))
        for linea in datos["líneas"]:
            await c.execute(
                "insert into lineas_venta values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
                (datos["identificador"], linea["identificador_variante"], linea["identificador_producto"], linea["sku"],
                 linea["nombre"], linea["categoría"], linea["talla"], linea["color"], linea["cantidad"],
                 centavos(linea["precio"]), centavos(linea["subtotal"])))
        return 1

    @staticmethod
    async def _evento_inventario(c: AsyncConnection, evento: dict) -> int:
        if evento.get("tipo") != "stock_bajo":
            return 0
        await c.execute("insert into alertas_stock values (%s, %s, %s, %s, %s, %s) on conflict do nothing",
                        (evento["identificador"], evento["identificador_variante"], evento["identificador_producto"],
                         evento["disponible"], evento["mínimo"], evento["fecha"]))
        return 1

    async def reemplazar_existencias(self, variantes: list[dict]) -> None:
        async with self.pool.connection() as c, c.transaction():
            async with c.cursor() as cursor:
                await cursor.executemany(
                    "insert into existencias values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
                    "on conflict (variante) do update set producto = excluded.producto, sku = excluded.sku, "
                    "nombre = excluded.nombre, categoria = excluded.categoria, talla = excluded.talla, color = excluded.color, "
                    "fisica = excluded.fisica, reservada = excluded.reservada, disponible = excluded.disponible, "
                    "minimo = excluded.minimo, version = excluded.version, stock_bajo = excluded.stock_bajo, "
                    "activo = excluded.activo, fecha_copia = now()",
                    [(v["identificador"], v["identificador_producto"], v["sku"], v["nombre"], v["categoria"], v["talla"],
                      v["color"], v["física"], v["reservada"], v["disponible"], v["mínimo"], v["versión_sincronización"],
                      v["stock_bajo"], v["activo"]) for v in variantes])
            # Lo que ya no publica el catálogo (producto o variante desactivados) deja de contar como existencia.
            await c.execute("update existencias set activo = false, fecha_copia = now() where activo and not (variante = any(%s::uuid[]))",
                            ([v["identificador"] for v in variantes],))

    @staticmethod
    async def _nuevo(c: AsyncConnection, fuente: str, identificador) -> bool:
        fila = await (await c.execute("insert into eventos_procesados (fuente, identificador) values (%s, %s) "
                                      "on conflict do nothing returning 1", (fuente, str(identificador)))).fetchone()
        return fila is not None

    @staticmethod
    async def _cursor(c: AsyncConnection, fuente: str, posicion: int):
        await c.execute("insert into cursores (fuente, posicion) values (%s, %s) "
                        "on conflict (fuente) do update set posicion = excluded.posicion", (fuente, posicion))

    async def clientes_de_pedidos(self) -> list[str]:
        async with self.pool.connection() as c:
            return [f["cliente"] for f in await (await c.execute("select distinct cliente from pedidos order by 1")).fetchall()]

    async def guardar_nombres(self, nombres: list[dict]) -> None:
        if not nombres:
            return
        async with self.pool.connection() as c, c.transaction():
            async with c.cursor() as cursor:
                await cursor.executemany(
                    "insert into clientes values (%s, %s, %s, now()) on conflict (cliente) do update set "
                    "nombre = excluded.nombre, origen = excluded.origen, fecha_copia = now()",
                    [(n["cliente"], n.get("nombre"), n.get("origen")) for n in nombres])

    # ---- consultas -----------------------------------------------------------------------------------------------
    async def consultar_reporte(self, consulta: dict) -> dict:
        """Reporte v2 sobre el catálogo: SELECT armado solo con expresiones de SQL_CAMPOS y valores enlazados.

        `consulta`: fuente, tipo, columnas, filtros [(campo, operador, valor tipado)], inicio, fin, orden [(campo, dir)],
        limite y grafico {eje, valor} o None. Devuelve filas (listas), total de filas, totales y puntos del gráfico."""
        fuente, tipo, columnas = consulta["fuente"], consulta["tipo"], consulta["columnas"]
        sql = SQL_CAMPOS[fuente]
        parametros: dict = {"inicio": consulta.get("inicio"), "fin": consulta.get("fin"), "limite": consulta["limite"]}
        if fuente == "VENTAS":
            desde = _DESDE_VENTAS
            donde = ["(%(inicio)s::timestamptz is null or p.fecha_creacion >= %(inicio)s)",
                     "(%(fin)s::timestamptz is null or p.fecha_creacion < %(fin)s)"]
            if not any(f[0] == "ESTADO" for f in consulta["filtros"]):
                donde.append("p.estado = 'CONFIRMADO'")
        else:
            desde, donde = "from existencias e", ["e.activo"]
        tener = []
        for i, (campo, operador, valor) in enumerate(consulta["filtros"]):
            expresion = _FILTRO_TEXTO.get(campo, sql[campo])
            parametros[f"f{i}"] = valor
            if operador == "CONTIENE":
                condicion = f"position(lower(%(f{i})s) in lower({expresion})) > 0"
            elif operador == "IGUAL" and isinstance(valor, str):
                condicion = f"lower({expresion}) = lower(%(f{i})s)"
            else:
                condicion = f"{expresion} {_OPERADOR_SQL[operador]} %(f{i})s"
            (tener if _es_metrica(expresion) else donde).append(condicion)
        where = " where " + " and ".join(donde)
        having = (" having " + " and ".join(tener)) if tener else ""
        seleccion = ", ".join(f"{sql[c]} as c{i}" for i, c in enumerate(columnas))
        dims = [i for i, c in enumerate(columnas) if not _es_metrica(sql[c])]
        grupo = (" group by " + ", ".join(str(i + 1) for i in dims)) if tipo == "AGREGADO" and dims else ""
        posicion = {c: i + 1 for i, c in enumerate(columnas)}
        orden = [f"{posicion[c]} {'desc' if d == 'DESC' else 'asc'}" for c, d in consulta["orden"]]
        usados = {o.split()[0] for o in orden}
        orden += [f"{i + 1} asc" for i in range(len(columnas)) if str(i + 1) not in usados]  # orden estable
        sumas = _SUMAS_DETALLE[fuente] if tipo == "DETALLE" else {c: sql[c] for c in columnas if _es_metrica(sql[c])}
        sumas = {c: e for c, e in sumas.items() if c in columnas}
        grafico = consulta.get("grafico")
        async with self.pool.connection() as c:
            # Un reporte nunca bloquea la base: 5 s como máximo por consulta (dentro de la transacción de la conexión).
            await c.execute("set local statement_timeout = '5s'")
            cuerpo = f"select {seleccion} {desde}{where}{grupo}{having}"
            filas = await (await c.execute(f"{cuerpo} order by {', '.join(orden)} limit %(limite)s", parametros)).fetchall()
            total_filas = (await (await c.execute(f"select count(*) n from ({cuerpo}) t", parametros)).fetchone())["n"]
            totales = {}
            if sumas:  # sobre TODAS las filas que cumplen el filtro, no solo las mostradas
                fila = await (await c.execute(
                    f"select {', '.join(f'{e} as t{i}' for i, e in enumerate(sumas.values()))} {desde}{where}", parametros)).fetchone()
                totales = {campo: _plano(fila[f"t{i}"]) or 0 for i, campo in enumerate(sumas)}
            puntos = []
            if grafico:
                orden_g = "1 asc" if grafico["eje"] == "FECHA" else "2 desc nulls last, 1 asc"
                puntos = await (await c.execute(
                    f"select {sql[grafico['eje']]} clave, {sql[grafico['valor']]} valor {desde}{where} group by 1 "
                    f"order by {orden_g} limit 30", parametros)).fetchall()
            sin_nombre = 0
            if fuente == "VENTAS" and ("CLIENTE" in columnas or (grafico or {}).get("eje") == "CLIENTE"):
                sin_nombre = (await (await c.execute(
                    f"select count(distinct p.cliente) n {desde}{where} and c.nombre is null", parametros)).fetchone())["n"]
        return {"filas": [[_plano(f[f"c{i}"]) for i in range(len(columnas))] for f in filas], "total_filas": total_filas,
                "totales": totales, "grafico": [{"clave": _plano(p["clave"]), "valor": _plano(p["valor"]) or 0} for p in puntos],
                "clientes_sin_nombre": sin_nombre}

    async def resumen_ventas(self, desde: datetime | None, agrupar_por: str | None, limite: int, metrica: str = "UNIDADES",
                             fin: datetime | None = None, filtros: dict | None = None, orden: str = "METRICA_DESC") -> dict:
        filtro = ("p.estado = 'CONFIRMADO' and (%(desde)s::timestamptz is null or p.fecha_creacion >= %(desde)s) "
                  "and (%(fin)s::timestamptz is null or p.fecha_creacion < %(fin)s)")
        parametros = {"desde": desde, "fin": fin, "limite": limite}
        for clave, valor in (filtros or {}).items():
            if clave == "producto":  # contiene, sin comodines LIKE del usuario
                filtro += " and position(lower(%(f_producto)s) in lower(l.nombre)) > 0"
            else:
                filtro += f" and lower({COLUMNAS_FILTRO[clave]}) = lower(%(f_{clave})s)"
            parametros[f"f_{clave}"] = valor
        async with self.pool.connection() as c:
            # Un reporte nunca bloquea la base: 5 s como máximo por consulta (dentro de la transacción de la conexión).
            await c.execute("set local statement_timeout = '5s'")
            total = await (await c.execute(
                f"select count(distinct p.identificador) pedidos, coalesce(sum(l.cantidad), 0) unidades, "
                f"coalesce(sum(l.subtotal_centavos), 0) monto from pedidos p join lineas_venta l on l.pedido = p.identificador "
                f"where {filtro}", parametros)).fetchone()
            grupos = []
            if agrupar_por:
                columna = COLUMNAS_GRUPO[agrupar_por]
                # Días: los más recientes (se invierten para leerse en orden); el resto: el top N según el orden pedido.
                if agrupar_por == "DIA":
                    orden_sql = "clave desc"
                elif orden == "CLAVE_ASC":
                    orden_sql = "clave"
                elif orden == "METRICA_ASC":
                    orden_sql = f"{COLUMNA_METRICA[metrica]} asc, clave"
                else:
                    orden_sql = f"{ORDEN_METRICA[metrica]}, clave"
                grupos = await (await c.execute(
                    f"select {columna} clave, count(distinct p.identificador) pedidos, sum(l.cantidad) unidades, "
                    f"sum(l.subtotal_centavos) monto from pedidos p join lineas_venta l on l.pedido = p.identificador "
                    f"where {filtro} group by 1 order by {orden_sql} limit %(limite)s", parametros)).fetchall()
                if agrupar_por == "DIA":
                    grupos.reverse()
        return {"pedidos": total["pedidos"], "unidades": int(total["unidades"]), "monto_centavos": int(total["monto"]),
                "monto": texto_bs(total["monto"]),
                "grupos": [{"clave": g["clave"], "pedidos": g["pedidos"], "unidades": int(g["unidades"]),
                            "monto_centavos": int(g["monto"]), "monto": texto_bs(g["monto"])} for g in grupos]}

    async def productos(self, limite: int) -> list[dict]:
        async with self.pool.connection() as c:
            filas = await (await c.execute(
                "with vendidos as (select l.producto, sum(l.cantidad) unidades, sum(l.subtotal_centavos) monto "
                "from lineas_venta l join pedidos p on p.identificador = l.pedido where p.estado = 'CONFIRMADO' group by 1) "
                "select e.producto identificador, max(e.nombre) nombre, max(e.categoria) categoria, sum(e.disponible) stock, "
                "count(*) variantes, coalesce(max(v.unidades), 0) ventas, coalesce(max(v.monto), 0) monto "
                "from existencias e left join vendidos v on v.producto = e.producto where e.activo "
                "group by e.producto order by ventas desc, nombre limit %s", (limite,))).fetchall()
        return [{**f, "stock": int(f["stock"]), "ventas": int(f["ventas"]), "monto": texto_bs(f["monto"])} for f in filas]

    async def stock_bajo(self) -> list[dict]:
        async with self.pool.connection() as c:
            return await (await c.execute(
                "select variante identificador, producto, sku, nombre, talla, color, disponible, minimo, fecha_copia "
                "from existencias where activo and stock_bajo order by disponible, sku")).fetchall()

    async def alertas(self, limite: int) -> list[dict]:
        async with self.pool.connection() as c:
            return await (await c.execute(
                "select a.identificador, a.variante, coalesce(e.sku, '') sku, coalesce(e.nombre, '') nombre, a.disponible, "
                "a.minimo, a.fecha from alertas_stock a left join existencias e on e.variante = a.variante "
                "order by a.fecha desc limit %s", (limite,))).fetchall()

    async def compras_por_cliente(self, ahora: datetime) -> list[dict]:
        async with self.pool.connection() as c:
            filas = await (await c.execute(
                "select p.cliente, extract(epoch from (%(ahora)s - max(p.fecha_creacion))) / 86400 recencia_dias, "
                "count(distinct p.identificador) frecuencia, sum(l.subtotal_centavos) / 100.0 monto_bs, "
                "count(distinct l.categoria) diversidad from pedidos p join lineas_venta l on l.pedido = p.identificador "
                "where p.estado = 'CONFIRMADO' group by p.cliente order by p.cliente", {"ahora": ahora})).fetchall()
        return [{"cliente": f["cliente"], **{k: float(f[k]) for k in ("recencia_dias", "frecuencia", "monto_bs", "diversidad")}}
                for f in filas]

    # ---- reportes, auditoría y propuestas ------------------------------------------------------------------------
    async def guardar_reporte(self, r: dict) -> None:
        async with self.pool.connection() as c:
            await c.execute("insert into reportes values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                            (r["identificador"], r["usuario"], r["peticion"], r["salida_modelo"], Jsonb(r["especificacion"]),
                             r["generativa"], r["observacion"], Jsonb(json.loads(json.dumps(r["datos"], default=str))),
                             r["datos_al"], r["fecha"], r.get("procedencia")))

    async def reportes(self, limite: int) -> list[dict]:
        async with self.pool.connection() as c:
            return await (await c.execute("select * from reportes order by fecha desc limit %s", (limite,))).fetchall()

    async def reporte(self, identificador: str) -> dict | None:
        async with self.pool.connection() as c:
            return await (await c.execute("select * from reportes where identificador = %s", (identificador,))).fetchone()

    async def auditar(self, usuario, agente, herramienta, argumentos, permitido, resultado) -> None:
        async with self.pool.connection() as c:
            await c.execute("insert into auditoria_agentes (usuario, agente, herramienta, argumentos, permitido, resultado) "
                            "values (%s, %s, %s, %s, %s, %s)",
                            (usuario, agente, herramienta, Jsonb(json.loads(json.dumps(argumentos, default=str))), permitido, resultado[:500]))

    async def auditoria(self, limite: int) -> list[dict]:
        async with self.pool.connection() as c:
            return await (await c.execute("select * from auditoria_agentes order by identificador desc limit %s", (limite,))).fetchall()

    async def guardar_propuesta(self, p: dict) -> bool:
        async with self.pool.connection() as c:
            fila = await (await c.execute(
                "insert into propuestas_reposicion (identificador, variante, sku, cantidad, motivo, estado, usuario) "
                "values (%s, %s, %s, %s, %s, 'PENDIENTE', %s) on conflict do nothing returning 1",
                (p["identificador"], p["variante"], p["sku"], p["cantidad"], p["motivo"], p["usuario"]))).fetchone()
        return fila is not None

    async def propuestas(self, estado: str | None) -> list[dict]:
        async with self.pool.connection() as c:
            return await (await c.execute(
                "select p.identificador, p.variante, p.sku, p.cantidad, p.motivo, p.estado, p.fecha, p.resultado, e.disponible, e.minimo "
                "from propuestas_reposicion p left join existencias e on e.variante = p.variante "
                "where %(estado)s::text is null or p.estado = %(estado)s order by p.fecha desc limit 50", {"estado": estado})).fetchall()

    async def propuesta(self, identificador: str) -> dict | None:
        async with self.pool.connection() as c:
            fila = await (await c.execute("select * from propuestas_reposicion where identificador = %s", (identificador,))).fetchone()
        return {**fila, "identificador": str(fila["identificador"]), "variante": str(fila["variante"])} if fila else None

    async def reclamar_propuesta(self, identificador: str, cuerpo: dict) -> bool:
        async with self.pool.connection() as c:
            fila = await (await c.execute("update propuestas_reposicion set estado = 'CONFIRMANDO', cuerpo = %s "
                                          "where identificador = %s and estado = 'PENDIENTE' returning 1",
                                          (Jsonb(cuerpo), identificador))).fetchone()
        return fila is not None

    async def resolver_propuesta(self, identificador: str, estado: str, resultado: dict, desde: tuple[str, ...]) -> bool:
        async with self.pool.connection() as c:
            fila = await (await c.execute("update propuestas_reposicion set estado = %s, resultado = %s, fecha_resolucion = now() "
                                          "where identificador = %s and estado = any(%s) returning 1",
                                          (estado, Jsonb(json.loads(json.dumps(resultado, default=str))), identificador, list(desde)))).fetchone()
        return fila is not None

    async def guardar_notificacion(self, n: dict) -> bool:
        async with self.pool.connection() as c:
            fila = await (await c.execute(
                "insert into notificaciones (evento, tipo, variante, producto, sku, talla, color, disponible, minimo, mensaje, origen, "
                "fecha_evento) values (%(evento)s, %(tipo)s, %(variante)s, %(producto)s, %(sku)s, %(talla)s, %(color)s, %(disponible)s, "
                "%(minimo)s, %(mensaje)s, %(origen)s, %(fecha_evento)s) on conflict (evento) do nothing returning 1", n)).fetchone()
        return fila is not None

    async def notificacion(self, evento: str) -> dict | None:
        async with self.pool.connection() as c:
            fila = await (await c.execute("select * from notificaciones where evento = %s", (evento,))).fetchone()
        return _notificacion(fila) if fila else None

    async def notificaciones(self, estado: str | None) -> list[dict]:
        async with self.pool.connection() as c:
            filas = await (await c.execute(
                "select * from notificaciones where %(estado)s::text is null or estado = %(estado)s order by fecha desc limit 50",
                {"estado": estado})).fetchall()
        return [_notificacion(f) for f in filas]

    async def atender_notificacion(self, evento: str, usuario: str) -> None:
        async with self.pool.connection() as c:
            await c.execute("update notificaciones set estado = 'ATENDIDA', atendida_por = %s, fecha_atencion = now() "
                            "where evento = %s and estado = 'NUEVA'", (usuario, evento))

    async def variante(self, identificador: str) -> dict | None:
        async with self.pool.connection() as c:
            return await (await c.execute("select * from existencias where variante = %s and activo", (identificador,))).fetchone()
