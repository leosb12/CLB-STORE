"""Caddy de IA: certificado público para IP y dominio, sin publicar MCP ni puertos internos."""
import argparse
import base64
import ipaddress
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from infraestructura.aws.ia.aprovisionar import salidas
from infraestructura.aws.desplegar import ejecutar_ssm


def configuracion(ip, dominio=True):
    ipaddress.IPv4Address(ip)
    comun = '''(clb_ia) {
    request_body {
        max_size 20MB
    }
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        Cache-Control no-store
        -Server
    }
    @interno path /mcp /mcp/* /openapi.json /docs /redoc
    respond @interno 404
    @origen header Origin https://leonardoserrate.xyz https://tienda.leonardoserrate.xyz
    header @origen {
        Access-Control-Allow-Origin {http.request.header.Origin}
        Vary Origin
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        Access-Control-Allow-Headers "Authorization, Content-Type, Idempotency-Key"
        Access-Control-Expose-Headers "Content-Disposition, X-Contenido-SHA256"
    }
    @preflight {
        method OPTIONS
        header Origin https://leonardoserrate.xyz https://tienda.leonardoserrate.xyz
    }
    respond @preflight 204
    handle / {
        redir /salud 302
    }
    handle_path /salud/probador {
        rewrite * /salud
        reverse_proxy 127.0.0.1:8001
    }
    handle /api/v1/probador/* {
        reverse_proxy 127.0.0.1:8001
    }
    handle {
        reverse_proxy 127.0.0.1:8000
    }
}
'''
    texto = '{\n    email playstsb@gmail.com\n    default_sni ' + ip + '\n}\n' + comun
    texto += f'''http://{ip} {{
    route {{
        @credenciales header Authorization *
        respond @credenciales "HTTPS requerido" 426
        handle /salud {{
            reverse_proxy 127.0.0.1:8000
        }}
        handle {{
            respond "HTTPS requerido" 426
        }}
    }}
}}
https://{ip} {{
    tls {{
        issuer acme {{
            dir https://acme-v02.api.letsencrypt.org/directory
            profile shortlived
        }}
    }}
    import clb_ia
}}
'''
    if dominio:
        texto += '\nia.leonardoserrate.xyz {\n    import clb_ia\n}\n'
    return texto


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--solo-ip', action='store_true')
    a = p.parse_args()
    r = salidas()
    if 'Instancia' not in r:
        raise SystemExit('AWS aún no creó la instancia GPU. DNS puede prepararse, pero no afirmar HTTPS operativo.')
    texto = base64.b64encode(configuracion(r['IpPublica'], not a.solo_ip).encode()).decode()
    ejecutar_ssm(r['Instancia'], ['set -eu', f"printf '%s' '{texto}' | base64 -d > /var/tmp/clb-ia.Caddyfile",
        'caddy validate --config /var/tmp/clb-ia.Caddyfile --adapter caddyfile',
        'install -m 644 /var/tmp/clb-ia.Caddyfile /etc/caddy/Caddyfile', 'systemctl reload caddy'], plazo=120)
    print('HTTPS de IA solicitado; comprobar el certificado antes de anunciar disponibilidad. No se modificó Clientes ni DNS.')


if __name__ == '__main__': main()
