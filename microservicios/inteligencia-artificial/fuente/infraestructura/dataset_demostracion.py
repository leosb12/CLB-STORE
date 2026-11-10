"""Dataset sintético de inteligencia de negocios (~10.000 registros) y su repositorio, en un esquema propio de clb_analitica.

Comandos (dentro del contenedor de IA, o con las variables CLB_ANALITICA_* en local):
    python -m fuente.infraestructura.dataset_demostracion generar   # reemplaza el conjunto; invalida la segmentación
    python -m fuente.infraestructura.dataset_demostracion entrenar  # K-Means sobre el dataset completo (una vez)
    python -m fuente.infraestructura.dataset_demostracion estado

Aislamiento: solo escribe en `CLB_BI_ESQUEMA` (demo_*, distinto del operativo). No llama a otros servicios ni emite
eventos: no toca Ventas, Inventario, Clientes, puntos ni n8n. Generación determinista: misma semilla → mismo hash.
Las tablas de ventas, existencias y clientes son las mismas de `ESQUEMA`, así los reportes y KPI usan el mismo SQL.
"""
import asyncio
import calendar
import codecs
import hashlib
import json
import random
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone

from psycopg.types.json import Jsonb

from fuente.dominio import demostracion
from fuente.infraestructura.analitica import RepositorioPostgres

ZONA = timezone(timedelta(hours=-4))  # America/La_Paz, sin horario de verano
ESPACIO = uuid.UUID("6f1c2a52-0d1b-4c8e-9a51-6c6c62000b15")  # UUID5 propios: no chocan con identificadores reales

# Catálogo limpio del equipo (infraestructura/datos-equipo/semilla): nombre, categoría, precio en centavos, color.
PRODUCTOS = (
    ("Polera gris jaspeada", "Poleras", 9900, "Gris"), ("Polera roja de cuello redondo", "Poleras", 9900, "Rojo"),
    ("Camisa negra de manga larga", "Camisas", 21900, "Negro"), ("Chaqueta roja con cierre", "Chaquetas", 31900, "Rojo"),
    ("Chaqueta deportiva azul y blanca", "Chaquetas", 28900, "Azul"),
    ("Vestido corto negro y burdeos", "Vestidos", 27900, "Negro"), ("Jean celeste recto", "Pantalones", 24900, "Celeste"),
    ("Jean claro gastado", "Pantalones", 23900, "Celeste"), ("Jean índigo", "Pantalones", 26900, "Índigo"),
    ("Buzo gris con capucha", "Buzos", 22900, "Gris"), ("Buzo azul con capucha", "Buzos", 22900, "Azul"),
    ("Polerón verde cuello redondo", "Buzos", 19900, "Verde"), ("Suéter gris cuello en V", "Suéteres", 21900, "Gris"),
    ("Suéter burdeos", "Suéteres", 23900, "Burdeos"),
)
TALLAS = ("S", "M", "L", "XL")
PESO_TALLA = (0.22, 0.36, 0.28, 0.14)
# Estacionalidad de Bolivia: invierno (may–ago) abrigos; verano y fin de año poleras y vestidos; diciembre fuerte.
MES = {1: 0.85, 2: 0.8, 3: 0.9, 4: 0.95, 5: 1.1, 6: 1.25, 7: 1.3, 8: 1.05, 9: 0.95, 10: 1.0, 11: 1.15, 12: 1.7}
ABRIGO = {"Chaquetas", "Buzos", "Suéteres"}
VERANO = {"Poleras", "Vestidos"}
# Arquetipos de comportamiento (el modelo no los ve: K-Means debe descubrir grupos parecidos solo con las compras).
# (nombre, proporción, pedidos mín–máx, líneas por pedido mín–máx, pesos de cantidad 1/2/3,
#  días hacia atrás desde el corte [desde, hasta], días de la última compra [desde, hasta])
ARQUETIPOS = (
    ("frecuente", 0.15, (8, 12), (1, 1), (0.9, 0.1, 0.0), (0, 669), (0, 20)),
    ("recurrente", 0.25, (3, 4), (1, 2), (0.8, 0.17, 0.03), (0, 669), (15, 90)),
    ("ocasional", 0.35, (1, 1), (1, 2), (0.85, 0.15, 0.0), (0, 669), (150, 300)),
    ("dormido", 0.15, (4, 6), (1, 2), (0.8, 0.17, 0.03), (450, 669), (450, 560)),
    ("alto_gasto", 0.10, (2, 3), (3, 4), (0.3, 0.45, 0.25), (0, 669), (0, 60)),
)
CLIENTES = 1000
CANCELADOS = 0.06


def _id(*partes) -> str:
    return str(uuid.uuid5(ESPACIO, ":".join(map(str, partes))))


def _precio(base: int, dia: date) -> int:
    """Precio histórico: subió 5 % en 2026 (redondeado a Bs enteros). Las líneas guardan el del día de la venta."""
    return base if dia.year < 2026 else round(base * 1.05 / 100) * 100


def generar(semilla: int = demostracion.SEMILLA) -> tuple[dict[str, list[tuple]], dict]:
    """Filas por tabla (en el orden de columnas de ESQUEMA) y metadatos con el hash SHA-256 del contenido."""
    azar = random.Random(semilla)
    dias = [(demostracion.CORTE - timedelta(days=d)) for d in range((demostracion.CORTE - demostracion.INICIO).days + 1)]
    total_dias = len(dias)
    # Peso por día: estacionalidad × crecimiento suave (la tienda vende algo más con el tiempo).
    peso_dia = [MES[d.month] * (0.75 + 0.5 * (total_dias - i) / total_dias) for i, d in enumerate(dias)]

    variantes = []
    for p, (nombre, categoria, precio, color) in enumerate(PRODUCTOS):
        producto = _id("producto", p)
        sku_base = f"DEMO-{p + 1:02d}"
        for talla in TALLAS:
            variantes.append({"variante": _id("variante", p, talla), "producto": producto, "sku": f"{sku_base}-{talla}",
                              "nombre": nombre, "categoria": categoria, "talla": talla, "color": color, "precio": precio})
    por_talla = {t: [v for v in variantes if v["talla"] == t] for t in TALLAS}

    clientes, pedidos, lineas = [], [], []
    cortes = [sum(a[1] for a in ARQUETIPOS[:i + 1]) for i in range(len(ARQUETIPOS))]
    for n in range(CLIENTES):
        cliente = f"demo-cliente-{n + 1:04d}"
        clientes.append((cliente, f"Cliente demo {n + 1:04d}", "DEMOSTRACION"))
        arquetipo = next(a for a, c in zip(ARQUETIPOS, cortes) if (n + 0.5) / CLIENTES <= c)
        _, _, (minimo, maximo), (lineas_min, lineas_max), pesos_cantidad, (reciente, antiguo), (ultima_min, ultima_max) = arquetipo
        talla = azar.choices(TALLAS, PESO_TALLA)[0]
        ultima = azar.randint(ultima_min, min(ultima_max, total_dias - 1))  # la compra más reciente define la recencia del arquetipo
        indices = range(max(reciente, ultima), min(antiguo, total_dias - 1) + 1)
        elegidos = [ultima] + azar.choices(indices, [peso_dia[i] for i in indices], k=azar.randint(minimo, maximo) - 1)
        for k, i in enumerate(sorted(elegidos, reverse=True)):
            dia = dias[i]
            momento = datetime.combine(dia, time(azar.randint(9, 21), azar.randint(0, 59)), ZONA)
            pedido = _id("pedido", n, k)
            estado = "CANCELADO" if azar.random() < CANCELADOS else "CONFIRMADO"
            temporada = ABRIGO if dia.month in (5, 6, 7, 8) else VERANO if dia.month in (11, 12, 1, 2) else set()
            usados, total = set(), 0
            for _ in range(azar.randint(lineas_min, lineas_max)):
                # La talla comprada coincide con la habitual del cliente casi siempre; a veces prueba una vecina.
                t = talla if azar.random() < 0.85 else TALLAS[min(3, max(0, TALLAS.index(talla) + azar.choice((-1, 1))))]
                opciones = [v for v in por_talla[t] if v["variante"] not in usados]
                v = azar.choices(opciones, [2.2 if v["categoria"] in temporada else 1.0 for v in opciones])[0]
                usados.add(v["variante"])
                cantidad = azar.choices((1, 2, 3), pesos_cantidad)[0]
                precio = _precio(v["precio"], dia)
                total += cantidad * precio
                lineas.append((pedido, v["variante"], v["producto"], v["sku"], v["nombre"], v["categoria"], v["talla"],
                               v["color"], cantidad, precio, cantidad * precio))
            motivo = "Cancelado por el cliente (sintético)" if estado == "CANCELADO" else None
            pedidos.append((pedido, cliente, estado, total, motivo, momento, momento + timedelta(minutes=5)))

    existencias = []
    for v in variantes:
        fisica = azar.randint(0, 40)
        reservada = min(fisica, azar.randint(0, 3))
        disponible, minimo = fisica - reservada, 5
        existencias.append((v["variante"], v["producto"], v["sku"], v["nombre"], v["categoria"], v["talla"], v["color"],
                            fisica, reservada, disponible, minimo, 1, disponible <= minimo, True))

    filas = {"clientes": clientes, "pedidos": pedidos, "lineas_venta": lineas, "existencias": existencias}
    contenido = json.dumps(filas, default=str, ensure_ascii=False, sort_keys=True).encode()
    meta = {"semilla": semilla, "hash": hashlib.sha256(contenido).hexdigest(),
            "registros": {t: len(f) for t, f in filas.items()}, "fecha_corte": demostracion.CORTE.isoformat(),
            "inicio": demostracion.INICIO.isoformat()}
    meta["total_registros"] = sum(meta["registros"].values())
    return filas, meta


ESQUEMA_DEMOSTRACION = """
create table if not exists dataset_demostracion (
    unico boolean primary key default true check (unico), semilla integer not null, hash text not null,
    registros jsonb not null, total_registros integer not null, inicio date not null, fecha_corte date not null,
    generado timestamptz not null default now());
create table if not exists modelos_demostracion (
    tipo text primary key, hash_dataset text not null, resultado jsonb not null, entrenado timestamptz not null default now());
"""
COLUMNAS = {
    "clientes": "cliente, nombre, origen",
    "pedidos": "identificador, cliente, estado, total_centavos, motivo, fecha_creacion, fecha_actualizacion",
    "lineas_venta": "pedido, variante, producto, sku, nombre, categoria, talla, color, cantidad, precio_centavos, subtotal_centavos",
    "existencias": "variante, producto, sku, nombre, categoria, talla, color, fisica, reservada, disponible, minimo, version, "
                   "stock_bajo, activo",
}


def _bs(columna: str) -> str:
    """Centavos → texto en Bs con coma decimal (Excel en español lo lee como número)."""
    return f"replace(to_char({columna} / 100.0, 'FM9999999990.00'), '.', ',')"


# Exportación CSV: consultas fijas por nombre (lista blanca); el nombre de tabla nunca llega al SQL desde afuera.
EXPORTACIONES = {
    "completo": (
        "select to_char(p.fecha_creacion at time zone 'America/La_Paz', 'YYYY-MM-DD HH24:MI') fecha, "
        "p.identificador pedido, p.estado, p.cliente, c.nombre cliente_nombre, l.producto, l.sku, l.nombre producto_nombre, "
        "l.categoria, l.talla, l.color, l.cantidad, l.precio_centavos, l.subtotal_centavos, "
        f"{_bs('l.subtotal_centavos')} subtotal_bs, p.total_centavos total_pedido_centavos, e.disponible stock_disponible_actual "
        "from pedidos p join lineas_venta l on l.pedido = p.identificador left join clientes c on c.cliente = p.cliente "
        "left join existencias e on e.variante = l.variante order by p.fecha_creacion, p.identificador, l.sku"),
    "clientes": "select cliente, nombre, origen from clientes order by cliente",
    "pedidos": ("select identificador, cliente, estado, total_centavos, " + _bs("total_centavos") + " total_bs, motivo, "
                "to_char(fecha_creacion at time zone 'America/La_Paz', 'YYYY-MM-DD HH24:MI') fecha_creacion "
                "from pedidos order by fecha_creacion, identificador"),
    "lineas_venta": ("select pedido, variante, producto, sku, nombre, categoria, talla, color, cantidad, precio_centavos, "
                     "subtotal_centavos, " + _bs("subtotal_centavos") + " subtotal_bs from lineas_venta order by pedido, sku"),
    "existencias": ("select variante, producto, sku, nombre, categoria, talla, color, fisica, reservada, disponible, minimo, "
                    "stock_bajo from existencias order by sku"),
}


class RepositorioDemostracion(RepositorioPostgres):
    """El mismo modelo de lectura (mismas consultas de reportes) en el esquema de demostración, más sus metadatos."""

    def __init__(self, conexion: str, esquema: str, operativo: str = "public"):
        super().__init__(conexion, demostracion.esquema_valido(esquema, operativo))

    async def abrir(self):
        await super().abrir()
        async with self.pool.connection() as c:
            await c.execute(ESQUEMA_DEMOSTRACION)

    async def reemplazar(self, filas: dict[str, list[tuple]], meta: dict) -> None:
        """Todo o nada: el conjunto anterior y su segmentación desaparecen en la misma transacción que entra el nuevo."""
        async with self.pool.connection() as c, c.transaction():
            await c.execute("truncate lineas_venta, pedidos, existencias, clientes, modelos_demostracion, dataset_demostracion")
            async with c.cursor() as cursor:
                for tabla, columnas in COLUMNAS.items():
                    async with cursor.copy(f"copy {tabla} ({columnas}) from stdin") as copia:
                        for fila in filas[tabla]:
                            await copia.write_row(fila)
            await c.execute("insert into dataset_demostracion (semilla, hash, registros, total_registros, inicio, fecha_corte) "
                            "values (%s, %s, %s, %s, %s, %s)",
                            (meta["semilla"], meta["hash"], Jsonb(meta["registros"]), meta["total_registros"],
                             meta["inicio"], meta["fecha_corte"]))

    async def metadatos(self) -> dict | None:
        async with self.pool.connection() as c:
            fila = await (await c.execute("select * from dataset_demostracion")).fetchone()
        if not fila:
            return None
        return {**fila, "inicio": fila["inicio"].isoformat(), "fecha_corte": fila["fecha_corte"].isoformat(),
                "generado": fila["generado"].isoformat()}

    async def conteos(self) -> dict[str, int]:
        """Registros presentes ahora mismo (no los declarados al generar)."""
        async with self.pool.connection() as c:
            fila = await (await c.execute(
                "select (select count(*) from clientes) clientes, (select count(*) from pedidos) pedidos, "
                "(select count(*) from lineas_venta) lineas_venta, (select count(*) from existencias) existencias")).fetchone()
        return dict(fila)

    async def exportar_csv(self, nombre: str) -> bytes:
        """CSV (UTF-8 con BOM, separador «;») de una exportación de la lista blanca, generado por PostgreSQL con COPY."""
        partes = [codecs.BOM_UTF8]  # Excel reconoce UTF-8 (tildes y ñ) por la marca de orden de bytes
        async with self.pool.connection() as c, c.cursor() as cursor:
            async with cursor.copy(f"copy ({EXPORTACIONES[nombre]}) to stdout with (format csv, header, delimiter ';')") as copia:
                async for bloque in copia:
                    partes.append(bytes(bloque))
        return b"".join(partes)

    async def guardar_segmentacion(self, hash_dataset: str, resultado: dict) -> None:
        async with self.pool.connection() as c:
            await c.execute("insert into modelos_demostracion (tipo, hash_dataset, resultado) values ('kmeans', %s, %s) "
                            "on conflict (tipo) do update set hash_dataset = excluded.hash_dataset, resultado = excluded.resultado, "
                            "entrenado = now()", (hash_dataset, Jsonb(json.loads(json.dumps(resultado, default=str)))))

    async def segmentacion(self) -> dict | None:
        """La segmentación guardada solo vale para el dataset con el que se entrenó (mismo hash)."""
        async with self.pool.connection() as c:
            fila = await (await c.execute(
                "select m.resultado, m.entrenado from modelos_demostracion m join dataset_demostracion d "
                "on d.hash = m.hash_dataset where m.tipo = 'kmeans'")).fetchone()
        return {**fila["resultado"], "entrenado": fila["entrenado"].isoformat()} if fila else None


def _repositorio() -> RepositorioDemostracion:
    import os
    from fuente.infraestructura.configuracion import Configuracion
    c = Configuracion() if os.environ.get("CLB_IDENTIDAD_EMISOR") else None
    if c:
        conexion, operativo = c.conexion, c.analitica_esquema
    else:  # fuera del contenedor: solo la base, sin la configuración completa del servicio
        from psycopg.conninfo import make_conninfo
        conexion = make_conninfo(host=os.environ.get("CLB_ANALITICA_SERVIDOR", "127.0.0.1"),
                                 port=os.environ.get("CLB_ANALITICA_PUERTO", "5432"), dbname="clb_analitica",
                                 user="clb_analitica", password=os.environ["CLB_ANALITICA_CLAVE"])
        operativo = os.environ.get("CLB_ANALITICA_ESQUEMA", "public")
    return RepositorioDemostracion(conexion, os.environ.get("CLB_BI_ESQUEMA", "demo_bi"), operativo)


async def entrenar(repo: RepositorioDemostracion) -> dict:
    """K-Means existente (AgrupadorKMeans + nombres de dominio/segmentos) sobre el comportamiento de TODOS los clientes
    sintéticos a la fecha de corte. Se ejecuta una vez y se guarda; el tablero solo lo lee."""
    from fuente.aplicacion.consultas import ConsultarAnalitica
    from fuente.infraestructura.aprendizaje import AgrupadorKMeans
    meta = await repo.metadatos()
    if not meta:
        raise RuntimeError("No hay dataset de demostración: ejecute primero «generar».")
    corte = datetime.combine(date.fromisoformat(meta["fecha_corte"]) + timedelta(days=1), time(), ZONA)
    resultado = await ConsultarAnalitica(repo, AgrupadorKMeans(), reloj=lambda: corte).segmentos(con_puntos=True)
    resultado.update({"alcance": demostracion.ALCANCE_SEGMENTACION, "fecha_corte": meta["fecha_corte"],
                      "hash_dataset": meta["hash"], "semilla_kmeans": 7, "datos_al": None})
    await repo.guardar_segmentacion(meta["hash"], resultado)
    return resultado


async def _principal(orden: str) -> None:
    repo = _repositorio()
    await repo.abrir()
    try:
        if orden == "generar":
            filas, meta = generar()
            await repo.reemplazar(filas, meta)
            print(f"✓ {meta['total_registros']} registros en {repo.esquema} {meta['registros']} · hash {meta['hash'][:16]}… "
                  "· segmentación anterior invalidada: ejecute «entrenar».")
        elif orden == "entrenar":
            r = await entrenar(repo)
            print(f"✓ K-Means sobre {r['clientes']} clientes · silueta {r['silueta']} · "
                  + ", ".join(f"{s['nombre']} ({s['clientes']})" for s in r["segmentos"]))
        elif orden == "estado":
            meta, seg = await repo.metadatos(), await repo.segmentacion()
            print(json.dumps({"esquema": repo.esquema, "dataset": meta, "conteos": await repo.conteos(),
                              "segmentacion": {k: seg[k] for k in ("clientes", "silueta", "entrenado", "hash_dataset")} if seg
                              else "pendiente: ejecute «entrenar»"}, ensure_ascii=False, indent=2, default=str))
        else:
            raise SystemExit("Uso: python -m fuente.infraestructura.dataset_demostracion generar|entrenar|estado")
    finally:
        await repo.cerrar()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(_principal(sys.argv[1] if len(sys.argv) > 1 else ""))
