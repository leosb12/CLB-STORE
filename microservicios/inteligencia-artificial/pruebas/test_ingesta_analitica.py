"""Integración real con PostgreSQL: ingesta idempotente con cursor y consultas del modelo de lectura."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from fuente.aplicacion.ingesta import IngerirEventos
from fuente.aplicacion.interfaces import CursorFueraDeRango

pytestmark = pytest.mark.anyio
AHORA = datetime.now(timezone.utc)


def pedido(cliente, lineas, estado="CONFIRMADO", dias=0):
    fecha = (AHORA - timedelta(days=dias)).isoformat()
    total = sum(c * p for _, _, _, c, p in lineas)
    return {"identificador": str(uuid.uuid4()), "identificador_cliente": cliente, "estado": estado,
            "total": f"{total:.2f}", "motivo": None, "fecha_creación": fecha, "fecha_actualización": fecha,
            "líneas": [{"identificador_variante": str(uuid.uuid4()), "identificador_producto": f"prod-{sku[0]}", "sku": sku,
                        "nombre": f"Prenda {sku}", "categoría": categoria, "talla": talla, "color": "Negro",
                        "cantidad": cantidad, "precio": f"{precio:.2f}", "subtotal": f"{cantidad * precio:.2f}"}
                       for sku, categoria, talla, cantidad, precio in lineas]}


class FuenteFalsa:
    def __init__(self, eventos, por_posicion=False):
        self.registro, self.por_posicion, self.llamadas = eventos, por_posicion, 0

    async def eventos(self, desde):
        self.llamadas += 1
        if self.por_posicion:  # como Inventario: el cursor es una posición
            if desde > len(self.registro):
                raise CursorFueraDeRango()
            lote = self.registro[desde:desde + 2]
            return lote, desde + len(lote)
        lote = [e for e in self.registro if e["identificador"] > desde][:2]
        return lote, (lote[-1]["identificador"] if lote else desde)


class CatalogoFalso:
    def __init__(self, variantes):
        self.lista = variantes

    async def variantes(self):
        return self.lista


def variante(sku, disponible, minimo, producto="prod-A"):
    return {"identificador": str(uuid.uuid4()), "identificador_producto": producto, "sku": sku, "nombre": f"Prenda {producto}",
            "categoria": "Poleras", "talla": "M", "color": "Negro", "física": disponible, "reservada": 0,
            "disponible": disponible, "mínimo": minimo, "versión_sincronización": 3, "stock_bajo": disponible <= minimo,
            "activo": True}


async def test_ingesta_idempotente_consultas_y_reinicio_de_cursor(repositorio):
    p1 = pedido("ana", [("A-M", "Poleras", "M", 2, 100), ("B-L", "Pantalones", "L", 1, 250)])
    p2 = pedido("ana", [("A-M", "Poleras", "M", 1, 100)], dias=3)
    p3 = pedido("beto", [("A-S", "Poleras", "S", 4, 100)], dias=20)
    cancelado = pedido("beto", [("A-S", "Poleras", "S", 9, 100)], estado="CANCELADO")
    ventas = FuenteFalsa([{"identificador": i + 1, "tipo": t, "identificador_pedido": d["identificador"], "datos": d} for i, (t, d) in enumerate(
        [("pedido_confirmado", p1), ("pedido_confirmado", p2), ("pedido_confirmado", p3), ("pedido_cancelado", cancelado)])])
    alertas = [{"identificador": str(uuid.uuid4()), "tipo": "stock_bajo", "identificador_producto": "prod-A",
                "identificador_variante": str(uuid.uuid4()), "disponible": 1, "mínimo": 2, "fecha": AHORA.isoformat()}]
    inventario = FuenteFalsa(alertas, por_posicion=True)
    catalogo = CatalogoFalso([variante("A-M", 8, 2), variante("A-S", 1, 2), variante("B-L", 5, 1, "prod-B")])

    ingesta = IngerirEventos(repositorio, ventas, inventario, catalogo)
    assert await ingesta.ejecutar() == {"ventas": "AL_DIA", "inventario": "AL_DIA", "existencias": "AL_DIA"}
    assert await repositorio.posicion("ventas") == 4

    # Repetir todo desde cero (p. ej., cursor perdido) no duplica pedidos, líneas ni alertas.
    await repositorio.reiniciar("ventas")
    await ingesta.ejecutar()
    semana = await repositorio.resumen_ventas(AHORA - timedelta(days=7), "TALLA", 10)
    assert (semana["pedidos"], semana["unidades"], semana["monto"]) == (2, 4, "550.00")
    assert [(g["clave"], g["unidades"]) for g in semana["grupos"]] == [("M", 3), ("L", 1)]
    todo = await repositorio.resumen_ventas(None, None, 10)
    assert (todo["pedidos"], todo["unidades"], todo["monto_centavos"]) == (3, 8, 95000)

    # Inventario reinicia su registro: el cursor guardado supera el total → se relee desde 0 sin duplicar.
    async with repositorio.pool.connection() as c:
        await c.execute("update cursores set posicion = 99 where fuente = 'inventario'")
    assert (await ingesta.ejecutar())["inventario"] == "AL_DIA"
    assert len(await repositorio.alertas(10)) == 1

    productos = await repositorio.productos(10)
    assert [(p["identificador"], p["stock"], p["ventas"]) for p in productos] == [("prod-A", 9, 7), ("prod-B", 5, 1)]
    assert [v["sku"] for v in await repositorio.stock_bajo()] == ["A-S"]

    # Una variante que el catálogo deja de publicar ya no cuenta.
    catalogo.lista = catalogo.lista[:1]
    await ingesta.ejecutar()
    assert [p["stock"] for p in await repositorio.productos(10)] == [8]

    clientes = {c["cliente"]: c for c in await repositorio.compras_por_cliente(AHORA)}
    assert clientes["ana"]["frecuencia"] == 2 and clientes["ana"]["diversidad"] == 2 and clientes["ana"]["monto_bs"] == 550
    assert round(clientes["beto"]["recencia_dias"]) == 20
    assert set((await repositorio.frescura()).keys()) == {"ventas", "inventario", "existencias"}


async def test_una_fuente_caida_no_detiene_a_las_demas(repositorio):
    class Caida:
        async def eventos(self, desde):
            raise ConnectionError("sin red")

    ingesta = IngerirEventos(repositorio, Caida(), FuenteFalsa([], por_posicion=True), CatalogoFalso([variante("X", 3, 1)]))
    estado = await ingesta.ejecutar()
    assert estado["ventas"].startswith("ERROR") and estado["inventario"] == "AL_DIA" and estado["existencias"] == "AL_DIA"
