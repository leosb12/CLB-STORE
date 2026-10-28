"""Tallas de CLB Store: tabla de referencia y medidas del cliente.

La tabla es la regla de negocio que se muestra al cliente junto a la recomendación y la base del conjunto de entrenamiento
del modelo supervisado. La recomendación siempre es orientativa: el cliente decide.
"""
from dataclasses import dataclass

TALLAS = ("XS", "S", "M", "L", "XL")
CARACTERISTICAS = ("altura_cm", "peso_kg", "pecho_cm", "cintura_cm")

# Rangos (mínimo, máximo) por talla. Prendas superiores unisex.
TABLA_TALLAS: dict[str, dict[str, tuple[int, int]]] = {
    "XS": {"altura_cm": (150, 162), "peso_kg": (42, 55), "pecho_cm": (78, 86), "cintura_cm": (62, 70)},
    "S": {"altura_cm": (158, 170), "peso_kg": (52, 64), "pecho_cm": (86, 94), "cintura_cm": (70, 78)},
    "M": {"altura_cm": (165, 177), "peso_kg": (62, 75), "pecho_cm": (94, 102), "cintura_cm": (78, 86)},
    "L": {"altura_cm": (170, 182), "peso_kg": (72, 88), "pecho_cm": (102, 110), "cintura_cm": (86, 96)},
    "XL": {"altura_cm": (175, 190), "peso_kg": (85, 105), "pecho_cm": (110, 120), "cintura_cm": (96, 108)},
}

# Los mismos límites que valida el perfil en Clientes.
LIMITES = {"altura_cm": (100, 230), "peso_kg": (30, 250), "pecho_cm": (50, 200), "cintura_cm": (40, 200)}

AVISO = "Estimación orientativa calculada con tus medidas; revisa la tabla de tallas antes de comprar."


class MedidasInvalidas(ValueError):
    pass


@dataclass(frozen=True)
class Medidas:
    altura_cm: float
    peso_kg: float
    pecho_cm: float
    cintura_cm: float

    def __post_init__(self):
        for nombre in CARACTERISTICAS:
            valor = getattr(self, nombre)
            mínimo, máximo = LIMITES[nombre]
            if not isinstance(valor, (int, float)) or isinstance(valor, bool) or not mínimo <= valor <= máximo:
                raise MedidasInvalidas(f"{nombre} debe estar entre {mínimo} y {máximo}.")

    @classmethod
    def desde(cls, datos: dict) -> "Medidas":
        faltantes = [c for c in CARACTERISTICAS if datos.get(c) is None]
        if faltantes:
            raise MedidasInvalidas("Faltan medidas: " + ", ".join(faltantes) + ".")
        return cls(**{c: datos[c] for c in CARACTERISTICAS})

    def vector(self) -> list[float]:
        return [float(getattr(self, c)) for c in CARACTERISTICAS]


def talla_por_tabla(medidas: Medidas) -> str:
    """Talla cuyo centro de pecho está más cerca: la referencia que el cliente puede comprobar con una cinta métrica."""
    return min(TALLAS, key=lambda t: abs(sum(TABLA_TALLAS[t]["pecho_cm"]) / 2 - medidas.pecho_cm))
