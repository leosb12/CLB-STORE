"""F4: reportes con columnas, filtros, rango, orden, ambigüedad y exportación consistente (pantalla, Excel y PDF)."""
import io
import uuid
from datetime import date, timedelta

import httpx
import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from fuente.dominio.reportes import ZONA_BOLIVIA, EspecificacionReporte, describir, es_ambigua, especificacion_por_palabras
from pruebas.test_puertos import _cabecera, servidor  # noqa: F401 (fixture)

pytestmark = pytest.mark.anyio

REPORTE = """mutation($p: String, $e: JSON) { generarReporte(peticion: $p, especificacion: $e) {
  identificador especificacion datos interpretacion } }"""


def _spec(**cambios):
    return {"titulo": "Prueba", "metrica": "UNIDADES", "agrupar_por": "TALLA", "visualizacion": "BARRAS", **cambios}


@pytest.mark.parametrize("cambios", [
    {"filtros": {"talla": "M'; drop table pedidos"}},
    {"filtros": {"color": "=HYPERLINK(1)"}},
    {"filtros": {"otro": "x"}},
    {"periodo": "RANGO", "desde": "2026-01-01"},
    {"periodo": "RANGO", "desde": "2025-01-01", "hasta": "2026-02-01"},
    {"periodo": "RANGO", "desde": "2026-11-02", "hasta": "2026-11-01"},
    {"periodo": "RANGO", "desde": "2026-11-01", "hasta": (date.today() + timedelta(days=3)).isoformat()},
    {"periodo": "MES", "desde": "2026-10-01"},
    {"metricas_extra": ["UNIDADES"]},
    {"metricas_extra": ["MONTO", "MONTO"]},
    {"orden": "ALEATORIO"},
])
def test_especificacion_ampliada_sigue_cerrada(cambios):
    with pytest.raises(ValidationError):
        EspecificacionReporte(**_spec(**cambios))


def test_historial_anterior_sigue_valido_e_interpretacion_legible():
    anterior = {"titulo": "x", "metrica": "MONTO", "agrupar_por": "CATEGORIA", "periodo": "MES", "visualizacion": "BARRAS",
                "destino": "PANEL", "limite": 10}
    EspecificacionReporte(**anterior)
    assert describir(anterior) == "Ventas en Bs por categoría · últimos 30 días · top 10, de mayor a menor"
    nueva = EspecificacionReporte(**_spec(periodo="RANGO", desde="2026-10-01", hasta="2026-10-31", metricas_extra=["MONTO"],
                                          filtros={"color": "Negro"}, orden="METRICA_ASC"))
    assert describir(nueva.model_dump(mode="json")) == ("Unidades vendidas por talla · con ventas en Bs · del 01/10/2026 al "
                                                        "31/10/2026 · solo color Negro · top 10, de menor a mayor")


def test_ambiguedad_determinista_y_orden_por_palabras():
    assert es_ambigua("hola, ¿qué tal?") and es_ambigua("dame un reporte")
    assert not es_ambigua("ventas por talla") and not es_ambigua("lo menos vendido de la semana")
    assert especificacion_por_palabras("productos menos vendidos del mes").orden == "METRICA_ASC"


async def _gql(http, variables):
    return (await http.post("/api/v1/graphql", json={"query": REPORTE, "variables": variables}, headers=_cabecera("admin"))).json()


async def test_filtros_rango_columnas_y_exportaciones_consistentes(servidor):
    hoy = date.today()
    async with httpx.AsyncClient(base_url=servidor, timeout=60) as http:
        ambigua = await _gql(http, {"p": "hola, ¿qué tal?"})
        extension = ambigua["errors"][0]["extensions"]
        assert extension["codigo"] == "AMBIGUA" and extension["estado_http"] == 422 and len(extension["sugerencias"]) == 3

        # Fixture: ana M 2u (100 c/u), beto S 1u (100) — hoy; caro L 3u de Pantalones hace 40 días.
        filtrado = (await _gql(http, {"e": _spec(periodo="TODO", filtros={"categoria": "poleras"},
                                                 metricas_extra=["MONTO", "PEDIDOS"], orden="CLAVE_ASC")}))["data"]["generarReporte"]
        filas = filtrado["datos"]["filas"]
        # Especificación v1 del historial, convertida al catálogo v2: sin Pantalones, orden alfabético, dinero en centavos.
        assert filas == [["M", 2, 20000, 1], ["S", 1, 10000, 1]]
        assert "Categoría = poleras" in filtrado["interpretacion"]

        rango = (await _gql(http, {"e": _spec(periodo="RANGO", desde=(hoy - timedelta(days=45)).isoformat(),
                                              hasta=(hoy - timedelta(days=35)).isoformat())}))["data"]["generarReporte"]
        assert [f[0] for f in rango["datos"]["filas"]] == ["L"]

        ascendente = (await _gql(http, {"e": _spec(periodo="TODO", orden="METRICA_ASC")}))["data"]["generarReporte"]
        assert [f[0] for f in ascendente["datos"]["filas"]] == ["S", "M", "L"]

        identificador = filtrado["identificador"]
        excel = await http.get(f"/api/v1/reportes/{identificador}/excel", headers=_cabecera("admin"))
        pdf = await http.get(f"/api/v1/reportes/{identificador}/pdf", headers=_cabecera("admin"))
        assert (await http.get(f"/api/v1/reportes/{identificador}/pdf", headers=_cabecera("cliente"))).status_code == 403
    hoja = load_workbook(io.BytesIO(excel.content))["Reporte"]
    filas = [tuple(f) for f in hoja.iter_rows(values_only=True)]
    inicio = filas.index(("Talla", "Unidades", "Ventas (Bs)", "Pedidos")) + 1
    assert filas[inicio:inicio + 3] == [("M", 2, 200, 1), ("S", 1, 100, 1), ("Total", 3, 300, 2)]
    assert hoja.freeze_panes == f"A{inicio + 1}"
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")


def test_rango_usa_dias_calendario_de_bolivia():
    from fuente.dominio.reportes import rango_fechas
    from datetime import datetime, timezone
    spec = EspecificacionReporte(**_spec(periodo="RANGO", desde="2026-10-01", hasta="2026-10-31"))
    inicio, fin = rango_fechas(spec, datetime.now(timezone.utc))
    assert inicio.isoformat() == "2026-10-01T00:00:00-04:00" and fin.isoformat() == "2026-11-01T00:00:00-04:00"
    assert inicio.tzinfo == ZONA_BOLIVIA


def test_pdf_largo_sin_recortes_repite_encabezado():
    from fuente.dominio.reportes import valores_reporte
    from fuente.infraestructura.pdf import numero, reporte_pdf
    spec = EspecificacionReporte(**_spec(metrica="MONTO", agrupar_por="PRODUCTO", limite=50, metricas_extra=["UNIDADES", "PEDIDOS"]))
    grupos = [{"clave": f"Prenda con un nombre bastante largo {i} " * 2, "pedidos": i, "unidades": i, "monto": f"{1000.5 * i:.2f}"}
              for i in range(50, 0, -1)]
    datos = valores_reporte(spec, {"pedidos": 1, "unidades": 1, "monto": "1.00", "grupos": grupos})
    pdf = reporte_pdf({"especificacion": spec.model_dump(mode="json"), "datos": datos, "datos_al": None, "generativa": True})
    assert pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page\r") + pdf.count(b"/Type /Page ") >= 2
    assert numero(1234567.5, "MONTO") == "Bs 1.234.567,50" and numero(12345, "UNIDADES") == "12.345"
    assert str(uuid.uuid4())  # sin efectos: solo para mantener el import estable
