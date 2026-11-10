import copy
import json
import os
import pathlib
import re
import secrets

import yaml

base = pathlib.Path(__file__).resolve().parent
repo = base.parents[1]
local = yaml.safe_load((base.parent / "bases-de-datos/compose.yaml").read_text(encoding="utf-8"))
servicios = {}
for nombre in ("inventario", "identidad", "pasarela", "web", "probador", "automatizacion"):
    servicio = servicios[nombre] = copy.deepcopy(local["services"][nombre])
    for campo in ("ports", "networks", "depends_on"):
        servicio.pop(campo, None)
    servicio["logging"] = {"driver": "local", "options": {"max-size": "10m", "max-file": "3"}}
inventario = servicios["inventario"]
inventario["build"].update(target="nube", args={"CLB_PHP_IMAGEN": "php:8.4-apache-bookworm"})
inventario["image"] = "clb_inventario:gcp"
env = inventario["environment"]
for clave in tuple(env):
    if clave.startswith("CLB_MONGO_") and clave not in ("CLB_MONGO_BASE", "CLB_MONGO_COLECCION"):
        del env[clave]
env.update(APP_ENV="production", APP_URL="https://api.leonardoserrate.xyz", CLB_MONGO_URI="${CLB_MONGO_URI:-}",
           CLB_IDENTIDAD_EMISOR="https://auth.leonardoserrate.xyz/identidad/realms/clb")
identidad = servicios["identidad"]
identidad["command"] = ["start", "--import-realm"]
identidad["environment"].update(KC_HOSTNAME="https://auth.leonardoserrate.xyz/identidad",
    KC_HTTP_ENABLED="true", KC_DB="postgres", KC_DB_URL="jdbc:postgresql://postgres-sso:5432/keycloak",
    KC_DB_USERNAME="keycloak", KC_DB_PASSWORD="${CLB_SSO_CLAVE_POSTGRES:?}")
identidad["volumes"] = ["./privado/realm-clb.json:/opt/keycloak/data/import/realm-clb.json:ro"]
identidad["depends_on"] = {"postgres-sso": {"condition": "service_healthy"}}
prueba = identidad["healthcheck"]["test"]
prueba[1] = prueba[1].replace("grep -q", """grep -m1 '"status"' <&3 | grep -q""").removesuffix(" <&3")
servicios["postgres-sso"] = {
    "image": "postgres:17.6-bookworm", "restart": "unless-stopped",
    "environment": {"POSTGRES_DB": "keycloak", "POSTGRES_USER": "keycloak", "POSTGRES_PASSWORD": "${CLB_SSO_CLAVE_POSTGRES:?}"},
    "volumes": ["sso-db:/var/lib/postgresql/data"],
    "healthcheck": {"test": ["CMD", "pg_isready", "-U", "keycloak"], "interval": "5s", "timeout": "3s", "retries": 20},
}
servicios["web"]["image"] = "clb_web:gcp"
servicios["web"]["build"]["args"] = {
    "CLB_IDENTIDAD_AUTORIDAD": "https://auth.leonardoserrate.xyz/identidad/realms/clb",
}
servicios["web"]["volumes"] = [
    "./privado/cabeceras-seguridad.conf:/etc/nginx/cabeceras-seguridad.conf:ro",
]
servicios["probador"]["image"] = "clb_probador:gcp"
gateway = servicios["pasarela"]
gateway["volumes"] = ["./privado/nginx.conf:/etc/nginx/nginx.conf:ro"]
automatizacion = servicios["automatizacion"]
automatizacion["ports"] = ["127.0.0.1:15678:5678"]
for nombre in ("VENTAS", "CLIENTES", "IA"):
    automatizacion["environment"][f"CLB_{nombre}_URL"] = f"${{CLB_{nombre}_URL:-http://127.0.0.1:9}}"
automatizacion["environment"]["N8N_SECURE_COOKIE"] = "true"
servicios["borde"] = {"image": "caddy:2-alpine", "restart": "unless-stopped",
    "ports": ["80:80", "443:443"],
    "volumes": ["./Caddyfile:/etc/caddy/Caddyfile:ro", "tls:/data", "caddy-config:/config"],
    "logging": {"driver": "local"},
}
(base / "compose.generado.yaml").write_text(yaml.safe_dump({"name": "clb-gcp", "services": servicios,
    "volumes": {k: None for k in ("recursos-prendas", "sso-db", "n8n", "tls", "caddy-config")}},
    sort_keys=False, allow_unicode=True), encoding="utf-8")

privado = base / "privado"
privado.mkdir(mode=0o700, exist_ok=True)
archivo = base / ".env"
if not archivo.exists():
    valores = {k: secrets.token_hex(32) for k in (
        "CLB_SSO_CLAVE_POSTGRES", "CLB_IDENTIDAD_CLAVE_ADMINISTRADOR", "CLB_IDENTIDAD_SECRETO_N8N",
        "CLB_N8N_CLAVE_CIFRADO", "CLB_INVENTARIO_CLAVE_APLICACION", "CLB_IDENTIDAD_SECRETO_VENTAS",
        "CLB_IDENTIDAD_SECRETO_IA")}
    valores.update(CLB_IDENTIDAD_ADMINISTRADOR="clb-admin",
                   CLB_CLIENTES_URL="https://clientes.leonardoserrate.xyz")
    with os.fdopen(os.open(archivo, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as salida:
        salida.writelines(f"{k}={v}\n" for k, v in valores.items())
env = dict(linea.split("=", 1) for linea in archivo.read_text().splitlines() if linea and not linea.startswith("#"))
realm = json.loads((base.parent / "identidad/realm-clb.json").read_text(encoding="utf-8"))
for cliente in realm["clients"]:
    id_cliente = cliente["clientId"]
    if id_cliente == "clb-web":
        cliente.update(redirectUris=["https://store.leonardoserrate.xyz/*"],
                       webOrigins=["https://store.leonardoserrate.xyz"])
    elif id_cliente in ("clb-ventas", "clb-ia", "clb-n8n"):
        cliente["secret"] = env[f"CLB_IDENTIDAD_SECRETO_{id_cliente[4:].upper()}"]
(privado / "realm-clb.json").write_text(json.dumps(realm), encoding="utf-8")
cabeceras = (repo / "aplicaciones/web/infraestructura/cabeceras-seguridad.conf").read_text(encoding="utf-8")
(privado / "cabeceras-seguridad.conf").write_text(cabeceras.replace("http://127.0.0.1:18000", "https://auth.leonardoserrate.xyz"), encoding="utf-8")
nginx = (base.parent / "pasarela/nginx.conf").read_text(encoding="utf-8")
nginx = nginx.replace("http://ventas:8080", env.get("CLB_VENTAS_URL", "http://127.0.0.1:9"))
nginx = nginx.replace("http://clientes:3000", env["CLB_CLIENTES_URL"])
nginx = nginx.replace("http://ia:8000", env.get("CLB_IA_URL", "http://127.0.0.1:9"))
vton = env.get("CLB_VTON_URL", "http://127.0.0.1:9")
nginx = nginx.replace("http://ia-vton:8000", vton)
nginx = nginx.replace("proxy_connect_timeout 5s;", "proxy_connect_timeout 5s;\n        proxy_ssl_server_name on;\n        proxy_ssl_verify on;\n        proxy_ssl_verify_depth 3;\n        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;")
for destino in ("ventas", "clientes", "ia", "vton"):
    nginx = re.sub(r"(location[^{}]*\{[^{}]*?)(proxy_pass \$" + destino + r"\b)", r"\1proxy_set_header Host $proxy_host; \2", nginx)
if vton == "https://clb-vton.leonardoserrate.xyz":
    access_id = env.get("CLB_VTON_ACCESS_ID", "")
    access_secreto = env.get("CLB_VTON_ACCESS_SECRETO", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.access", access_id) or not re.fullmatch(r"[A-Za-z0-9_-]+", access_secreto):
        raise ValueError("Faltan credenciales válidas de Cloudflare Access para VTON.")
    # La ruta de trabajos contiene un `if OPTIONS { ... }`: el reemplazo genérico
    # de locations anterior no atraviesa esas llaves. Cubrir cada proxy_pass VTON.
    nginx = re.sub(r"(?:proxy_set_header Host \$proxy_host;\s*)?proxy_pass \$vton(?=[;$/])", (
        "proxy_set_header Host $proxy_host; "
        f'proxy_set_header CF-Access-Client-Id "{access_id}"; '
        f'proxy_set_header CF-Access-Client-Secret "{access_secreto}"; '
        "proxy_hide_header Set-Cookie; proxy_pass $vton"
    ), nginx)
    nginx = nginx.replace("location = /salud/probador {", (
        "location = /salud/probador { proxy_intercept_errors on; "
        "error_page 502 503 504 530 = @vton_no_disponible;"
    ))
    nginx = nginx.replace("proxy_read_timeout 30s;\n            proxy_intercept_errors on;",
                          "proxy_read_timeout 120s;\n            proxy_intercept_errors on;")
    nginx = nginx.replace("error_page 502 503 504 = @vton_no_disponible;",
                          "error_page 502 503 504 530 = @vton_no_disponible;")
(privado / "nginx.conf").write_text(nginx, encoding="utf-8")
