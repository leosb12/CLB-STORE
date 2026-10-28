"""Único aprovisionamiento con Internet; después el worker trabaja con HF_HUB_OFFLINE=1.

python setup_weights.py --directorio ./weights
python setup_weights.py --directorio ./weights --verificar
La primera ejecución fija revisiones exactas en revisiones.json; no avanza silenciosamente a main.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import urllib.request


def ejecutar():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directorio", default=os.environ.get("CLB_VTON_PESOS", str(Path(__file__).parent / "weights")))
    parser.add_argument("--verificar", action="store_true")
    argumentos = parser.parse_args()
    raiz = Path(argumentos.directorio).resolve()
    if argumentos.verificar:
        from fuente.infraestructura.modelos_vton import verificar_pesos
        verificar_pesos(raiz)
        print("Pesos completos e íntegros; no se utilizó Internet.")
        return
    raiz.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(raiz)
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    # HTTP reanudable evita bloqueos de Xet y caché adicional en Windows/OneDrive.
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    from huggingface_hub import HfApi, snapshot_download

    repositorios = {"catvton": "zhengchong/CatVTON", "base": "booksforcharlie/stable-diffusion-inpainting",
                    "vae": "stabilityai/sd-vae-ft-mse"}
    archivo_revisiones = raiz / "revisiones.json"
    if archivo_revisiones.exists():
        revisiones = json.loads(archivo_revisiones.read_text("utf-8"))
    else:
        fijadas = {"catvton": "2969fcf85fe62f2036605716f0b56f0b81d01d79", "base": "d260cf3646fe94c6d5d70820b77512f836d7cce2",
                   "vae": "31f26fdeee1355a5c34592e401dd41e45d25a493"}
        revisiones = {nombre: {"repo": repo, "revision": fijadas[nombre]} for nombre, repo in repositorios.items()}
        archivo_revisiones.write_text(json.dumps(revisiones, indent=2) + "\n", "utf-8")
    rutas = {}
    for nombre, datos in revisiones.items():
        print("Aprovisionando", nombre, datos["revision"], flush=True)
        filtros = {"catvton": ["DensePose/*", "SCHP/*", "mix-48k-1024/attention/*", "*.md", "LICENCE*"],
                   "base": ["unet/*", "scheduler/*", "model_index.json"],
                   "vae": ["config.json", "diffusion_pytorch_model.safetensors", "README.md"]}[nombre]
        ruta = Path(snapshot_download(repo_id=datos["repo"], revision=datos["revision"], cache_dir=str(raiz / "hub"),
                                      allow_patterns=filtros,
                                      max_workers=2))
        # Exportación portable: no depender de enlaces simbólicos de Windows dentro de Linux/Docker.
        destino_modelo = raiz / nombre
        shutil.copytree(ruta, destino_modelo, dirs_exist_ok=True, symlinks=False)
        for ficha in HfApi().list_repo_tree(datos["repo"], revision=datos["revision"], recursive=True):
            archivo = destino_modelo / ficha.path
            if not archivo.is_file() or not hasattr(ficha, "size"):
                continue
            if archivo.stat().st_size != ficha.size:
                raise RuntimeError("Tamaño de checkpoint incorrecto: " + ficha.path)
            if ficha.lfs:
                with archivo.open("rb") as entrada:
                    if hashlib.file_digest(entrada, "sha256").hexdigest() != ficha.lfs.sha256:
                        raise RuntimeError("Checkpoint no coincide con Hugging Face: " + ficha.path)
        rutas[nombre] = nombre
        # CatVTON carga el VAE por su ID oficial: su referencia main debe resolver offline al SHA fijado.
        referencias = ruta.parent.parent / "refs"
        referencias.mkdir(exist_ok=True)
        (referencias / "main").write_text(datos["revision"], "utf-8")
    rembg = raiz / "rembg"
    rembg.mkdir(exist_ok=True)
    destino = rembg / "u2net.onnx"
    if not destino.exists():
        existente = Path(__file__).parent / "modelos-prendas/u2net.onnx"
        temporal = destino.with_suffix(".tmp")
        if existente.exists():
            shutil.copyfile(existente, temporal)
        else:
            urllib.request.urlretrieve("https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx", temporal)
        temporal.replace(destino)
    with destino.open("rb") as entrada:
        if hashlib.file_digest(entrada, "sha256").hexdigest() != "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491":
            raise RuntimeError("U²-Net no coincide con el checkpoint aprobado por CLB")
    rutas["rembg"] = "rembg"
    archivos = {}
    for ruta in (archivo for nombre in (*repositorios, "rembg") for archivo in (raiz / nombre).rglob("*")):
        if ruta.is_file():
            with ruta.open("rb") as entrada:
                archivos[ruta.relative_to(raiz).as_posix()] = hashlib.file_digest(entrada, "sha256").hexdigest()
    manifiesto = {"version": 1, "catvton_commit": "7818397f25613beedb3d861a34769f607cfcf3b1", "rutas": rutas,
                  "revisiones": revisiones, "archivos": archivos}
    temporal = raiz / "manifiesto.tmp"
    temporal.write_text(json.dumps(manifiesto, indent=2) + "\n", "utf-8")
    temporal.replace(raiz / "manifiesto.json")
    from preparar_objetos_vton import preparar
    preparar(raiz)
    print("Aprovisionamiento completo. Verifica con --verificar antes de desconectar Internet.")


if __name__ == "__main__":
    ejecutar()
