"""Configura HTTPS de Clientes por dominio e IP fija, sin modificar DNS."""
import argparse
import base64
import ipaddress
import json
from pathlib import Path

from desplegar import ejecutar_ssm, salidas


def configuracion(ip, dominio=None, tls_ip=True):
    ipaddress.IPv4Address(ip)
    if dominio and dominio != "clientes.leonardoserrate.xyz":
        raise ValueError("Solo se admite el dominio reservado para Clientes.")
    comun = """(clb_api) {
    @raiz path /
    redir @raiz /salud 302
    request_body {
        max_size 256KB
    }
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        Cache-Control no-store
        -Server
    }
    reverse_proxy 127.0.0.1:3000
}
"""
    error = '{"mensaje":"Las operaciones privadas requieren HTTPS o el canal cifrado de SSM.","código":"TRANSPORTE_SEGURO_REQUERIDO"}'
    texto = "{\n    email playstsb@gmail.com\n" + (f"    default_sni {ip}\n" if tls_ip else "") + "}\n" + comun + f"""
http://{ip} {{
    header Content-Type application/json
    header Cache-Control no-store
    header -Server
    route {{
        @credenciales header Authorization *
        respond @credenciales `{error}` 426
        handle /salud {{
            reverse_proxy 127.0.0.1:3000
        }}
        handle / {{
            redir /salud 302
        }}
        handle {{
            respond `{error}` 426
        }}
    }}
}}
"""
    if tls_ip:
        texto += f"""
https://{ip} {{
    tls {{
        issuer acme {{
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }}
    }}
    import clb_api
}}
"""
    if dominio:
        texto += f"\n{dominio} {{\n    import clb_api\n}}\n"
    return texto


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modo = parser.add_mutually_exclusive_group()
    modo.add_argument("--dominio", choices=["clientes.leonardoserrate.xyz"], default="clientes.leonardoserrate.xyz")
    modo.add_argument("--solo-ip", action="store_true", help="Retirar el host del dominio y conservar HTTPS por IP.")
    modo.add_argument("--solo-http", action="store_true", help="Mantener únicamente salud pública y bloquear operaciones privadas en HTTP.")
    args = parser.parse_args()
    recursos = salidas()
    dominio = None if args.solo_ip or args.solo_http else args.dominio
    texto = configuracion(recursos["IpPublica"], dominio, not args.solo_http)
    codificado = base64.b64encode(texto.encode("utf-8")).decode("ascii")
    ejecutar_ssm(recursos["Instancia"], ["set -eu", f"printf '%s' '{codificado}' | base64 -d > /var/tmp/clb.Caddyfile",
        "caddy validate --config /var/tmp/clb.Caddyfile --adapter caddyfile",
        "install -m 644 /var/tmp/clb.Caddyfile /etc/caddy/Caddyfile", "systemctl reload caddy"], plazo=120)
    locales = Path(__file__).parent / "datos-locales"
    locales.mkdir(exist_ok=True)
    (locales / "acceso-publico.json").write_text(json.dumps({"ip": recursos["IpPublica"], "dominio": dominio,
        "tls_ip_solicitado": not args.solo_http}, indent=2), encoding="utf-8")
    print("Pasarela aplicada. No se modificó DNS. Comprobar emisión del certificado antes de afirmar HTTPS.")


if __name__ == "__main__":
    main()
