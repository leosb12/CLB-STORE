"""Prueba física offline y restauración obligatoria de APK NORMAL/conexión USB.

Ejecutar solo con el dispositivo expresamente autorizado: --dispositivo SERIAL.
No borra datos/volúmenes ni publica productos. Conserva evidencia sin fotografías.
"""

import argparse
import base64
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dispositivo", required=True)
    parser.add_argument("--fotos-privadas", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.dispositivo):
        raise ValueError("Identificador ADB inválido")

    def adb(*argumentos):
        return subprocess.check_output(
            ["adb", "-s", args.dispositivo, *argumentos], encoding="utf-8"
        ).strip()

    def sensores():
        bateria = adb("shell", "dumpsys", "battery")
        termico = adb("shell", "dumpsys", "thermalservice")
        t = re.search(r"^\s*temperature:\s*(-?\d+)", bateria, re.M)
        estado = re.search(r"^Thermal Status:\s*(\d+)", termico, re.M)
        return {
            "bateria_c": int(t[1]) / 10 if t else None,
            "estado_termico": int(estado[1]) if estado else None,
            "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    ajustes = {
        k: adb("shell", "settings", "get", "global", k)
        for k in ["airplane_mode_on", "wifi_on", "mobile_data"]
    }
    reverse = adb("reverse", "--list")
    informe = {
        "modelo": adb("shell", "getprop", "ro.product.model"),
        "android": adb("shell", "getprop", "ro.build.version.release"),
        "ajustes_originales": ajustes,
        "antes": sensores(),
        "muestras_termicas": [],
        "pruebas": [],
        "apk_normal_restaurada": False,
    }
    carpeta = RAIZ / "temporales/validacion-material-android"
    carpeta.mkdir(parents=True, exist_ok=True)
    flutter = shutil.which("flutter")
    if not flutter:
        raise RuntimeError("Flutter no está disponible")
    # Flutter puede retirar el APK de integración: conservar estado de la app
    # normal en memoria privada antes de instalarlo, sin imprimir credenciales.
    adb("shell", "am", "force-stop", "bo.clb.store")
    directorios = [d for d in ("files", "databases", "shared_prefs")
                   if subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "test", "-d", d], capture_output=True).returncode == 0]
    respaldo = subprocess.check_output(["adb", "-s", args.dispositivo, "exec-out", "run-as", "bo.clb.store", "tar", "-cf", "-", *directorios]) if directorios else None
    archivos_privados = []
    if args.fotos_privadas:
        privada = args.fotos_privadas.resolve()
        if not privada.is_relative_to((RAIZ / "temporales").resolve()):
            raise ValueError("Las fotos deben permanecer bajo temporales")
        archivos_privados = ["1.png", "2.png", "3.png", "4.png", "textura.png", "datos.json"]
        adb("shell", "run-as", "bo.clb.store", "mkdir", "-p", "files/clb_pruebas_privadas")
        for nombre in archivos_privados:
            subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "sh", "-c",
                            "'base64 -d > files/clb_pruebas_privadas/" + nombre + "'"],
                           input=base64.b64encode((privada / nombre).read_bytes()), check=True)
            remoto = adb("shell", "run-as", "bo.clb.store", "sha256sum", "files/clb_pruebas_privadas/" + nombre).split()[0]
            if remoto != hashlib.sha256((privada / nombre).read_bytes()).hexdigest():
                raise RuntimeError("La transferencia USB no conserva la integridad de " + nombre)
    try:
        adb("shell", "cmd", "connectivity", "airplane-mode", "enable")
        adb("shell", "svc", "wifi", "disable")
        adb("shell", "svc", "data", "disable")
        if "tcp:18000" in reverse:
            adb("reverse", "--remove", "tcp:18000")
        informe["sin_red"] = {
            k: adb("shell", "settings", "get", "global", k) for k in ajustes
        }
        informe["reverse_api_ausente"] = "tcp:18000" not in adb("reverse", "--list")
        if informe["sin_red"]["airplane_mode_on"] != "1" or not informe["reverse_api_ausente"]:
            raise RuntimeError("No se confirmó modo avión sin túnel API")
        for archivo in (["fotos_privadas_test.dart"] if archivos_privados else ["material_test.dart"]) + ["dispositivo_test.dart"]:
            log = carpeta / (archivo + ".log")
            with log.open("w", encoding="utf-8") as salida:
                proceso = subprocess.Popen(
                    [flutter, "test", "integration_test/" + archivo, "-d", args.dispositivo,
                     "--no-pub", "--dart-define=CLB_REPETICIONES_MATERIAL=10"],
                    cwd=RAIZ / "aplicaciones/android", stdout=salida, stderr=subprocess.STDOUT,
                )
                print("Prueba física iniciada: " + archivo, flush=True)
                while proceso.poll() is None:
                    informe["muestras_termicas"].append(sensores())
                    if archivos_privados and archivo == "fotos_privadas_test.dart" and not informe.get("resultados_recogidos"):
                        listo = subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "test", "-f", "files/clb_pruebas_privadas/listo"], capture_output=True)
                        if listo.returncode == 0:
                            destino = carpeta / "fotos-privadas"
                            destino.mkdir(exist_ok=True)
                            for i in range(1, 5):
                                nombre = f"resultado-{i}.png"
                                salida = subprocess.check_output(["adb", "-s", args.dispositivo, "exec-out", "run-as", "bo.clb.store", "cat", "files/clb_pruebas_privadas/" + nombre])
                                (destino / nombre).write_bytes(salida)
                            adb("shell", "run-as", "bo.clb.store", "touch", "files/clb_pruebas_privadas/recogido")
                            informe["resultados_recogidos"] = True
                    time.sleep(5)
            texto = log.read_text(encoding="utf-8")
            mediciones = re.search(r"CLB_MATERIAL_FOTOS_MS=(\[[\d, ]+\])", texto)
            caso = {"archivo": archivo, "codigo_salida": proceso.returncode}
            if mediciones:
                caso["composiciones_ms"] = json.loads(mediciones[1])
            informe["pruebas"].append(caso)
            print(json.dumps(caso), flush=True)
            if proceso.returncode:
                raise RuntimeError("Falló la integración física; ver log local ignorado")
        informe["despues"] = sensores()
    finally:
        if archivos_privados:
            # Únicamente nombres constantes del ensayo; nunca borrado recursivo.
            for nombre in archivos_privados + [f"resultado-{i}.png" for i in range(1, 5)] + ["listo", "recogido"]:
                subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "rm", "-f", "files/clb_pruebas_privadas/" + nombre], capture_output=True)
            subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "rmdir", "files/clb_pruebas_privadas"], capture_output=True)
        adb("shell", "cmd", "connectivity", "airplane-mode", "enable" if ajustes["airplane_mode_on"] == "1" else "disable")
        adb("shell", "svc", "wifi", "enable" if ajustes["wifi_on"] == "1" else "disable")
        adb("shell", "svc", "data", "enable" if ajustes["mobile_data"] == "1" else "disable")
        helper = RAIZ / "aplicaciones/android/preparar-movil.ps1"
        normal = subprocess.run([shutil.which("pwsh") or "powershell", "-NoProfile", "-File", str(helper), "-Dispositivo", args.dispositivo], cwd=RAIZ, check=False)
        informe["apk_normal_restaurada"] = normal.returncode == 0
        if normal.returncode == 0 and respaldo:
            adb("shell", "am", "force-stop", "bo.clb.store")
            subprocess.run(["adb", "-s", args.dispositivo, "shell", "run-as", "bo.clb.store", "sh", "-c", "'base64 -d | tar -xf -'"], input=base64.b64encode(respaldo), check=True)
            adb("shell", "am", "start", "-n", "bo.clb.store/bo.clb.clb_store.MainActivity")
            informe["estado_local_restaurado"] = True
        informe["reverse_api_restaurado"] = "tcp:18000" in adb("reverse", "--list")
        informe["ajustes_finales"] = {k: adb("shell", "settings", "get", "global", k) for k in ajustes}
        (carpeta / "resultado.json").write_text(json.dumps(informe, indent=2) + "\n", encoding="utf-8")
        print("Resultado local sin fotos: " + str(carpeta / "resultado.json"), flush=True)
        if not informe["apk_normal_restaurada"]:
            raise RuntimeError("No se pudo restaurar APK normal; ejecutar preparar-movil.ps1")


if __name__ == "__main__":
    main()
