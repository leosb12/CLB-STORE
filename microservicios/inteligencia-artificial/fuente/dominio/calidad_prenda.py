"""Estándar de calidad de la fotografía de una prenda para el probador (regla de negocio, sin visión por computadora).

La infraestructura mide la silueta segmentada; aquí se decide si la prenda puede probarse bien. Dos niveles:
- BLOQUEO: impide probarla (no se publica): sin prenda, varias prendas, recortada, poca resolución, tipo equivocado.
- AVISO: se puede publicar si el administrador lo acepta explícitamente; la prenda queda marcada «calidad limitada».
Los umbrales son perillas de calibración medidas sobre el catálogo de demostración (ver `docs/probador.md`).
"""

from dataclasses import asdict, dataclass, field

from fuente.dominio.prendas import PrendaNoPreparada

OK, AVISO, BLOQUEO = "ok", "aviso", "bloqueo"

# ponytail: umbrales fijos calibrados con el catálogo de demostración; si se amplía el catálogo, recalibrar aquí.
AREA_MINIMA = 0.03          # fracción de la foto que ocupa la prenda
SEGUNDA_PIEZA = 0.08        # otra silueta mayor que esta fracción de la principal = varias prendas u objetos
LADO_MINIMO = 300           # px del lado menor de la prenda: menos no se reconoce el tejido
LADO_RECOMENDADO = 500
SIMETRIA_MINIMA = 0.55      # IoU con su reflejo: menos = prenda doblada o muy girada
SIMETRIA_RECOMENDADA = 0.75
BORDE_DIFUSO_MAXIMO = 0.12  # fracción semitransparente del contorno: más = fondo mal separado
PIEL_MAXIMA = 0.015         # fracción de la prenda con color de piel: más = la lleva puesta una persona
ASPECTO = {"superior": (0.6, 2.2), "inferior": (1.0, 3.6), "completo": (1.0, 3.6)}


@dataclass(frozen=True)
class MedidasPrenda:
    tipo: str                      # superior | inferior | completo
    area: float                    # fracción de la foto ocupada por la prenda principal
    segunda_pieza: float           # área de la segunda silueta / área de la principal (0 si no hay)
    toca_borde: bool               # la prenda llega al borde de la foto (recortada)
    lado_px: int                   # lado menor de la caja de la prenda, en píxeles de la foto procesada
    aspecto: float                 # alto / ancho de la caja de la prenda
    simetria: float                # IoU entre la silueta y su reflejo horizontal
    borde_difuso: float            # píxeles semitransparentes / píxeles opacos
    mangas: int | None = None      # mangas reconocidas (solo prendas superiores con modelo 3D)
    modelo_3d: bool = True         # se pudo construir el modelo 3D para la realidad aumentada
    motivo_modelo: str = ""
    piel: float = 0.0              # fracción de la silueta con color de piel (manos, piernas de quien la lleva)


@dataclass(frozen=True)
class Comprobacion:
    codigo: str
    nivel: str
    mensaje: str
    valor: float | None = None
    umbral: str = ""


@dataclass(frozen=True)
class InformeCalidad:
    nivel: str                     # apta | con_avisos | no_apta
    puntuacion: int                # 0..100, para ordenar y mostrar; la decisión la da `nivel`
    comprobaciones: list[Comprobacion] = field(default_factory=list)

    @property
    def bloqueos(self) -> list[Comprobacion]:
        return [c for c in self.comprobaciones if c.nivel == BLOQUEO]

    @property
    def avisos(self) -> list[Comprobacion]:
        return [c for c in self.comprobaciones if c.nivel == AVISO]

    def como_dict(self) -> dict:
        return {"nivel": self.nivel, "puntuacion": self.puntuacion, "comprobaciones": [asdict(c) for c in self.comprobaciones]}


def _r(valor: float) -> float:
    return round(float(valor), 3)


def evaluar_prenda(m: MedidasPrenda) -> InformeCalidad:
    c: list[Comprobacion] = []

    def poner(codigo, nivel, mensaje, valor=None, umbral=""):
        c.append(Comprobacion(codigo, nivel, mensaje, None if valor is None else _r(valor), umbral))

    if m.area < AREA_MINIMA:
        poner("PRENDA_NO_ENCONTRADA", BLOQUEO, "No se encontró una prenda completa: acércala y que ocupe buena parte de la foto.", m.area, f"≥ {AREA_MINIMA}")
    else:
        poner("PRENDA_NO_ENCONTRADA", OK, "Se encontró la prenda.", m.area, f"≥ {AREA_MINIMA}")
    if m.segunda_pieza > SEGUNDA_PIEZA:
        poner("VARIAS_PIEZAS", BLOQUEO, "Hay otra prenda u objeto en la foto: deja una sola prenda sobre un fondo liso.", m.segunda_pieza, f"≤ {SEGUNDA_PIEZA}")
    else:
        poner("VARIAS_PIEZAS", OK, "Hay una sola prenda.", m.segunda_pieza, f"≤ {SEGUNDA_PIEZA}")
    if m.toca_borde:
        poner("RECORTADA", BLOQUEO, "La prenda toca el borde de la foto: aléjate y deja margen alrededor.")
    else:
        poner("RECORTADA", OK, "La prenda entra completa en la foto.")
    if m.lado_px < LADO_MINIMO:
        poner("RESOLUCION", BLOQUEO, "La foto tiene muy poca resolución: usa una foto más grande o más cercana.", m.lado_px, f"≥ {LADO_MINIMO} px")
    elif m.lado_px < LADO_RECOMENDADO:
        poner("RESOLUCION", AVISO, "Resolución justa: el tejido puede verse borroso al probarla.", m.lado_px, f"≥ {LADO_RECOMENDADO} px")
    else:
        poner("RESOLUCION", OK, "Resolución suficiente.", m.lado_px, f"≥ {LADO_RECOMENDADO} px")
    minimo, maximo = ASPECTO.get(m.tipo, (0.5, 3.6))
    if not minimo <= m.aspecto <= maximo:
        poner("FORMA", BLOQUEO, "La forma no corresponde a la categoría de la prenda o está muy doblada.", m.aspecto, f"{minimo}–{maximo}")
    else:
        poner("FORMA", OK, "La forma corresponde a la categoría.", m.aspecto, f"{minimo}–{maximo}")
    if m.simetria < SIMETRIA_MINIMA:
        poner("SIMETRIA", BLOQUEO, "La prenda está doblada o muy girada: extiéndela de frente.", m.simetria, f"≥ {SIMETRIA_MINIMA}")
    elif m.simetria < SIMETRIA_RECOMENDADA:
        poner("SIMETRIA", AVISO, "La prenda está algo girada o arrugada: puede deformarse al probarla.", m.simetria, f"≥ {SIMETRIA_RECOMENDADA}")
    else:
        poner("SIMETRIA", OK, "La prenda está extendida y de frente.", m.simetria, f"≥ {SIMETRIA_RECOMENDADA}")
    if m.borde_difuso > BORDE_DIFUSO_MAXIMO:
        poner("FONDO", AVISO, "El fondo no se separó limpiamente: usa un fondo liso de otro color que la prenda.", m.borde_difuso, f"≤ {BORDE_DIFUSO_MAXIMO}")
    else:
        poner("FONDO", OK, "El fondo se separó limpiamente.", m.borde_difuso, f"≤ {BORDE_DIFUSO_MAXIMO}")
    if m.piel > PIEL_MAXIMA:
        poner("PERSONA", AVISO, "Parece que una persona lleva puesta la prenda (se ve piel): fotografía la prenda sola, sin manos ni piernas.", m.piel, f"≤ {PIEL_MAXIMA}")
    else:
        poner("PERSONA", OK, "La prenda está sola, sin persona.", m.piel, f"≤ {PIEL_MAXIMA}")
    if not m.modelo_3d:
        # Un pantalón sin dos perneras reconocibles no se puede poner sobre las piernas en ningún modo.
        nivel = BLOQUEO if m.tipo == "inferior" else AVISO
        poner("MODELO_3D", nivel, f"No se pudo construir el modelo 3D ({m.motivo_modelo.rstrip('.')}). "
              + ("Extiende las dos perneras separadas." if m.tipo == "inferior" else "No estará disponible en realidad aumentada."))
    else:
        poner("MODELO_3D", OK, "Modelo 3D listo para realidad aumentada.")
    if m.tipo == "superior" and m.modelo_3d and m.mangas is not None:
        if m.mangas == 0:
            poner("MANGAS", AVISO, "No se reconocen las mangas: en realidad aumentada se verá sin mangas. Extiéndelas separadas del cuerpo.", m.mangas, "2")
        elif m.mangas == 1:
            poner("MANGAS", AVISO, "Solo se reconoce una manga: extiende las dos igual.", m.mangas, "2")
        else:
            poner("MANGAS", OK, "Se reconocen las dos mangas.", m.mangas, "2")

    bloqueos = sum(x.nivel == BLOQUEO for x in c)
    avisos = sum(x.nivel == AVISO for x in c)
    nivel = "no_apta" if bloqueos else "con_avisos" if avisos else "apta"
    puntuacion = 0 if bloqueos else max(0, 100 - 15 * avisos)
    return InformeCalidad(nivel, puntuacion, c)


class PrendaNoApta(PrendaNoPreparada):
    """La foto no cumple el estándar: lleva el informe completo para mostrar cada motivo al administrador."""

    def __init__(self, informe: InformeCalidad):
        super().__init__(" ".join(c.mensaje for c in informe.bloqueos) or "La fotografía no cumple el estándar.")
        self.informe = informe
