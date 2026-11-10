"""Cliente HTTPS de archivos compartidos: funciona en PC, Azure y GCP sin claves AWS.

No genera otra Idempotency-Key tras un fallo. El llamador debe persistir y reutilizar `clave`.
Las URLs firmadas nunca se registran; solo la ruta permanente y los metadatos.
"""
import argparse
import hashlib
import json
import os
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class ArchivosClb:
    def __init__(self, token, base="https://clientes.leonardoserrate.xyz"):
        if not base.startswith("https://"):
            raise ValueError("La API de archivos exige HTTPS.")
        self.base, self.token = base.rstrip("/"), token

    def api(self, ruta, metodo="GET", datos=None, clave=None):
        cabeceras = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
        if clave:
            identificador = uuid.UUID(clave)
            if identificador.version != 4:
                raise ValueError("La clave debe ser un UUID v4 estable.")
            cabeceras["Idempotency-Key"] = str(identificador)
        solicitud = urllib.request.Request(self.base + "/api/v1/archivos" + ruta, method=metodo, headers=cabeceras,
                                           data=None if datos is None else json.dumps(datos, ensure_ascii=False).encode("utf-8"))
        with urllib.request.urlopen(solicitud, timeout=30) as respuesta:
            return json.load(respuesta)

    def subir(self, contenido, descripcion, tipo, mime, clave, origen="microservicio", referencias=None):
        datos = {"tipo": tipo, "descripcion": descripcion, "mime": mime, "bytes": len(contenido),
                 "sha256": hashlib.sha256(contenido).hexdigest(), "origen": origen, "referencias": referencias or {}}
        preparada = self.api("/subidas", "POST", datos, clave)
        if "subida" in preparada:
            subida = preparada["subida"]
            solicitud = urllib.request.Request(subida["url"], data=contenido, method="PUT", headers=subida["cabeceras"])
            try:
                with urllib.request.urlopen(solicitud, timeout=120):
                    pass
            except urllib.error.HTTPError as error:
                # Objeto ya recibido tras una respuesta perdida: confirmar verifica el SHA-256 exacto antes de aceptarlo.
                if error.code != 412:
                    raise
            preparada = self.api("/" + clave + "/confirmar", "POST", {})
        archivo = preparada["archivo"]
        print(json.dumps({"ruta_s3": archivo["ruta_s3"], "identificador": archivo["identificador"], "estado": archivo["estado"]}, ensure_ascii=False))
        return archivo

    def descargar(self, clave):
        descarga = self.api("/" + clave + "/descarga")
        with urllib.request.urlopen(descarga["url"], timeout=120) as respuesta:
            datos = respuesta.read(20 * 1024 * 1024 + 1)
        archivo = self.api("/" + clave)["archivo"]
        if len(datos) != archivo["bytes"] or hashlib.sha256(datos).hexdigest() != archivo["sha256"]:
            raise ValueError("La descarga no coincide con la integridad registrada.")
        return datos


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archivo", type=Path)
    parser.add_argument("--descripcion", required=True)
    parser.add_argument("--tipo", required=True)
    parser.add_argument("--mime", required=True)
    parser.add_argument("--clave", required=True, help="UUID v4 persistido por el llamador; reutilizar ante resultado incierto.")
    parser.add_argument("--origen", choices=["web", "android", "microservicio"], default="microservicio")
    args = parser.parse_args()
    token = os.environ.get("CLB_TOKEN")
    if not token:
        raise SystemExit("Configura CLB_TOKEN con un token OIDC vigente; nunca lo agregues al comando ni al repositorio.")
    if args.archivo.stat().st_size > 20 * 1024 * 1024:
        raise SystemExit("El archivo supera 20 MiB.")
    try:
        archivo = ArchivosClb(token, os.environ.get("CLB_ARCHIVOS_URL", "https://clientes.leonardoserrate.xyz")).subir(
            args.archivo.read_bytes(), args.descripcion, args.tipo, args.mime, args.clave, args.origen)
    except urllib.error.HTTPError as error:
        # HTTPError incluye una URL firmada en su representación; no imprimirla.
        raise SystemExit(f"HTTP {error.code}: revisar la operación y reintentar con la MISMA clave.")
    locales = Path(__file__).parent / "datos-locales"
    locales.mkdir(exist_ok=True)
    with (locales / "archivos.jsonl").open("a", encoding="utf-8") as registro:
        registro.write(json.dumps(archivo, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
