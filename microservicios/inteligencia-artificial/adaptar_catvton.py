"""Adaptación verificada al commit oficial: VAE local y UNet fp16, sin red."""
from pathlib import Path
import sys

ruta = Path(sys.argv[1]) / "model/pipeline.py"
original = ruta.read_text("utf-8")
buscado = 'AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse")'
reemplazo = 'AutoencoderKL.from_pretrained(os.environ["CLB_VTON_VAE"], local_files_only=True, torch_dtype=weight_dtype, low_cpu_mem_usage=True)'
if original.count(buscado) != 1:
    raise SystemExit("El código oficial cambió: revisar el parche de VAE antes de construir.")
adaptado = original.replace(buscado, reemplazo)
for clase, carpeta in (("UNet2DConditionModel", "unet"),):
    buscado = f'{clase}.from_pretrained(base_ckpt, subfolder="{carpeta}")'
    if adaptado.count(buscado) != 1:
        raise SystemExit("Revisar adaptación de carga fp16: " + clase)
    adaptado = adaptado.replace(buscado, f'{clase}.from_pretrained(base_ckpt, subfolder="{carpeta}", torch_dtype=weight_dtype, low_cpu_mem_usage=True, local_files_only=True)')
ruta.write_text(adaptado, "utf-8")

