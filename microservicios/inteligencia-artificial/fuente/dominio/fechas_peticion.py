"""Fechas que una petición nombra de forma explícita, leídas sin LLM (calendario de Bolivia).

Son la referencia para contrastar lo que propone el modelo: el texto del usuario manda. Reglas visibles:
- un día → ese día completo;
- un mes (con año, o sin año: el último ya transcurrido) → el mes completo;
- «del X al Y», «entre X y Y», «desde X hasta Y» → ese rango;
- «desde X» sin final → hasta hoy (se anota); «hasta X» sin inicio → se pregunta la fecha inicial.
"""
import calendar
import re
from dataclasses import dataclass, field
from datetime import date

MESES = {m: i + 1 for i, m in enumerate(("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                                          "septiembre", "octubre", "noviembre", "diciembre"))} | {"setiembre": 9}
_MES = "(" + "|".join(MESES) + ")"
_ANIO = r"((?:19|20)\d{2})"
# Una fecha de día: «15 de octubre de 2026», «15 de octubre», «15/10/2026», «2026-10-15».
_DIA = re.compile(rf"(?<!\d)(\d{{1,2}}) de {_MES}(?:(?: de| del) {_ANIO})?(?!\d)|(?<!\d)(\d{{1,2}})/(\d{{1,2}})/{_ANIO}(?!\d)"
                  rf"|(?<!\d){_ANIO}-(\d{{2}})-(\d{{2}})(?!\d)")
# Un mes sin día: «octubre de 2026», «octubre 2026», «de octubre», «en octubre», «mes de octubre».
_MES_SOLO = re.compile(rf"(?<![a-z]){_MES}(?:(?: de| del)? {_ANIO})?(?![a-z])")


@dataclass(frozen=True)
class FechasPedidas:
    desde: date | None = None
    hasta: date | None = None
    notas: tuple[str, ...] = field(default_factory=tuple)
    pregunta: str | None = None
    anio_supuesto: bool = False  # el texto no dio el año: se tomó el último transcurrido

    @property
    def explicitas(self) -> bool:
        return self.desde is not None or self.pregunta is not None


def _f(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _anio_sin_indicar(mes: int, dia: int, hoy: date) -> int:
    """Sin año: la última vez que ocurrió esa fecha (nunca en el futuro)."""
    return hoy.year if (mes, dia) <= (hoy.month, hoy.day) else hoy.year - 1


def _fechas_dia(texto: str, hoy: date) -> list[tuple[int, int, date, bool]]:
    """(inicio, fin, fecha, año supuesto) de cada fecha de día del texto."""
    salida = []
    for m in _DIA.finditer(texto):
        try:
            if m.group(1):
                dia, mes = int(m.group(1)), MESES[m.group(2)]
                anio = int(m.group(3)) if m.group(3) else _anio_sin_indicar(mes, dia, hoy)
                salida.append((m.start(), m.end(), date(anio, mes, dia), not m.group(3)))
            elif m.group(4):
                salida.append((m.start(), m.end(), date(int(m.group(6)), int(m.group(5)), int(m.group(4))), False))
            else:
                salida.append((m.start(), m.end(), date(int(m.group(7)), int(m.group(8)), int(m.group(9))), False))
        except ValueError:
            continue  # «31 de febrero»: no es una fecha
    return salida


def fechas_pedidas(texto: str, hoy: date) -> FechasPedidas:
    """`texto` ya normalizado (minúsculas, sin tildes)."""
    dias = _fechas_dia(texto, hoy)
    notas = [f"Sin año indicado: se tomó el {_f(d)}." for _, _, d, supuesto in dias if supuesto]
    supuesto = any(s for *_, s in dias)
    if len(dias) >= 2:
        (_, fin1, d1, _), (ini2, _, d2, _) = dias[0], dias[1]
        if re.fullmatch(r"\s*(?:al|a|hasta(?: el)?|y(?: el)?|-)\s*(?:el )?", texto[fin1:ini2]):
            return FechasPedidas(d1, d2, tuple(notas), anio_supuesto=supuesto)
        return FechasPedidas(pregunta="La petición nombra varias fechas sueltas: ¿qué rango quieres (desde y hasta)?")
    if len(dias) == 1:
        inicio, _, d, _ = dias[0]
        antes = texto[max(0, inicio - 14):inicio]
        if re.search(r"(?:desde|a partir)(?: del?| el)?\s*$", antes):
            return FechasPedidas(d, hoy, (*notas, f"«Desde» sin fecha final: se usó hasta hoy ({_f(hoy)})."),
                                 anio_supuesto=supuesto)
        if re.search(r"hasta(?: el)?\s*$", antes):
            return FechasPedidas(pregunta=f"Indicaste solo «hasta el {_f(d)}»: ¿desde qué fecha?")
        return FechasPedidas(d, d, (*notas, f"Un solo día: se usó el {_f(d)} completo."), anio_supuesto=supuesto)
    m = _MES_SOLO.search(texto)
    if m:
        mes = MESES[m.group(1)]
        anio = int(m.group(2)) if m.group(2) else (hoy.year if mes <= hoy.month else hoy.year - 1)
        fin = date(anio, mes, calendar.monthrange(anio, mes)[1])
        if not m.group(2):
            notas.append(f"Sin año indicado: se tomó {m.group(1)} de {anio}.")
        return FechasPedidas(date(anio, mes, 1), fin, tuple(notas), anio_supuesto=not m.group(2))
    return FechasPedidas()
