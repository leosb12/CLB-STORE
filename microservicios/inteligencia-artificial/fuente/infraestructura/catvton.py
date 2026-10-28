"""Motor residente del CatVTON oficial fijado por commit, sin red."""
import io
import logging
import os
import sys
import tempfile
import warnings
from pathlib import Path

from PIL import Image, ImageChops, ImageCms, ImageOps

from fuente.dominio.probador import ErrorProbador
from fuente.infraestructura.mascara_vton import alfa_composicion, igualar_fondo_regenerado, mascara_agnostica
from fuente.infraestructura.modelos_vton import verificar_pesos
from fuente.infraestructura.oclusiones_vton import DetectorOclusiones

registro = logging.getLogger("clb.vton.motor")


def preparar_encuadre(imagen, tamano=(768, 1024)):
    contenido = ImageOps.contain(imagen, tamano).size
    # ImageOps.pad redondea los desplazamientos; //2 desplaza un píxel algunos márgenes impares.
    izquierda = round((tamano[0] - contenido[0]) / 2)
    arriba = round((tamano[1] - contenido[1]) / 2)
    caja = (izquierda, arriba, izquierda + contenido[0], arriba + contenido[1])
    return ImageOps.pad(imagen, tamano, color="white"), caja


def leer_imagen(datos: bytes) -> Image.Image:
    if not datos or len(datos) > 8 * 1024 * 1024:
        raise ErrorProbador("IMAGEN_INVALIDA", "Envía una imagen JPG o PNG de hasta 8 MB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(datos)) as imagen:
                if imagen.format not in ("JPEG", "PNG", "WEBP") or getattr(imagen, "is_animated", False) or imagen.width * imagen.height > 16_000_000 or min(imagen.size) < 256:
                    raise ValueError("Dimensiones o formato inválidos")
                imagen.load()
                orientada = ImageOps.exif_transpose(imagen)
                perfil = imagen.info.get("icc_profile")
                if perfil:
                    # Convertir los valores, no solo descartar la etiqueta ICC (Display P3/CMYK).
                    alfa = orientada.convert("RGBA").getchannel("A")
                    entrada = orientada if orientada.mode in ("RGB", "CMYK", "LAB") else orientada.convert("RGB")
                    resultado = ImageCms.profileToProfile(entrada, ImageCms.ImageCmsProfile(io.BytesIO(perfil)),
                                                         ImageCms.createProfile("sRGB"), outputMode="RGB")
                    resultado.putalpha(alfa)
                else:
                    resultado = orientada.convert("RGBA")
                resultado.info.clear()
                return resultado
    except (OSError, ValueError, ImageCms.PyCMSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ErrorProbador("IMAGEN_INVALIDA", "Usa una fotografía válida de al menos 256 píxeles por lado y hasta 16 megapíxeles.") from error


def componer_resultado(original, generado, mascara, protegida):
    """Una sola mezcla con el antialias de la máscara escalada, sin duplicar su alfa."""
    alfa = ImageChops.multiply(mascara, ImageOps.invert(protegida))
    resultado = Image.composite(generado.convert("RGB"), original.convert("RGB"), alfa)
    if original.mode == "RGBA":
        resultado.putalpha(original.getchannel("A"))
    return resultado


class MotorCatVTON:
    def __init__(self, pesos: str):
        raiz = Path(pesos).resolve()
        os.environ.update(HF_HOME=str(Path(tempfile.gettempdir()) / "clb-vton-hf"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                          TRANSFORMERS_CACHE=str(Path(tempfile.gettempdir()) / "clb-vton-transformers"),
                          HF_HUB_DISABLE_TELEMETRY="1", U2NET_HOME=str(raiz / "rembg"))
        manifiesto = verificar_pesos(raiz)
        registro.info("Pesos locales verificados")
        os.environ["CLB_VTON_VAE"] = str(raiz / manifiesto["rutas"]["vae"])
        sys.path.insert(0, os.environ.get("CLB_VTON_FUENTE", "/opt/CatVTON"))
        import torch
        from model.cloth_masker import AutoMasker
        from model.pipeline import CatVTONPipeline

        if not torch.cuda.is_available():
            raise ErrorProbador("GPU_NO_DISPONIBLE", "El motor fotográfico no está disponible en este servidor. Usa la vista local o inténtalo más tarde.", 503)
        self.torch = torch
        torch.backends.cudnn.benchmark = True
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        self.oclusiones = DetectorOclusiones(raiz / "objetos/fasterrcnn.pth")
        modelos = raiz / manifiesto["rutas"]["catvton"]
        self.mascarador = AutoMasker(densepose_ckpt=str(modelos / "DensePose"),
                                    schp_ckpt=str(modelos / "SCHP"), device="cuda")
        registro.info("DensePose y SCHP residentes en CUDA")
        from rembg import new_session
        self.segmentador = new_session("u2net", providers=["CPUExecutionProvider"])
        self.pipeline = CatVTONPipeline(base_ckpt=str(raiz / manifiesto["rutas"]["base"]),
                                       attn_ckpt=str(raiz / manifiesto["rutas"]["catvton"]),
                                       attn_ckpt_version="mix", weight_dtype=torch.float16,
                                       device="cuda", skip_safety_check=True)
        # CatVTON usa este interruptor propio, no los kwargs de StableDiffusionPipeline.
        self.pipeline.safety_checker = None
        self.pipeline.feature_extractor = None
        self.pipeline.requires_safety_checker = False
        self.pipeline.vae.enable_slicing()
        self.pipeline.vae.enable_tiling()
        registro.info("CatVTON residente en CUDA fp16, 24 pasos; filtro desactivado")

    def generar(self, persona: bytes, prenda: bytes, categoria: str, semilla: int) -> bytes:
        from tempfile import TemporaryDirectory

        original = leer_imagen(persona)
        ancho_orig, alto_orig = original.size
        # Mapeo canónico a 768x1024 preservando relación de aspecto
        imagen, caja_contenido = preparar_encuadre(original.convert("RGB"), (768, 1024))
        ropa = leer_imagen(prenda)
        if ropa.getextrema()[3][0] == 255:
            from rembg import remove
            ropa = remove(ropa, session=self.segmentador).convert("RGBA")
        alfa = ropa.getchannel("A")
        caja = alfa.point(lambda valor: 255 if valor > 32 else 0).getbbox()
        if caja is None or (caja[2] - caja[0]) * (caja[3] - caja[1]) < ropa.width * ropa.height * 0.03:
            raise ErrorProbador("PRENDA_INVALIDA", "No se pudo separar la prenda de su fondo. Usa la fotografía publicada del catálogo.")
        ropa = ImageOps.contain(ropa.crop(caja), (704, 960))
        condicion = Image.new("RGB", (768, 1024), "white")
        condicion.paste(ropa, ((768 - ropa.width) // 2, (1024 - ropa.height) // 2), ropa)
        # Verifica una sola persona antes de que el extractor oficial seleccione la primera.
        with self.torch.inference_mode(), self.torch.autocast("cuda", dtype=self.torch.float16):
            registro.info("Validando persona y generando máscara semántica")
            import numpy as np
            instancias = self.mascarador.densepose_processor.predictor(np.asarray(imagen)[:, :, ::-1])["instances"]
            if len(instancias) != 1:
                raise ErrorProbador("PERSONA_INVALIDA", "La foto debe mostrar exactamente una persona con el cuerpo visible.")
            # Protección de primer plano delimitada anatómicamente:
            # 1. Manos estrictas sin antebrazos para permitir mangas largas completas.
            predictor = self.mascarador.densepose_processor
            datos_pose, cajas_pose = predictor.create_context(predictor.cfg, "")["extractor"](instancias)[0]
            px, py, ancho_pose, alto_pose = [int(v) for v in cajas_pose[0].cpu().tolist()]
            etiquetas_pose = datos_pose[0].labels.cpu().numpy()
            manos_escena = np.zeros((1024, 768), dtype="uint8")
            manos_indices = np.isin(etiquetas_pose, [3, 4]) & ~np.isin(etiquetas_pose, [1, 2, 15, 16, 17, 18, 19, 20, 21, 22])
            manos_escena[py:py + alto_pose, px:px + ancho_pose] = manos_indices.astype("uint8") * 255
            # 2. Oclusiones (teléfono móvil, accesorios en mano sobre el torso)
            x1, y1, x2, y2 = instancias.pred_boxes.tensor[0].cpu().tolist()
            objetos_escena = self.oclusiones.mascara(imagen, (int(x1), int(y1), int(x2), int(y2)))
            primer_plano = ImageChops.lighter(Image.fromarray(manos_escena), objetos_escena)

            # DensePose oficial escribe temporales relativos: directorio efímero privado del subproceso.
            anterior = os.getcwd()
            with TemporaryDirectory(prefix="clb-pose-") as temporal:
                try:
                    os.chdir(temporal)
                    analisis = self.mascarador.preprocess_image(imagen)
                finally:
                    os.chdir(anterior)
            analisis["oclusion"] = self.oclusiones.mascara(imagen, analisis["densepose"].getbbox())
            base = self.mascarador.cloth_agnostic_mask(analisis["densepose"], analisis["schp_lip"], analisis["schp_atr"], part=categoria)
            mascara = mascara_agnostica(analisis, categoria, base)
            # `latent_dist.sample()` del VAE usa el RNG global: sin fijarlo, la misma clave no reproduce la imagen.
            self.torch.manual_seed(semilla)
            generador = self.torch.Generator(device="cuda").manual_seed(semilla)
            self.torch.cuda.reset_peak_memory_stats()
            registro.info("Iniciando difusión")
            resultado = self.pipeline(image=imagen, condition_image=condicion, mask=mascara,
                                      width=768, height=1024, num_inference_steps=24,
                                      guidance_scale=2.5, generator=generador)[0]
            if not np.asarray(resultado).any():
                raise ErrorProbador("RESULTADO_NO_APTO", "El motor no pudo producir una imagen utilizable. Prueba otra fotografía.", 503)
            # Identidad y zonas protegidas conservan exactamente los píxeles de la entrada normalizada.
            # El fondo que el modelo repintó dentro del margen vuelve a la foto (sin halo): se decide
            # parseando el resultado con los mismos SCHP residentes.
            lip, atr = (np.asarray(analisis[k].resize((768, 1024), Image.Resampling.NEAREST)) for k in ("schp_lip", "schp_atr"))
            lip_g, atr_g = (np.asarray(p(resultado).resize((768, 1024), Image.Resampling.NEAREST))
                            for p in (self.mascarador.schp_processor_lip, self.mascarador.schp_processor_atr))
            fondo_o, fondo_g = (lip == 0) & (atr == 0), (lip_g == 0) & (atr_g == 0)
            mezcla = alfa_composicion(mascara, fondo_o, fondo_g)
            resultado = igualar_fondo_regenerado(resultado, imagen, np.asarray(mascara) > 0, fondo_o, fondo_g)
            # Des-empaquetado canónico a las dimensiones originales (W, H)
            # No componer aquí y otra vez al final: elevaría el alfa al cuadrado,
            # haciendo reaparecer la camiseta anterior en los bordes.
            # BICUBIC: menos sobreimpulso que LANCZOS en los bordes de alto contraste de la prenda.
            generado_orig = resultado.crop(caja_contenido).resize((ancho_orig, alto_orig), Image.Resampling.BICUBIC)
            mascara_orig = mezcla.crop(caja_contenido).resize((ancho_orig, alto_orig), Image.Resampling.BILINEAR)
            protegida_orig = primer_plano.crop(caja_contenido).resize((ancho_orig, alto_orig), Image.Resampling.NEAREST)
            resultado_final = componer_resultado(original, generado_orig, mascara_orig, protegida_orig)
            salida = io.BytesIO()
            resultado_final.save(salida, format="PNG")
            return salida.getvalue()
