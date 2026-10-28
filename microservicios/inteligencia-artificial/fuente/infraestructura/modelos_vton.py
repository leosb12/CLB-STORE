"""Verificación de pesos locales. Nunca descarga durante una solicitud."""
import hashlib
import json
from pathlib import Path

from fuente.dominio.probador import ErrorProbador


def verificar_pesos(raiz: Path) -> dict:
    try:
        manifiesto = json.loads((raiz / "manifiesto.json").read_text("utf-8"))
        if manifiesto["version"] != 1 or not manifiesto["archivos"]:
            raise ValueError("Manifiesto vacío")
        for relativo, esperado in manifiesto["archivos"].items():
            archivo = (raiz / relativo).resolve()
            if not archivo.is_relative_to(raiz.resolve()):
                raise ValueError("Ruta de peso inválida")
            with archivo.open("rb") as entrada:
                real = hashlib.file_digest(entrada, "sha256").hexdigest()
            if real != esperado:
                raise ValueError("Checkpoint alterado")
        for nombre in ("base", "catvton", "vae", "rembg"):
            if not (raiz / manifiesto["rutas"][nombre]).is_dir():
                raise ValueError("Modelo ausente")
        obligatorios = {
            "catvton": ["DensePose/model_final_162be9.pkl", "DensePose/densepose_rcnn_R_50_FPN_s1x.yaml", "DensePose/Base-DensePose-RCNN-FPN.yaml",
                        "SCHP/exp-schp-201908301523-atr.pth", "SCHP/exp-schp-201908261155-lip.pth", "mix-48k-1024/attention/model.safetensors"],
            "base": ["unet/config.json", "unet/diffusion_pytorch_model.bin", "scheduler/scheduler_config.json"],
            "vae": ["config.json", "diffusion_pytorch_model.safetensors"], "rembg": ["u2net.onnx"]}
        for nombre, requeridos in obligatorios.items():
            for relativo in requeridos:
                ruta = Path(manifiesto["rutas"][nombre]) / relativo
                if ruta.as_posix() not in manifiesto["archivos"] or not (raiz / ruta).is_file():
                    raise ValueError("Falta un checkpoint requerido")
        if manifiesto["archivos"].get("objetos/fasterrcnn.pth") != "fb6a3cc702b1df54c18a44b26708cd083614211062d0c36d2ca7bf9270df3533":
            raise ValueError("Falta el detector de objetos aprobado")
        return manifiesto
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ErrorProbador("PESOS_NO_DISPONIBLES", "El motor fotográfico aún no está preparado. Intenta más tarde o utiliza la vista local.", 503) from error
