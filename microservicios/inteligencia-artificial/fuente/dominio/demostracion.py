"""Conjunto sintético de demostración para inteligencia de negocios.

Vive en un esquema propio de `clb_analitica` (por defecto `demo_bi`), nunca en el operativo: no son ventas reales, no
mueven stock ni puntos y no generan eventos. Toda salida que lo use lo dice con `ETIQUETA`.
"""
import re
from datetime import date

Conjunto = str  # "OPERACION" | "DEMOSTRACION" (Literal en la especificación de reportes)

ETIQUETA = "Datos sintéticos de demostración"
NOTA = (f"{ETIQUETA}: conjunto generado para la inteligencia de negocios; no son ventas, clientes ni stock reales "
        "de CLB Store.")
ALCANCE_SEGMENTACION = "dataset completo a la fecha de corte; no depende de los filtros de ventas"

SEMILLA = 7
INICIO = date(2025, 1, 1)
CORTE = date(2026, 10, 31)


_PALABRAS = ("demostracion", "sintetic", "dataset", "inteligencia de negocios", "tablero")


def conjunto_de(peticion: str) -> str:
    """Regla determinista (no la decide el modelo): solo se leen datos sintéticos si la petición lo dice explícitamente.
    Así una pregunta sobre el negocio real nunca termina respondida con el dataset de demostración, ni al revés."""
    from fuente.dominio.catalogo_reportes import normalizar_texto
    texto = normalizar_texto(peticion)
    return "DEMOSTRACION" if any(p in texto for p in _PALABRAS) else "OPERACION"


def esquema_valido(esquema: str, operativo: str) -> str:
    """El conjunto solo se escribe en un esquema `demo_*` distinto del operativo: nunca en `public` ni en el de la ingesta."""
    if not re.fullmatch(r"demo_[a-z0-9_]{1,40}", esquema) or esquema == operativo:
        raise ValueError(f"Esquema de demostración inválido: {esquema!r} (debe ser demo_* y distinto de {operativo!r}).")
    return esquema
