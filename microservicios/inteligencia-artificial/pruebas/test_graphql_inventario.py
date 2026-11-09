"""R5 (F1b-II): la gestión de Inventario por GraphQL delega en el contrato REST propietario sin reglas propias.

Se comprueba el reenvío exacto (método, ruta, JWT del admin, Idempotency-Key y cuerpo con `versión_esperada`), la
validación en la frontera y que los rechazos del propietario conserven estado HTTP y cuerpo para las colas offline.
"""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from fuente.aplicacion.interfaces import RechazoDeServicio, ServicioNoDisponible
from fuente.infraestructura.identidad import Usuario
from fuente.infraestructura.servicios_rest import InventarioGestionRest
from fuente.puertos.graphql import esquema_gestion

pytestmark = pytest.mark.anyio
ADMIN = Usuario("admin-sub", frozenset({"admin"}), "jwt-admin")
VARIANTE = "0b6f7c1e-1a2b-4c3d-8e9f-001122334455"
CLAVE = "5d0c2b1a-9f8e-4d7c-a6b5-443322110000"


class InventarioFalso:
    def __init__(self, respuesta=None, error=None):
        self.llamadas, self.respuesta, self.error = [], respuesta or {"ok": True}, error

    async def ejecutar(self, operacion, token, **kw):
        self.llamadas.append((operacion, token, kw))
        if self.error:
            raise self.error
        return self.respuesta


async def _ejecutar(consulta, variables=None, inventario=None):
    contexto = {"usuario": ADMIN, "servicios": SimpleNamespace(inventario_gestion=inventario or InventarioFalso()),
                "trabajo_llm": asyncio.Semaphore(1), "consultas": None}
    return await esquema_gestion.execute(consulta, variable_values=variables, context_value=contexto)


MOVIMIENTO = """mutation($v: String!, $c: String!, $d: JSON!) {
  registrarMovimiento(variante: $v, clave: $c, datos: $d) }"""


async def test_movimiento_reenvia_clave_version_y_jwt_del_admin():
    inventario = InventarioFalso({"variante": {"identificador": VARIANTE, "versión_sincronización": 4}})
    datos = {"tipo": "ENTRADA", "cantidad": 3, "motivo": "Reposición", "versión_esperada": 3}
    r = await _ejecutar(MOVIMIENTO, {"v": VARIANTE, "c": CLAVE, "d": datos}, inventario)
    assert r.errors is None and r.data["registrarMovimiento"]["variante"]["versión_sincronización"] == 4
    assert inventario.llamadas == [("registrar_movimiento", "jwt-admin", {"ruta": {"variante": VARIANTE}, "clave": CLAVE,
                                                                          "datos": datos, "consulta": None})]


async def test_conflicto_de_version_conserva_estado_y_entidad_vigente():
    vigente = {"mensaje": "Otra escritura ganó.", "código": "CONFLICTO_VERSION", "variante": {"versión_sincronización": 5}}
    r = await _ejecutar(MOVIMIENTO, {"v": VARIANTE, "c": CLAVE, "d": {"versión_esperada": 3}},
                        InventarioFalso(error=RechazoDeServicio(409, vigente)))
    extensiones = r.errors[0].extensions
    assert extensiones["estado_http"] == 409 and extensiones["codigo"] == "CONFLICTO_VERSION"
    assert extensiones["cuerpo"] == vigente  # la cola guarda la entidad vigente para la revisión


async def test_inventario_caido_es_reintentable_con_la_misma_clave():
    r = await _ejecutar(MOVIMIENTO, {"v": VARIANTE, "c": CLAVE, "d": {"versión_esperada": 3}},
                        InventarioFalso(error=ServicioNoDisponible("sin respuesta")))
    assert r.errors[0].extensions["estado_http"] == 503


@pytest.mark.parametrize("variante,clave", [("../interno/eventos", CLAVE), ("a/b", CLAVE), (VARIANTE, "corta"),
                                            (VARIANTE, "con espacio 12345")])
async def test_identificadores_y_claves_invalidos_no_llegan_al_propietario(variante, clave):
    inventario = InventarioFalso()
    r = await _ejecutar(MOVIMIENTO, {"v": variante, "c": clave, "d": {}}, inventario)
    assert r.errors[0].extensions["estado_http"] == 422 and inventario.llamadas == []


async def test_datos_deben_ser_objeto_y_paginacion_acotada():
    inventario = InventarioFalso()
    r = await _ejecutar(MOVIMIENTO, {"v": VARIANTE, "c": CLAVE, "d": [1, 2]}, inventario)
    assert r.errors[0].extensions["estado_http"] == 422
    r = await _ejecutar("{ productosAdmin(pagina: 1, limite: 500) }", inventario=inventario)
    assert r.errors[0].extensions["estado_http"] == 422 and inventario.llamadas == []
    r = await _ejecutar("{ productosAdmin(pagina: 2) }", inventario=inventario)
    assert r.errors is None and inventario.llamadas[-1][2]["consulta"] == {"página": 2, "límite": 100}


async def test_adaptador_usa_la_ruta_y_cabeceras_del_contrato_propietario():
    vistas = []

    def responder(solicitud: httpx.Request):
        vistas.append(solicitud)
        if solicitud.url.path.endswith("/publicar"):
            return httpx.Response(409, json={"mensaje": "Avisos sin aceptar.", "código": "AVISOS_SIN_ACEPTAR"})
        if "fallo" in solicitud.url.path:
            return httpx.Response(500, json={"mensaje": "error"})
        return httpx.Response(200, json={"variante": {"identificador": VARIANTE}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(responder)) as http:
        inventario = InventarioGestionRest(http, "http://inventario:8000")
        await inventario.ejecutar("fijar_minimo", "jwt", ruta={"variante": VARIANTE}, clave=CLAVE, datos={"mínimo": 2})
        with pytest.raises(RechazoDeServicio) as rechazo:
            await inventario.ejecutar("publicar_recurso", "jwt", ruta={"producto": "p1", "trabajo": "t1"}, clave=CLAVE,
                                      datos={"versión_esperada": 2})
        with pytest.raises(ServicioNoDisponible):
            await inventario.ejecutar("variante_admin", "jwt", ruta={"variante": "fallo"})
    primera = vistas[0]
    assert (primera.method, primera.url.path) == ("PUT", f"/api/v1/variantes/{VARIANTE}/minimo")
    assert primera.headers["authorization"] == "Bearer jwt" and primera.headers["idempotency-key"] == CLAVE
    assert json.loads(primera.content) == {"mínimo": 2}
    assert vistas[1].url.path == "/api/v1/productos/p1/recursos-probador/t1/publicar"
    assert rechazo.value.estado == 409 and rechazo.value.cuerpo["código"] == "AVISOS_SIN_ACEPTAR"
