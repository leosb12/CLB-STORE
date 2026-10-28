"""Contrato geométrico de prendas: coordenadas de imagen, no medidas del cuerpo."""

import math
from dataclasses import dataclass


class PrendaNoPreparada(ValueError):
    """Entrada insuficiente: repetir fotografía, sin inventar puntos."""


@dataclass(frozen=True)
class AnclasPrenda:
    izquierda: float
    derecha: float
    arriba: float
    abajo: float
    cuello: tuple[float, float]
    pecho: float
    calidad: float

    def __post_init__(self):
        valores = (self.izquierda, self.derecha, self.arriba, self.abajo, *self.cuello, self.pecho, self.calidad)
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in valores):
            raise PrendaNoPreparada("Las anclas no son finitas o están fuera de la textura.")
        if not self.izquierda < self.cuello[0] < self.derecha or not self.arriba < self.pecho < self.abajo:
            raise PrendaNoPreparada("El orden de las anclas es ambiguo.")

    def como_dict(self):
        return {
            "izquierda": self.izquierda,
            "derecha": self.derecha,
            "arriba": self.arriba,
            "abajo": self.abajo,
            "cuello": list(self.cuello),
            "pecho": self.pecho,
            "calidad": self.calidad,
        }


def _numeros(valores, n, limite=1.0):
    if not isinstance(valores, list) or len(valores) != n:
        raise PrendaNoPreparada("El modelo 3D tiene una lista con forma inválida.")
    for v in valores:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= limite:
            raise PrendaNoPreparada("El modelo 3D tiene coordenadas fuera de la textura.")


def _eje(datos):
    if not isinstance(datos, dict) or datos.get("lado") not in (-1, 1) or not isinstance(datos.get("eje"), list) or len(datos["eje"]) != 8:
        raise PrendaNoPreparada("Una manga o pernera del modelo 3D es inválida.")
    for estacion in datos["eje"]:
        _numeros(estacion, 3)


def validar_modelo_3d(modelo: dict) -> dict:
    """Esquema cerrado del modelo 3D: solo números normalizados y listas acotadas; nunca rutas ni texto libre."""
    claves = {"version", "tipo", "espalda", "color", "superior", "inferior"}
    if not isinstance(modelo, dict) or not set(modelo) <= claves or modelo.get("version") != 1 or modelo.get("espalda") not in ("deducida", "fotografiada"):
        raise PrendaNoPreparada("El modelo 3D no cumple el contrato.")
    _numeros(modelo.get("color"), 3, 255)
    tipo = modelo.get("tipo")
    if tipo in ("superior", "completo"):
        s = modelo.get("superior")
        if not isinstance(s, dict) or set(s) != {"axila", "cuello", "torso", "mangas"} or "inferior" in modelo:
            raise PrendaNoPreparada("El torso del modelo 3D es inválido.")
        _numeros([s["axila"]], 1)
        _numeros(s["cuello"], 4)
        if not isinstance(s["torso"], list) or not 4 <= len(s["torso"]) <= 32:
            raise PrendaNoPreparada("El torso del modelo 3D es inválido.")
        for fila in s["torso"]:
            _numeros(fila, 3)
        if not isinstance(s["mangas"], list) or len(s["mangas"]) > 2:
            raise PrendaNoPreparada("Las mangas del modelo 3D son inválidas.")
        for manga in s["mangas"]:
            if not isinstance(manga, dict) or set(manga) != {"lado", "larga", "eje"} or not isinstance(manga["larga"], bool):
                raise PrendaNoPreparada("Las mangas del modelo 3D son inválidas.")
            _eje(manga)
    elif tipo == "inferior":
        i = modelo.get("inferior")
        if not isinstance(i, dict) or set(i) != {"cintura", "entrepierna", "cadera", "piernas"} or "superior" in modelo:
            raise PrendaNoPreparada("El pantalón del modelo 3D es inválido.")
        _numeros([i["cintura"], i["entrepierna"]], 2)
        if not isinstance(i["cadera"], list) or not 2 <= len(i["cadera"]) <= 8 or not isinstance(i["piernas"], list) or len(i["piernas"]) != 2:
            raise PrendaNoPreparada("El pantalón del modelo 3D es inválido.")
        for fila in i["cadera"]:
            _numeros(fila, 3)
        for pierna in i["piernas"]:
            if not isinstance(pierna, dict) or set(pierna) != {"lado", "eje"}:
                raise PrendaNoPreparada("Una pernera del modelo 3D es inválida.")
            _eje(pierna)
    else:
        raise PrendaNoPreparada("Tipo de prenda 3D desconocido.")
    return modelo
