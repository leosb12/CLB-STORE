"""Política de edición sobre etiquetas de DensePose y SCHP oficiales, sin warping."""
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import binary_erosion, binary_fill_holes, distance_transform_edt, gaussian_filter

from fuente.dominio.probador import ErrorProbador


def mascara_agnostica(analisis: dict, categoria: str, mascara_base: Image.Image) -> Image.Image:
    dp = np.asarray(analisis["densepose"].resize(mascara_base.size, Image.Resampling.NEAREST))
    lip = np.asarray(analisis["schp_lip"].resize(mascara_base.size, Image.Resampling.NEAREST))
    atr = np.asarray(analisis["schp_atr"].resize(mascara_base.size, Image.Resampling.NEAREST))
    torso = np.isin(dp, [1, 2])
    if torso.sum() < dp.size * 0.005:
        raise ErrorProbador("POSE_INVALIDA", "No se detecta un torso completo. Usa una foto de una sola persona, de frente y con buena luz.")
    if categoria in ("lower", "overall") and any(np.isin(dp, partes).sum() < dp.size * 0.001 for partes in ([7, 9, 11, 13], [8, 10, 12, 14])):
        raise ErrorProbador("PIERNAS_NO_VISIBLES", "Incluye ambas piernas completas para probar esta prenda.")

    # No condicionar las manos a que otro parser coincida: en selfies suelen discrepar.
    # Manos estrictas: se excluyen torso y antebrazos anatómicos para que los puños de mangas largas no se bloqueen.
    manos = np.isin(dp, [3, 4]) & ~np.isin(dp, [1, 2, 15, 16, 17, 18, 19, 20, 21, 22])
    # DensePose agrupa cabeza/cuello: usarlo como protección conservaría el cuello de la camiseta vieja.
    # La cara y el cabello se protegen con los dos parsers semánticos, que distinguen ropa de piel.
    # ATR llama Face a parte del cuello e incluso al borde de la camiseta.
    # La ropa explícita LIP debe poder borrarse; LIP Face siempre se protege.
    rostro = (lip == 13) | ((atr == 11) & ~np.isin(lip, [5, 6, 7, 10]))
    proteger = manos | rostro | np.isin(lip, [1, 2, 3, 4]) | np.isin(atr, [1, 2, 3, 16])
    # Objetos que los parsers etiquetan como fondo, aunque DensePose infiera torso detrás.
    silueta = (lip != 0) | (atr != 0)
    proteger |= binary_fill_holes(silueta) & ~silueta
    if "oclusion" in analisis:
        proteger |= np.asarray(analisis["oclusion"].resize(mascara_base.size, Image.Resampling.NEAREST)) > 0
    # El hull del AutoMasker puede incluir grandes triángulos de fondo entre brazos y torso.
    # La unión de los tres modelos conserva evidencia de persona sin editar ese fondo lejano.
    persona_segmentada = (lip != 0) | (atr != 0) | (dp != 0)
    editar = (np.asarray(mascara_base) > 0) & persona_segmentada
    if categoria in ("upper", "overall"):
        # Torso, brazos y antebrazos completos; no sigue la silueta de la manga nueva.
        editar |= np.isin(dp, [1, 2, 15, 16, 17, 18, 19, 20, 21, 22])
        editar |= np.isin(lip, [5, 6, 7, 10, 14, 15]) | np.isin(atr, [4, 7, 14, 15])
    if categoria == "upper":
        # Si un parser ve ropa superior donde el otro ve pantalón, gana la edición: si no, el dobladillo
        # de la camiseta anterior queda protegido bajo la prenda nueva y el modelo lo continúa.
        superior = np.isin(lip, [5, 6, 7, 10]) | np.isin(atr, [4, 7])
        proteger |= (np.isin(lip, [9, 12, 16, 17, 18, 19]) | np.isin(atr, [5, 6, 9, 10, 12, 13])) & ~superior
    if categoria == "lower":
        proteger |= np.isin(dp, [1, 2, 15, 16, 17, 18, 19, 20, 21, 22]) | np.isin(lip, [5, 7, 14, 15])
    # Dilatación de la región semántica; la protección se aplica DESPUÉS y nunca se difumina.
    tamano = max(3, 2 * int(max(mascara_base.size) * 15 / 1024) + 1)
    dilatada = np.asarray(Image.fromarray(editar.astype("uint8") * 255).filter(ImageFilter.MaxFilter(tamano))) > 0
    return Image.fromarray((dilatada & ~proteger).astype("uint8") * 255)


def alfa_composicion(mascara: Image.Image, fondo_original: np.ndarray, fondo_generado: np.ndarray, nucleo: int = 2, rampa: int = 3) -> Image.Image:
    """Alfa de la mezcla final. CatVTON repinta TODO lo enmascarado, incluido el fondo del margen dilatado,
    con un tono propio: pegarlo tal cual deja un halo con la forma de la máscara. Donde la foto original y el
    resultado coinciden en «fondo» se recupera la foto; la prenda nueva entra con una rampa de `rampa` px
    desde un núcleo erosionado `nucleo` px, porque el borde de los parsers es más ancho que la prenda real."""
    editar = np.asarray(mascara) > 0
    nucleo_persona = binary_erosion(~fondo_generado, iterations=nucleo) if nucleo else ~fondo_generado
    candidato = editar & fondo_original & ~nucleo_persona
    rampa_alfa = np.clip(1 - distance_transform_edt(~nucleo_persona) / rampa, 0, 1)
    alfa = np.where(candidato, rampa_alfa, 1.0) * editar
    return Image.fromarray(np.round(alfa * 255).astype("uint8"))


def igualar_fondo_regenerado(generado: Image.Image, original: Image.Image, editar: np.ndarray, fondo_original: np.ndarray,
                             fondo_generado: np.ndarray, sigma: float = 12) -> Image.Image:
    """Donde la prenda anterior era más ancha que la nueva no hay foto de fondo que recuperar: queda fondo
    repintado, más claro que el real. Se le suma la diferencia LOCAL medida contra el fondo verdadero vecino
    (campo suavizado). Solo toca píxeles de fondo regenerado; prenda, piel y fondo intacto no cambian."""
    gen, ori = np.asarray(generado, dtype=np.float32), np.asarray(original.convert("RGB"), dtype=np.float32)
    referencia = (editar & fondo_original & fondo_generado).astype(np.float32)
    if referencia.sum() < 50:
        return generado
    peso = gaussian_filter(referencia, sigma)
    campo = np.stack([gaussian_filter((ori[..., c] - gen[..., c]) * referencia, sigma) for c in range(3)], -1) / np.maximum(peso, 1e-3)[..., None]
    corregir = editar & fondo_generado & ~fondo_original & (peso > 1e-3)
    gen[corregir] = np.clip(gen[corregir] + campo[corregir], 0, 255)
    return Image.fromarray(np.round(gen).astype("uint8"))
