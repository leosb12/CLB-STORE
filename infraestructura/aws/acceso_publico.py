"""Comprobación pública con TLS estricto, incluso durante la propagación del DNS local."""
from contextlib import contextmanager
import http.client
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request


@contextmanager
def solicitar(base, ruta, cabeceras=None, ip=None):
    url = base.rstrip('/') + ruta
    solicitud = urllib.request.Request(url, headers=cabeceras or {})
    try:
        respuesta = urllib.request.urlopen(solicitud, timeout=20)
    except urllib.error.URLError as error:
        destino = urllib.parse.urlsplit(url)
        if not (isinstance(error.reason, socket.gaierror) and ip and destino.scheme == 'https'
                and destino.hostname == 'clientes.leonardoserrate.xyz'):
            raise
        # Solo la dirección de conexión cambia. Se conserva Host/SNI y se exige un
        # certificado público válido PARA EL DOMINIO, sin tocar DNS, hosts ni Chrome.
        print(f'DNS local aún sin propagar; verificando TLS de {destino.hostname} contra la IP fija {ip}.', flush=True)
        conexion = http.client.HTTPSConnection(destino.hostname, destino.port or 443, timeout=20)
        tcp = socket.create_connection((ip, destino.port or 443), timeout=20)
        try:
            conexion.sock = ssl.create_default_context().wrap_socket(tcp, server_hostname=destino.hostname)
            conexion.request('GET', urllib.parse.urlunsplit(('', '', destino.path or '/', destino.query, '')),
                             headers=cabeceras or {})
            respuesta = conexion.getresponse()
            if respuesta.status >= 400:
                raise urllib.error.HTTPError(url, respuesta.status, respuesta.reason, respuesta.headers, respuesta)
            yield respuesta
        finally:
            conexion.close()
            tcp.close()
    else:
        with respuesta:
            yield respuesta
