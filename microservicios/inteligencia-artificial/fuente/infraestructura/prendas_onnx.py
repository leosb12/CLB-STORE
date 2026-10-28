"""U²-Net ONNX local. Nunca descarga pesos ni ejecuta código de repositorios remotos."""

import hashlib
import io
import warnings
from dataclasses import asdict
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageCms, ImageOps

from fuente.aplicacion.preparar_prenda import PrendaPreparada
from fuente.dominio.calidad_prenda import PrendaNoApta, evaluar_prenda
from fuente.dominio.prendas import AnclasPrenda, PrendaNoPreparada
from fuente.infraestructura.calidad_cv import medir_silueta
from fuente.infraestructura.modelo_prenda_3d import construir_modelo_3d

# ONNX Runtime puede incluir telemetría: se deshabilita antes de crear sesiones.
ort.disable_telemetry_events()
Image.MAX_IMAGE_PIXELS = 20_000_000


def abrir_original(datos: bytes) -> Image.Image:
    if len(datos) > 10 * 1024 * 1024:
        raise PrendaNoPreparada("La fotografía supera 10 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(datos)) as imagen:
                if imagen.format not in {"JPEG", "PNG"} or getattr(imagen, "n_frames", 1) != 1:
                    raise PrendaNoPreparada("Solo se admiten JPEG o PNG de una imagen.")
                if imagen.width * imagen.height > 20_000_000 or min(imagen.size) < 128:
                    raise PrendaNoPreparada("La imagen debe tener al menos 128 px por lado y hasta 20 MP.")
                imagen.load()
                normalizada = ImageOps.exif_transpose(imagen)
                perfil = imagen.info.get("icc_profile")
                if perfil:
                    try:
                        normalizada = ImageCms.profileToProfile(
                            normalizada,
                            ImageCms.ImageCmsProfile(io.BytesIO(perfil)),
                            ImageCms.createProfile("sRGB"),
                            outputMode="RGBA",
                        )
                    except ImageCms.PyCMSError as error:
                        raise PrendaNoPreparada("No se pudo normalizar el perfil de color de la fotografía.") from error
                else:
                    normalizada = normalizada.convert("RGBA")
                # Pillow puede copiar EXIF/ICC automáticamente al guardar PNG si quedan en info.
                normalizada.info.clear()
                return normalizada
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise PrendaNoPreparada("No se pudo decodificar una fotografía válida.") from error


def refinar_alfa(alfa: np.ndarray) -> np.ndarray:
    """Limpia motas pequeñas y rebabas; conserva aberturas y objetos grandes para poder rechazarlos."""
    alfa = np.asarray(alfa, dtype=np.uint8)
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    limpio = cv2.morphologyEx(alfa, cv2.MORPH_OPEN, nucleo)
    limpio = cv2.morphologyEx(limpio, cv2.MORPH_CLOSE, nucleo)
    cantidad, etiquetas, estadisticas, _ = cv2.connectedComponentsWithStats((limpio >= 32).astype(np.uint8), 8)
    mayor = int(estadisticas[1:, cv2.CC_STAT_AREA].max()) if cantidad > 1 else 0
    minimo = max(8, int(mayor * 0.0005))
    for etiqueta in range(1, cantidad):
        if estadisticas[etiqueta, cv2.CC_STAT_AREA] < minimo:
            limpio[etiquetas == etiqueta] = 0
    # Cobertura subpíxel en el contorno, sin rellenar el cuello ni otros huecos reales.
    return cv2.GaussianBlur(limpio, (3, 3), 0.65)


def extraer_anclas(alfa: np.ndarray) -> AnclasPrenda:
    mascara = (alfa >= 128).astype(np.uint8)
    alto, ancho = mascara.shape
    _cantidad, etiquetas, estadisticas, _ = cv2.connectedComponentsWithStats(mascara, 8)
    areas = sorted(estadisticas[1:, cv2.CC_STAT_AREA], reverse=True)
    if not areas or areas[0] < ancho * alto * 0.12:
        raise PrendaNoPreparada("No se encontró una prenda completa.")
    if len(areas) > 1 and areas[1] > areas[0] * 0.08:
        raise PrendaNoPreparada("Hay varios objetos: fotografía una sola prenda.")
    principal = 1 + int(np.argmax(estadisticas[1:, cv2.CC_STAT_AREA]))
    mascara = (etiquetas == principal).astype(np.uint8)
    ys, xs = np.where(mascara)
    superior, inferior = int(ys.min()), int(ys.max())
    izquierda, derecha = int(xs.min()), int(xs.max())
    margen_x, margen_y = max(2, int(ancho * 0.015)), max(2, int(alto * 0.015))
    if izquierda < margen_x or derecha >= ancho - margen_x or superior < margen_y or inferior >= alto - margen_y:
        raise PrendaNoPreparada("La prenda toca el borde: deja margen alrededor de toda la prenda.")
    altura, anchura = inferior - superior, derecha - izquierda
    if not 0.65 < altura / anchura < 2.5:
        raise PrendaNoPreparada("La silueta no corresponde a una prenda superior frontal.")
    espejo = np.fliplr(mascara[:, izquierda : derecha + 1])
    recorte = mascara[:, izquierda : derecha + 1]
    simetria = float(np.minimum(recorte, espejo).sum() / max(1, np.maximum(recorte, espejo).sum()))
    if simetria < 0.64:
        raise PrendaNoPreparada("La prenda está girada, plegada o no es suficientemente simétrica.")
    centro = (izquierda + derecha) // 2
    # En la banda inferior está el torso; las mangas quedan fuera de esta banda.
    filas = range(superior + int(0.62 * altura), superior + int(0.85 * altura))
    extremos = [(np.flatnonzero(mascara[y])[0], np.flatnonzero(mascara[y])[-1]) for y in filas if mascara[y].any()]
    if not extremos:
        raise PrendaNoPreparada("No se distingue el torso de la prenda.")
    torso_i, torso_d = np.median(extremos, axis=0)
    ancho_torso = torso_d - torso_i
    if ancho_torso < anchura * 0.3 or ancho_torso > anchura * 0.95:
        raise PrendaNoPreparada("No se distinguen hombros y mangas; repite la fotografía extendida.")
    # Buscar cuello en el perfil superior central; hombros son referencias del torso, no extremos de mangas.
    inicio = izquierda + int(anchura * 0.35)
    fin = derecha - int(anchura * 0.35)
    perfil = [(int(np.flatnonzero(mascara[:, x])[0]), x) for x in range(inicio, fin + 1) if mascara[:, x].any()]
    cuello_y, cuello_x = max(perfil, default=(superior, centro))
    if cuello_y - superior < altura * 0.025 or cuello_y - superior > altura * 0.28:
        raise PrendaNoPreparada("No se reconoce el cuello frontal de la prenda.")
    columnas = [int(torso_i), int(torso_d)]
    hombros_y = [int(np.flatnonzero(mascara[:, x])[0]) for x in columnas if mascara[:, x].any()]
    if len(hombros_y) != 2 or abs(hombros_y[0] - hombros_y[1]) > altura * 0.08:
        raise PrendaNoPreparada("Los hombros no están suficientemente alineados.")
    hombro_y = float(np.median(hombros_y))
    pecho_y = superior + altura * 0.38
    calidad = min(0.95, 0.55 + 0.4 * simetria)
    return AnclasPrenda(
        float(torso_i / ancho),
        float(torso_d / ancho),
        hombro_y / alto,
        inferior / alto,
        (cuello_x / ancho, cuello_y / alto),
        pecho_y / alto,
        calidad,
    )


def codificar(imagen: Image.Image, limite: int) -> bytes:
    copia = imagen.copy()
    copia.thumbnail((limite, limite), Image.Resampling.LANCZOS)
    salida = io.BytesIO()
    copia.save(salida, format="PNG")
    return salida.getvalue()


class PreparadorU2Net:
    def preparar_generativa(self, datos: bytes, categoria: str) -> PrendaPreparada:
        """Recurso para difusión: sin inventar anclas de una falda, vestido o pantalón."""
        from PIL import ImageOps
        imagen = abrir_original(datos)
        imagen.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        rgb = np.asarray(imagen.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
        rgb /= max(float(rgb.max()), 1.0)
        tensor = ((rgb - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)).transpose(2, 0, 1)[None]
        prediccion = self.sesion.run(None, {self.entrada: tensor})[0][0, 0]
        diferencia = float(prediccion.max() - prediccion.min())
        if not np.isfinite(prediccion).all() or diferencia < 1e-6:
            raise PrendaNoPreparada("No se pudo separar una prenda de su fondo.")
        alfa = Image.fromarray(np.uint8(np.clip((prediccion - prediccion.min()) / diferencia, 0, 1) * 255)).resize(imagen.size, Image.Resampling.LANCZOS)
        alfa_original = np.asarray(imagen.getchannel("A"))
        # Un PNG ya recortado (fondo transparente) puede tocar el borde del lienzo sin estar cortado.
        recorte = float((alfa_original < 128).mean()) > 0.05
        # Una foto ya recortada trae la separación exacta en su alfa: U²-Net puede invertirla sobre el fondo transparente
        # (ve el fondo vacío como objeto). Solo se segmenta cuando la foto tiene fondo.
        alfa_np = alfa_original.copy() if recorte else np.minimum(np.asarray(alfa), alfa_original)
        imagen_rgb = imagen.convert("RGB")
        imagen.putalpha(Image.fromarray(alfa_np))
        tipo = {"upper": "superior", "lower": "inferior", "overall": "completo"}[categoria]
        caja = imagen.getchannel("A").point(lambda valor: 255 if valor > 64 else 0).getbbox()
        if caja is None:
            raise PrendaNoApta(evaluar_prenda(medir_silueta(alfa_np, tipo, None, "no se encontró la silueta", recorte)))
        imagen = ImageOps.contain(imagen.crop(caja), (704, 960))
        normalizada = Image.new("RGBA", (768, 1024))
        normalizada.paste(imagen, ((768 - imagen.width) // 2, (1024 - imagen.height) // 2))
        salida = io.BytesIO()
        normalizada.save(salida, "PNG")
        textura = salida.getvalue()
        metadatos = {"esquema": 2, "tipo": tipo,
            "vista": "frontal", "ancho": 768, "alto": 1024, "mime": "image/png", "bytes": len(textura),
            "sha256": hashlib.sha256(textura).hexdigest(), "metodo": "u2net-vton-1", "modelo_sha256": self.sha256}
        # Modelo 3D para la realidad aumentada; si la silueta no lo permite, la prenda sigue sirviendo a la foto con IA.
        modelo, espalda, motivo = None, None, ""
        try:
            modelo, espalda = construir_modelo_3d(textura, tipo)
            metadatos["modelo3d"] = modelo
            metadatos["espalda"] = {"sha256": hashlib.sha256(espalda).hexdigest(), "bytes": len(espalda)}
        except PrendaNoPreparada as error:
            motivo = str(error)
        # Estándar de calidad: lo grave bloquea la publicación; los avisos viajan con el recurso.
        medidas = medir_silueta(alfa_np, tipo, modelo, motivo, recorte, np.asarray(imagen_rgb))
        informe = evaluar_prenda(medidas)
        if informe.bloqueos:
            raise PrendaNoApta(informe)
        metadatos["calidad"] = informe.como_dict()
        return PrendaPreparada(textura, textura, metadatos,
            {"categoria_vton": categoria, "origen_categoria": "catalogo", "uso": "generativo", "medidas": asdict(medidas)}, espalda)

    def __init__(self, ruta: str, sha256: str, detector_estampados=None):
        archivo = Path(ruta)
        if len(sha256) != 64 or not archivo.is_file() or hashlib.sha256(archivo.read_bytes()).hexdigest() != sha256:
            raise RuntimeError("MODELO_PRENDAS_NO_DISPONIBLE: precarga y verifica U²-Net antes de iniciar.")
        opciones = ort.SessionOptions()
        opciones.intra_op_num_threads = 2
        opciones.inter_op_num_threads = 1
        self.sesion = ort.InferenceSession(str(archivo), sess_options=opciones, providers=["CPUExecutionProvider"])
        self.entrada = self.sesion.get_inputs()[0].name
        self.sha256 = sha256
        self.detector_estampados = detector_estampados

    def preparar(self, datos: bytes) -> PrendaPreparada:
        imagen = abrir_original(datos)
        imagen.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        rgb = np.asarray(imagen.convert("RGB").resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
        rgb /= max(float(rgb.max()), 1.0)
        tensor = (
            (rgb - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        ).transpose(2, 0, 1)[None]
        prediccion = self.sesion.run(None, {self.entrada: tensor})[0][0, 0]
        diferencia = float(prediccion.max() - prediccion.min())
        if diferencia < 1e-6:
            raise PrendaNoPreparada("No hay contraste suficiente para aislar la prenda.")
        alfa = Image.fromarray(np.uint8(np.clip((prediccion - prediccion.min()) / diferencia, 0, 1) * 255))
        alfa = alfa.resize(imagen.size, Image.Resampling.LANCZOS)
        # Respetar transparencia original, sin convertir regiones ya transparentes en fondo opaco.
        original_alfa = np.asarray(imagen.getchannel("A"))
        alfa_np = np.minimum(refinar_alfa(np.minimum(np.asarray(alfa), original_alfa)), original_alfa)
        mascara = alfa_np >= 128
        if not mascara.any():
            raise PrendaNoPreparada("La extracción está vacía.")
        yy, xx = np.where(mascara)
        if xx.min() < 3 or yy.min() < 3 or xx.max() >= imagen.width - 3 or yy.max() >= imagen.height - 3:
            raise PrendaNoPreparada("La prenda está cortada o toca los bordes.")
        imagen.putalpha(Image.fromarray(alfa_np))
        margen = max(8, int(max(imagen.size) * 0.035))
        caja = (
            max(0, int(xx.min()) - margen),
            max(0, int(yy.min()) - margen),
            min(imagen.width, int(xx.max()) + margen + 1),
            min(imagen.height, int(yy.max()) + margen + 1),
        )
        dimensiones_procesadas = imagen.size
        imagen = imagen.crop(caja)
        anclas = extraer_anclas(np.asarray(imagen.getchannel("A")))
        datos_anclas = anclas.como_dict()
        if self.detector_estampados is not None:
            datos_anclas["estampados"] = self.detector_estampados.detectar(imagen, datos_anclas)
        textura = codificar(imagen, 1024)
        with Image.open(io.BytesIO(textura)) as salida:
            ancho, alto = salida.size
        return PrendaPreparada(
            textura,
            codificar(imagen, 2048),
            {
                "esquema": 1,
                "tipo": "superior",
                "vista": "frontal",
                "anclas": datos_anclas,
                "ancho": ancho,
                "alto": alto,
                "mime": "image/png",
                "bytes": len(textura),
                "sha256": hashlib.sha256(textura).hexdigest(),
                "metodo": "u2net-perfiles-3" if self.detector_estampados is not None else "u2net-perfiles-2",
                "modelo_sha256": self.sha256,
            },
            {"recorte_pixeles": list(caja), "imagen_procesada": list(dimensiones_procesadas)},
        )
