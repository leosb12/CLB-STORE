"""Un comando para compilar, subir, actualizar por SSM, verificar o volver a la versión anterior."""
import argparse
import base64
import hashlib
import json
import os
import secrets
import string
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
GUIA = Path(__file__).resolve().parent
PERFIL = "clb-despliegue"
REGION = "us-east-2"
CUENTA = "445817183267"
BASE_PUBLICA = "https://clientes.leonardoserrate.xyz"


def aws(*argumentos):
    r = subprocess.run(["aws", *argumentos, "--profile", PERFIL, "--region", REGION, "--output", "json", "--no-cli-pager"], capture_output=True,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8", "AWS_CLI_FILE_ENCODING": "utf-8", "AWS_CLI_OUTPUT_ENCODING": "utf-8"})
    def decodificar(valor):
        try:
            return valor.decode("utf-8")
        except UnicodeDecodeError:
            if os.name != "nt":
                raise
            return valor.decode("cp1252")
    salida = decodificar(r.stdout)
    if r.returncode:
        raise RuntimeError(decodificar(r.stderr).strip())
    return json.loads(salida) if salida.strip() else {}


def ejecutar_ssm(instancia, comandos, plazo=900):
    respuesta = aws("ssm", "send-command", "--instance-ids", instancia, "--document-name", "AWS-RunShellScript",
                    "--parameters", json.dumps({"commands": comandos, "executionTimeout": [str(plazo)]}), "--timeout-seconds", "120",
                    "--comment", "CLB Store: actualización verificable de Clientes")
    identificador = respuesta["Command"]["CommandId"]
    fin = time.monotonic() + plazo
    while time.monotonic() < fin:
        time.sleep(5)
        try:
            resultado = aws("ssm", "get-command-invocation", "--command-id", identificador, "--instance-id", instancia)
        except RuntimeError as error:
            if "InvocationDoesNotExist" in str(error):
                continue
            raise
        if resultado["Status"] in {"Pending", "InProgress", "Delayed"}:
            continue
        print(resultado.get("StandardOutputContent", "").strip(), flush=True)
        if resultado["Status"] != "Success":
            raise RuntimeError(f"SSM {resultado['Status']}: " + resultado.get("StandardErrorContent", "").strip())
        return resultado
    raise RuntimeError("Resultado de actualización incierto: consultar SSM antes de repetir. El paquete conserva su versión.")


def salidas():
    if aws("sts", "get-caller-identity")["Account"] != CUENTA:
        raise RuntimeError("Cuenta incorrecta. No se permite desplegar en otra cuenta.")
    stack = aws("cloudformation", "describe-stacks", "--stack-name", "clb-store-aws")["Stacks"][0]
    return {s["OutputKey"]: s["OutputValue"] for s in stack["Outputs"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    accion = parser.add_mutually_exclusive_group()
    accion.add_argument("--volver", action="store_true")
    accion.add_argument("--probar-recuperacion", action="store_true")
    parser.add_argument("--url", default=BASE_PUBLICA, help="Base pública para verificar salud; por defecto el dominio HTTPS de Clientes.")
    args = parser.parse_args()
    recursos = salidas()
    script = base64.b64encode((GUIA / "actualizar-servidor.sh").read_bytes()).decode("ascii")
    comandos = ["set -eu", f"printf '%s' '{script}' | base64 -d > /var/tmp/clb-actualizar.sh"]
    if args.volver:
        comandos.append("CLB_VOLVER=1 bash /var/tmp/clb-actualizar.sh")
    else:
        cliente = RAIZ / "microservicios" / "clientes"
        # npm.cmd funciona sin alterar ExecutionPolicy de Windows.
        npm = "npm.cmd" if __import__("os").name == "nt" else "npm"
        subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=cliente, check=True)
        subprocess.run([npm, "run", "compilar"], cwd=cliente, check=True)
        version = "clientes_" + datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S-%f")[:-3] + "_UTC_" + "".join(secrets.choice(string.ascii_lowercase) for _ in range(6))
        privados = GUIA / "datos-locales"
        privados.mkdir(exist_ok=True)
        paquete = privados / (version + ".tar.gz")
        with tarfile.open(paquete, "w:gz") as tar:
            for nombre in ["package.json", "package-lock.json", "dist/fuente", "verificacion-aws.mjs"]:
                tar.add(cliente / nombre, arcname=nombre)
        sha = hashlib.sha256(paquete.read_bytes()).hexdigest()
        ruta = f"s3://{recursos['BucketDespliegues']}/CLIENTES/{paquete.name}"
        subprocess.run(["aws", "s3", "cp", str(paquete), ruta, "--profile", PERFIL, "--region", REGION, "--only-show-errors"], check=True)
        print(f"Paquete: {ruta}\nSHA-256: {sha}", flush=True)
        comandos.append(f"CLB_PAQUETE_S3='{ruta}' CLB_SHA256='{sha}' CLB_VERSION='{version}' CLB_PROBAR_RECUPERACION={'1' if args.probar_recuperacion else '0'} bash /var/tmp/clb-actualizar.sh")
        (privados / "ultima-actualizacion.json").write_text(json.dumps({"version": version, "ruta_s3": ruta, "sha256": sha}, indent=2), encoding="utf-8")
    ejecutar_ssm(recursos["Instancia"], comandos)
    # TLS válido y dependencia real. No se desactiva la comprobación de certificado.
    from acceso_publico import solicitar
    with solicitar(args.url, "/salud", ip=recursos['IpPublica']) as r:
        salud = json.load(r)
    if salud.get("estado") != "ACTIVO":
        raise RuntimeError("La URL pública no informa estado ACTIVO.")
    print("Salud pública y DynamoDB verificados en " + args.url + ":", json.dumps(salud, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
