"""Regresión del 10-nov-2026 en la nube: fechas de la petición frente a las del modelo, «ingresos» como total y el
verificador de cifras con años. Sin base de datos: modelo de lenguaje doble con la salida textual registrada en la nube."""
from datetime import date, datetime

import pytest

from fuente.aplicacion.agentes import cifras_no_respaldadas
from fuente.aplicacion.reportes import GenerarReporte, ReporteAmbiguo, esquema_modelo
from fuente.dominio.fechas_peticion import fechas_pedidas
from fuente.dominio.reglas_reportes import interpretar_por_reglas
from fuente.dominio.reportes import ZONA_BOLIVIA
from pruebas.test_reportes_v2 import LlmFijo

pytestmark = pytest.mark.anyio

# Salida textual de qwen3:8b para «Ingresos de octubre de 2026 del conjunto de demostración» (reporte 10667a53…):
# limite 0 y periodo MES_PASADO con fechas. Antes caía a las reglas sin decir por qué.
SALIDA_NUBE = {"titulo": "Ingresos de octubre de 2026 del conjunto de demostración", "fuente": "VENTAS", "tipo": "AGREGADO",
               "columnas": ["MES", "UNIDADES", "MONTO"], "filtros": [], "periodo": "MES_PASADO", "desde": "2026-10-01",
               "hasta": "2026-10-31", "orden": [], "limite": 0, "grafico": {"tipo": "LINEAS", "eje": "MES", "valor": "MONTO"},
               "formatos": [], "faltantes": [], "aclaracion": ""}
PETICION = "Ingresos de octubre de 2026 del conjunto de demostración"
HOY = date(2026, 11, 10)


async def _interpretar(salida: dict, peticion: str) -> dict:
    return await GenerarReporte(LlmFijo(salida), None, None).interpretar(peticion)


async def test_salida_real_del_modelo_es_un_agregado_de_monto_del_mes_pedido():
    assert esquema_modelo()["properties"]["limite"] == {"type": "integer", "minimum": 1, "maximum": 500}
    r = await _interpretar(SALIDA_NUBE, PETICION)
    e = r["especificacion"]
    assert (r["procedencia"], e.conjunto, e.tipo, e.columnas, e.periodo, str(e.desde), str(e.hasta), e.limite) == \
        ("MODELO", "DEMOSTRACION", "AGREGADO", ["MONTO"], "RANGO", "2026-10-01", "2026-10-31", 200)
    assert any("límite válido" in n for n in r["notas"])


async def test_ingresos_es_agregado_de_monto_con_el_modelo_y_con_las_reglas():
    # El modelo propone el detalle de cada venta: la petición pide un total, se muestra agregado (anotado).
    detalle = {**SALIDA_NUBE, "tipo": "DETALLE", "columnas": ["SUBTOTAL"], "limite": 200, "periodo": "RANGO",
               "grafico": {"tipo": "NINGUNO", "eje": "", "valor": ""}}
    r = await _interpretar(detalle, PETICION)
    assert (r["especificacion"].tipo, r["especificacion"].columnas) == ("AGREGADO", ["MONTO"])
    assert any("se muestra agregado" in n for n in r["notas"])
    for texto in (PETICION, "ingresos de octubre"):
        spec, _, pregunta = interpretar_por_reglas(texto, HOY)
        assert pregunta is None and (spec["tipo"], spec["columnas"], spec["periodo"], spec["desde"], spec["hasta"]) == \
            ("AGREGADO", ["MONTO"], "RANGO", "2026-10-01", "2026-10-31"), texto
    assert "Sin año indicado: se tomó octubre de 2026." in interpretar_por_reglas("ingresos de octubre", HOY)[1]
    assert interpretar_por_reglas("detalle de ventas con cliente y total de octubre de 2026", HOY)[0]["tipo"] == "DETALLE"


async def test_sin_anio_el_modelo_puede_elegir_otro_anio_para_los_mismos_dias_pero_no_otro_mes():
    hoy = datetime.now(ZONA_BOLIVIA).date()
    ultimo = hoy.year if hoy.month >= 10 else hoy.year - 1
    # En vivo (10-nov-2026) qwen3:8b propuso octubre de 2023 para «ingresos de octubre».
    r = await _interpretar({**SALIDA_NUBE, "limite": 200, "periodo": "RANGO", "desde": "2023-10-01", "hasta": "2023-10-31"},
                           "ingresos de octubre del conjunto de demostración")
    e = r["especificacion"]
    assert (e.tipo, e.columnas, str(e.desde), str(e.hasta)) == ("AGREGADO", ["MONTO"], f"{ultimo}-10-01", f"{ultimo}-10-31")
    assert any("sin año indicado se usó el último transcurrido" in n for n in r["notas"])
    assert any(f"Sin año indicado: se tomó octubre de {ultimo}" in n for n in r["notas"])
    with pytest.raises(ReporteAmbiguo, match="¿Qué periodo quieres"):
        await _interpretar({**SALIDA_NUBE, "periodo": "RANGO", "desde": "2023-09-01", "hasta": "2023-09-30"},
                           "ingresos de octubre del conjunto de demostración")


async def test_fecha_unica_es_ese_dia_completo():
    peticion = "Ingresos del 15 de octubre de 2026 del conjunto de demostración"
    for salida in ({**SALIDA_NUBE, "periodo": "RANGO", "desde": "2026-10-15", "hasta": "2026-10-15"},
                   {**SALIDA_NUBE, "periodo": "TODO", "desde": "2026-10-15", "hasta": ""}):  # el modelo dio media fecha
        r = await _interpretar(salida, peticion)
        e = r["especificacion"]
        assert (e.periodo, str(e.desde), str(e.hasta)) == ("RANGO", "2026-10-15", "2026-10-15")
        assert any("Un solo día" in n for n in r["notas"])
    spec, notas, _ = interpretar_por_reglas("ventas del 15/10/2026", HOY)
    assert (spec["desde"], spec["hasta"]) == ("2026-10-15", "2026-10-15") and any("Un solo día" in n for n in notas)


async def test_rango_incompleto_desde_llega_a_hoy_y_hasta_pregunta_el_inicio():
    hoy = datetime.now(ZONA_BOLIVIA).date()
    r = await _interpretar({**SALIDA_NUBE, "periodo": "TODO", "desde": "2026-10-01", "hasta": ""},
                           "ingresos desde el 01/10/2026 del conjunto de demostración")
    e = r["especificacion"]
    assert (e.periodo, str(e.desde), e.hasta) == ("RANGO", "2026-10-01", hoy)
    assert any("«Desde» sin fecha final" in n for n in r["notas"])
    for salida in ({**SALIDA_NUBE, "periodo": "TODO", "desde": "", "hasta": "2026-10-15"}, SALIDA_NUBE):
        with pytest.raises(ReporteAmbiguo, match="¿desde qué fecha"):
            await _interpretar(salida, "ingresos hasta el 15/10/2026 del conjunto de demostración")
    assert interpretar_por_reglas("ventas hasta el 15/10/2026", HOY)[2].endswith("¿desde qué fecha?")
    assert fechas_pedidas("ventas desde el 01/10/2026", HOY).hasta == HOY


async def test_fechas_contradictorias_piden_aclaracion():
    with pytest.raises(ReporteAmbiguo, match=r"pide del 01/10/2026 al 31/10/2026.*propuso del 01/09/2026 al 30/09/2026"):
        await _interpretar({**SALIDA_NUBE, "periodo": "RANGO", "desde": "2026-09-01", "hasta": "2026-09-30"}, PETICION)
    # Sin fechas en la petición: fechas del modelo que contradicen el periodo relativo pedido.
    with pytest.raises(ReporteAmbiguo, match="semana pasada"):
        await _interpretar({**SALIDA_NUBE, "periodo": "RANGO", "desde": "2026-01-01", "hasta": "2026-01-07"},
                           "ingresos de la semana pasada")
    # Fechas del modelo que contradicen su propio periodo.
    with pytest.raises(ReporteAmbiguo, match="¿Qué periodo quieres"):
        await _interpretar({**SALIDA_NUBE, "periodo": "ESTA_SEMANA", "desde": "2026-01-01", "hasta": "2026-01-07"},
                           "ingresos del conjunto de demostración")
    # Varias fechas sueltas sin conector de rango.
    assert fechas_pedidas("ventas del 01/10/2026 y ventas del 15/11/2025", HOY).pregunta


async def test_si_igual_cae_a_las_reglas_la_observacion_dice_el_error_concreto():
    salida = {**SALIDA_NUBE, "limite": 200, "filtros": [{"campo": "ESTADO", "operador": "IGUAL", "valor": "PENDIENTE"}]}
    r = await _interpretar(salida, PETICION + " con estado pendiente")
    assert r["procedencia"] == "REGLAS" and "Detalle: El estado de un pedido es CONFIRMADO o CANCELADO" in r["observacion"]


def test_el_verificador_ignora_fechas_respaldadas_pero_no_importes_iguales_al_anio():
    datos = [{"periodo": "del 01/10/2026 al 31/10/2026", "ingresos_bs": "138450.00", "pedidos_confirmados": 276}]
    mision = "¿Cuáles fueron los ingresos de octubre de 2026 en el conjunto de demostración?"
    assert cifras_no_respaldadas("Los ingresos de octubre de 2026 fueron Bs 138,450.00 en 276 pedidos.", datos, mision) == []
    assert cifras_no_respaldadas("Del 01/10/2026 al 31/10/2026 hubo 276 pedidos.", datos) == []  # año del periodo
    # Importe inventado igual al año: la fecha se ignora, el importe no.
    assert cifras_no_respaldadas("En octubre de 2026 se vendieron 2026 Bs.", datos, mision) == ["2026"]
    assert cifras_no_respaldadas("En 2026 hubo 276 pedidos.", datos, mision) == ["2026"]  # año suelto: no es fecha
    assert cifras_no_respaldadas("En octubre de 2025 hubo 276 pedidos.", datos, mision) == ["2025"]  # año sin respaldo
    assert cifras_no_respaldadas("Las ventas fueron 99999.", datos, "dime si fueron 99999") == ["99999"]
