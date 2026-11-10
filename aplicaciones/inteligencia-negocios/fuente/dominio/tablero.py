"""Reglas del tablero que no dependen de Dash ni de HTTP: filtros válidos y formato boliviano de cifras.

Las fórmulas de los KPI NO están aquí: las calcula el servicio de IA (mismo motor que los reportes). Este módulo solo
formatea lo que llega en centavos enteros.
"""
from dataclasses import dataclass
from datetime import date

MAXIMO_RANGO_DIAS = 366  # la misma regla que la especificación de reportes v2


class FiltroInvalido(ValueError):
    pass


@dataclass(frozen=True)
class Filtros:
    desde: date | None = None
    hasta: date | None = None
    categoria: str | None = None
    producto: str | None = None

    def __post_init__(self):
        if bool(self.desde) != bool(self.hasta):
            raise FiltroInvalido("Elige fecha de inicio y de fin, o ninguna para ver todo el historial.")
        if self.desde and self.desde > self.hasta:
            raise FiltroInvalido("La fecha de inicio es posterior a la de fin.")
        if self.desde and (self.hasta - self.desde).days >= MAXIMO_RANGO_DIAS:
            raise FiltroInvalido(f"El rango no puede superar {MAXIMO_RANGO_DIAS} días (la misma regla que los reportes).")

    def variables(self) -> dict:
        return {"d": self.desde.isoformat() if self.desde else None, "h": self.hasta.isoformat() if self.hasta else None,
                "c": self.categoria or None, "p": self.producto or None}


def _miles(entero: int) -> str:
    return f"{entero:,}".replace(",", ".")


def entero(valor: int | None) -> str:
    return "—" if valor is None else _miles(int(valor))


def bs(centavos: int | None) -> str:
    """Centavos enteros → «Bs 138.450,00» (punto de miles, coma decimal). Sin float en el camino."""
    if centavos is None:
        return "—"
    centavos = int(centavos)
    signo = "-" if centavos < 0 else ""
    return f"Bs {signo}{_miles(abs(centavos) // 100)},{abs(centavos) % 100:02d}"


def fecha(iso: str | None) -> str:
    if not iso:
        return "—"
    d = date.fromisoformat(iso[:10])
    return f"{d.day:02d}/{d.month:02d}/{d.year}"
