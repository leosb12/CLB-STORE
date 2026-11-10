"""Verificación explícita de AWS. Crea perfiles/archivos de ensayo identificables; no genera ventas ni envíos reales."""
import json
import argparse
import shlex
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from desplegar import aws, ejecutar_ssm, salidas, PERFIL, REGION, RAIZ, BASE_PUBLICA
from acceso_publico import solicitar


def publico(base=BASE_PUBLICA, ip=None):
    base = base.rstrip('/')
    with solicitar(base, "/salud", ip=ip) as respuesta:
        salud = json.load(respuesta)
    if salud.get("estado") != "ACTIVO" or salud.get("dependencias", {}).get("dynamodb") != "ACTIVO":
        raise RuntimeError("El backend no está saludable desde Internet.")
    for ruta, cabeceras in [("/api/v1/perfiles/yo", {}), ("/api/v1/archivos", {}), ("/api/v1/perfiles/yo", {"Authorization": "Bearer invalido"})]:
        try:
            with solicitar(base, ruta, cabeceras, ip=ip):
                pass
        except urllib.error.HTTPError as error:
            esperado = 401 if base.startswith('https://') else 426
            if error.code != esperado:
                raise RuntimeError(f"Se esperaba {esperado} en {ruta}; recibido {error.code}")
        else:
            raise RuntimeError("Una ruta privada aceptó una solicitud sin identidad válida.")
    print("OK: salud pública, DynamoDB ACTIVO y operaciones privadas protegidas en " + base)
    return salud


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=BASE_PUBLICA)
    args = parser.parse_args()
    recursos = salidas()
    salud = publico(args.url, recursos['IpPublica'])
    fecha = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S-%f")[:-3] + "_UTC"
    muestra = RAIZ / "infraestructura/datos-equipo/semilla/recursos/ad3ff0218b8db365e6b9167a931e7ee07b2d16366c6bf38037a0dc27f798d02e.png"
    ruta = f"s3://{recursos['BucketDespliegues']}/CLIENTES/polera-gris-jaspeada-frontal_{fecha}.png"
    subprocess.run(["aws", "s3", "cp", str(muestra), ruta, "--region", REGION, "--profile", PERFIL, "--only-show-errors"], check=True)
    print("Muestra temporal:", ruta)
    resultado = ejecutar_ssm(recursos["Instancia"], ["set -eu", "cd /opt/clb/clientes/actual",
        "curl --fail --silent --show-error --max-time 20 " + shlex.quote(args.url.rstrip('/') + "/salud"), "printf '\\n'",
        f"aws s3 cp '{ruta}' /var/tmp/clb-polera-prueba.png --region {REGION} --only-show-errors",
        f"CLB_DYNAMODB_REGION={REGION} CLB_ENTORNO=produccion node verificacion-aws.mjs /var/tmp/clb-polera-prueba.png"], plazo=180)
    lineas = resultado.get("StandardOutputContent", "").splitlines()
    evidencia = next((json.loads(l) for l in lineas if l.startswith('{"fecha":')), None)
    if not evidencia:
        raise RuntimeError("Falta evidencia completa del verificador remoto.")
    evidencia["salud_publica"] = salud
    evidencia["url_publica"] = args.url
    evidencia["https_publico_verificado"] = args.url.startswith('https://')
    evidencia["salud_desde_ec2_con_resolucion_estandar"] = True
    locales = Path(__file__).parent / "datos-locales"
    locales.mkdir(exist_ok=True)
    (locales / "evidencia-aws.json").write_text(json.dumps(evidencia, indent=2, ensure_ascii=False), encoding="utf-8")
    print("Evidencia sin credenciales guardada en datos-locales/evidencia-aws.json.")


if __name__ == "__main__":
    main()
