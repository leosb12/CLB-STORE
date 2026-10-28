"""Dominio puro y modelos de scikit-learn (sin red ni base)."""
import math
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from fuente.dominio.agentes import agentes_por_palabras, autorizada
from fuente.dominio.reportes import EspecificacionReporte, especificacion_por_palabras, inicio_periodo
from fuente.dominio.segmentos import describir
from fuente.dominio.tallas import Medidas, MedidasInvalidas, talla_por_tabla
from fuente.infraestructura.aprendizaje import AgrupadorKMeans, ModeloTallasLogistico


def test_especificacion_cerrada_y_coherente():
    valida = EspecificacionReporte(titulo="Ventas por talla", metrica="UNIDADES", agrupar_por="TALLA", visualizacion="BARRAS")
    assert valida.periodo == "SEMANA" and valida.destino == "PANEL"
    casos = [
        {"titulo": "x", "metrica": "UNIDADES", "sql": "drop table pedidos"},          # campo extra
        {"titulo": "x", "metrica": "BORRAR_STOCK"},                                   # fuera de la lista
        {"titulo": "x", "metrica": "MONTO", "agrupar_por": "TALLA", "visualizacion": "KPI"},
        {"titulo": "x", "metrica": "MONTO", "agrupar_por": "TALLA", "visualizacion": "LINEAS"},
        {"titulo": "x", "metrica": "MONTO", "visualizacion": "BARRAS"},
        {"titulo": "<script>alert(1)</script>", "metrica": "MONTO"},
        {"titulo": "x", "metrica": "MONTO", "limite": 5000},
    ]
    for datos in casos:
        with pytest.raises(ValidationError):
            EspecificacionReporte.model_validate(datos)


def test_interpretacion_no_generativa_de_la_demo():
    spec = especificacion_por_palabras("Ventas por talla esta semana, barras en el panel")
    assert (spec.metrica, spec.agrupar_por, spec.periodo, spec.visualizacion, spec.destino) == ("UNIDADES", "TALLA", "SEMANA", "BARRAS", "PANEL")
    spec = especificacion_por_palabras("¿Cuánto dinero ingresó hoy?")
    assert (spec.metrica, spec.agrupar_por, spec.periodo, spec.visualizacion) == ("MONTO", None, "HOY", "KPI")
    spec = especificacion_por_palabras("Evolución diaria de pedidos del mes en líneas, en una vista dedicada")
    assert (spec.metrica, spec.agrupar_por, spec.periodo, spec.visualizacion, spec.destino) == ("PEDIDOS", "DIA", "MES", "LINEAS", "VISTA")


def test_hoy_es_el_dia_de_bolivia():
    # 02:00 UTC del 23 = 22:00 del 22 en Bolivia: «hoy» empieza el 22 a las 00:00 (04:00 UTC).
    inicio = inicio_periodo("HOY", datetime(2026, 10, 23, 2, 0, tzinfo=timezone.utc))
    assert inicio.astimezone(timezone.utc) == datetime(2026, 10, 22, 4, 0, tzinfo=timezone.utc)
    assert inicio_periodo("TODO", datetime.now(timezone.utc)) is None


def test_medidas_y_tabla():
    assert talla_por_tabla(Medidas(170, 70, 98, 82)) == "M"
    with pytest.raises(MedidasInvalidas):
        Medidas(170, 70, 400, 82)
    with pytest.raises(MedidasInvalidas, match="cintura_cm"):
        Medidas.desde({"altura_cm": 170, "peso_kg": 70, "pecho_cm": 98})


def test_lista_blanca_y_delegacion():
    assert autorizada("inventario", "proponer_reposicion") and not autorizada("clientes", "proponer_reposicion")
    assert not autorizada("monitoreo", "borrar_stock") and not autorizada("intruso", "obtener_ventas")
    assert agentes_por_palabras("Monitorea mi negocio") == ["monitoreo", "reportes", "inventario", "clientes"]
    assert agentes_por_palabras("¿Qué segmentos de clientes tengo?") == ["clientes"]


def test_descripcion_de_segmento_sale_del_centroide():
    medianas = {"recencia_dias": 3, "frecuencia": 1, "monto_bs": 300, "diversidad": 1}
    nombre, descripcion = describir({"recencia_dias": 2, "frecuencia": 5, "monto_bs": 900, "diversidad": 3}, medianas)
    assert nombre == "Frecuentes de alto gasto" and "varias categorías" in descripcion
    assert describir({"recencia_dias": 0, "frecuencia": 1.2, "monto_bs": 180, "diversidad": 1}, medianas)[0] == "Ocasionales de gasto bajo"
    assert describir({"recencia_dias": 45, "frecuencia": 3, "monto_bs": 320, "diversidad": 1}, medianas)[0] == "Inactivos"


def test_modelo_de_tallas_exportado_infiere_igual_sin_librerias():
    modelo = ModeloTallasLogistico()
    assert modelo.metricas["exactitud"] > 0.85
    assert len(modelo.metricas["matriz_confusion"]) == 5
    exportado = modelo.exportar()
    vector = [168, 66, 95, 80]
    z = [(x - m) / s for x, m, s in zip(vector, exportado["media"], exportado["escala"])]
    puntajes = [sum(w * v for w, v in zip(fila, z)) + b for fila, b in zip(exportado["coeficientes"], exportado["intercepto"])]
    total = sum(math.exp(p) for p in puntajes)
    manual = {c: math.exp(p) / total for c, p in zip(exportado["clases"], puntajes)}
    for talla, p in modelo.probabilidades(vector).items():
        assert abs(manual[talla] - p) < 1e-3
    assert max(manual, key=manual.get) == "M"


def test_kmeans_encuentra_grupos_sin_etiquetas():
    frecuentes = [[2 + i % 3, 6 + i % 2, 900 + 10 * i, 3] for i in range(6)]
    ocasionales = [[60 + i, 1, 120 + 5 * i, 1] for i in range(6)]
    etiquetas, centroides, silueta = AgrupadorKMeans().agrupar(frecuentes + ocasionales)
    assert len(set(etiquetas[:6])) == 1 and len(set(etiquetas[6:])) == 1 and etiquetas[0] != etiquetas[6]
    assert silueta > 0.5 and len(centroides) == 2


def test_kmeans_aparta_un_cliente_atipico_en_vez_de_rendirse():
    # Caso real de la demo: un cliente compró hoy 29 veces; los demás, días atrás y pocas veces.
    frecuentes = [[5.2, 5 + i % 3, 3000 + 400 * i, 3] for i in range(5)]
    ocasionales = [[5.2 + 0.1 * (i % 3), 1 + i % 2, 120 + 20 * i, 1] for i in range(10)]
    atipico = [[0.0, 29, 5910, 3]]
    etiquetas, centroides, silueta = AgrupadorKMeans().agrupar(frecuentes + ocasionales + atipico)
    assert silueta is not None and len(centroides) >= 3
    assert etiquetas[-1] == len(centroides) - 1 and etiquetas.count(etiquetas[-1]) == 1
    assert etiquetas[0] != etiquetas[5]
    # Dos atípicos en sentidos opuestos no se promedian en un mismo grupo.
    dormido = [[400.0, 1, 50, 1]]
    etiquetas, centroides, _ = AgrupadorKMeans().agrupar(frecuentes + ocasionales + atipico + dormido)
    assert etiquetas[-1] != etiquetas[-2] and centroides[etiquetas[-1]][0] == 400.0

