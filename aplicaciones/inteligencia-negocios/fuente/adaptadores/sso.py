"""Inicio de sesión único con Keycloak (OIDC, código de autorización + PKCE S256) mediante Authlib.

Authlib valida `state` (atado a la cookie de sesión), `nonce`, la firma del id_token con el JWKS del realm, y aquí se
fijan explícitamente `iss` (emisor público), `aud` (este cliente) y `exp`. Ninguna comprobación se desactiva.

- El navegador va al endpoint de autorización PÚBLICO (la misma sesión de Keycloak que Gestión: sin repetir contraseña).
- El canje del código, la renovación y el JWKS van por la red interna (`identidad:8080`); el emisor esperado es el público.
- Los tokens viven en el servidor; la cookie (HttpOnly, SameSite=Lax) solo lleva un identificador aleatorio. Nunca hay
  tokens en la URL. El permiso de administrador lo decide IA en cada consulta (403 → «Se requiere rol administrador»).
"""
import os
import secrets
import threading
import time
from dataclasses import dataclass

import httpx
from authlib.integrations.flask_client import OAuth
from flask import Flask, Response, redirect, request, session

RENOVAR_ANTES = 30  # segundos


@dataclass(frozen=True)
class ConfiguracionSso:
    cliente: str
    secreto: str
    secreto_sesion: str
    identidad_publica: str  # p. ej. http://127.0.0.1:18000/identidad
    identidad_interna: str  # p. ej. http://identidad:8080/identidad
    origenes: tuple[str, ...]  # orígenes desde los que se puede abrir el tablero (lista blanca de redirect_uri)
    cookie_segura: bool = False

    @property
    def emisor(self) -> str:
        return f"{self.identidad_publica}/realms/clb"

    @classmethod
    def desde_entorno(cls) -> "ConfiguracionSso":
        def exigir(clave):
            valor = os.environ.get(clave, "")
            if not valor:
                raise RuntimeError(f"Defina {clave}.")
            return valor
        return cls(cliente=os.environ.get("CLB_BI_CLIENTE", "clb-bi"), secreto=exigir("CLB_IDENTIDAD_SECRETO_BI"),
                   secreto_sesion=exigir("CLB_BI_SECRETO_SESION"),
                   identidad_publica=os.environ.get("CLB_BI_IDENTIDAD_PUBLICA", "http://127.0.0.1:18000/identidad"),
                   identidad_interna=os.environ.get("CLB_BI_IDENTIDAD_INTERNA", "http://identidad:8080/identidad"),
                   origenes=tuple(o.strip().rstrip("/") for o in exigir("CLB_BI_ORIGENES").split(",") if o.strip()),
                   cookie_segura=os.environ.get("CLB_BI_COOKIE_SEGURA", "false").lower() == "true")


class _Almacen:
    """Diccionario con caducidad y candado. ponytail: memoria de UN proceso (gunicorn con 1 worker e hilos); para varios
    procesos, un almacén compartido (Redis). Un reinicio solo obliga a pasar otra vez por Keycloak (sin contraseña)."""

    def __init__(self):
        self._datos: dict[str, tuple[float, object]] = {}
        self._candado = threading.Lock()

    def get(self, clave):
        with self._candado:
            vence, valor = self._datos.get(clave, (0, None))
            return valor if vence > time.time() else None

    def set(self, clave, valor, expires=None):
        with self._candado:
            self._datos[clave] = (time.time() + (expires or 8 * 3600), valor)
            if len(self._datos) > 2000:  # purga perezosa de vencidos
                ahora = time.time()
                self._datos = {k: v for k, v in self._datos.items() if v[0] > ahora}

    def delete(self, clave):
        with self._candado:
            self._datos.pop(clave, None)


class Sso:
    def __init__(self, servidor: Flask, config: ConfiguracionSso, prefijo: str = "/bi/",
                 http: httpx.Client | None = None):
        self.config, self.prefijo = config, prefijo
        self.http = http or httpx.Client(timeout=10)
        self.tokens = _Almacen()
        servidor.secret_key = config.secreto_sesion
        servidor.config.update(SESSION_COOKIE_NAME="clb_bi_sesion", SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                               SESSION_COOKIE_SECURE=config.cookie_segura, SESSION_COOKIE_PATH=prefijo)
        oidc_publico = f"{config.identidad_publica}/realms/clb/protocol/openid-connect"
        self.oidc_interno = f"{config.identidad_interna}/realms/clb/protocol/openid-connect"
        # El estado temporal (state, nonce, code_verifier) queda en el servidor; la cookie solo marca que existe.
        self.oauth = OAuth(servidor, cache=_Almacen())
        self.keycloak = self.oauth.register(
            "keycloak", client_id=config.cliente, client_secret=config.secreto,
            authorize_url=f"{oidc_publico}/auth", access_token_url=f"{self.oidc_interno}/token",
            jwks_uri=f"{self.oidc_interno}/certs", issuer=config.emisor,
            id_token_signing_alg_values_supported=["RS256"],
            client_kwargs={"scope": "openid", "code_challenge_method": "S256",
                           "token_endpoint_auth_method": "client_secret_post"})
        servidor.add_url_rule(f"{prefijo}ingresar", "ingresar", self.ingresar)
        servidor.add_url_rule(f"{prefijo}callback", "callback", self.callback)
        servidor.add_url_rule(f"{prefijo}salir", "salir", self.salir)

    # ---- rutas -------------------------------------------------------------------------------------------------
    def origen(self) -> str | None:
        """Origen público de la petición, solo si está en la lista blanca (nunca se confía en Host a ciegas)."""
        esquema = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
        candidato = f"{esquema}://{request.headers.get('Host', '')}".rstrip("/")
        return candidato if candidato in self.config.origenes else None

    def ingresar(self):
        origen = self.origen()
        if not origen:
            return Response("Origen no permitido para el tablero.", 400, mimetype="text/plain")
        return self.keycloak.authorize_redirect(f"{origen}{self.prefijo}callback")

    def callback(self):
        try:
            token = self.keycloak.authorize_access_token(
                leeway=30, claims_options={"iss": {"essential": True, "value": self.config.emisor},
                                           "aud": {"essential": True, "value": self.config.cliente},
                                           "exp": {"essential": True}})
        except Exception:  # state/nonce/firma/emisor/audiencia/vencimiento inválidos o canje rechazado
            return _pagina("No se pudo iniciar sesión", "La respuesta de inicio de sesión no es válida o venció.",
                           self.prefijo, 401)
        if not token.get("userinfo"):  # sin id_token validado no hay sesión
            return _pagina("No se pudo iniciar sesión", "Keycloak no devolvió un id_token.", self.prefijo, 401)
        identificador = secrets.token_urlsafe(32)
        self.tokens.set(identificador, self._registro(token), 12 * 3600)
        session.clear()
        session["sid"] = identificador
        return redirect(self.prefijo)

    def salir(self):
        if session.get("sid"):
            self.tokens.delete(session["sid"])
        session.clear()
        return _pagina("Sesión del tablero cerrada", "Tu sesión de Gestión sigue abierta.", self.prefijo, 200)

    # ---- token vigente para llamar a IA -------------------------------------------------------------------------
    def autenticado(self) -> bool:
        return bool(session.get("sid") and self.tokens.get(session["sid"]))

    def token(self) -> str | None:
        """Access token vigente de esta sesión; lo renueva con el refresh token si está por vencer."""
        identificador = session.get("sid")
        registro = self.tokens.get(identificador) if identificador else None
        if not registro:
            return None
        if registro["vence"] - RENOVAR_ANTES > time.time():
            return registro["acceso"]
        try:
            respuesta = self.http.post(f"{self.oidc_interno}/token", data={
                "grant_type": "refresh_token", "refresh_token": registro["renovacion"],
                "client_id": self.config.cliente, "client_secret": self.config.secreto})
        except httpx.HTTPError:
            return None
        if respuesta.status_code != 200:
            self.tokens.delete(identificador)
            return None
        nuevo = self._registro(respuesta.json())
        self.tokens.set(identificador, nuevo, 12 * 3600)
        return nuevo["acceso"]

    @staticmethod
    def _registro(token: dict) -> dict:
        return {"acceso": token["access_token"], "renovacion": token.get("refresh_token"),
                "vence": time.time() + int(token.get("expires_in", 60))}


def _pagina(titulo: str, texto: str, prefijo: str, estado: int) -> Response:
    """Página mínima con los estilos del tablero (sin JavaScript): errores de acceso y cierre de sesión."""
    cuerpo = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" '
              f'content="width=device-width,initial-scale=1"><title>{titulo} · CLB Store</title>'
              f'<link rel="stylesheet" href="{prefijo}assets/clb.css"></head><body><main class="bi-mensaje">'
              f'<h1>{titulo}</h1><p>{texto}</p><p><a class="botón-principal" href="{prefijo}ingresar">Ingresar al tablero</a> '
              f'<a class="enlace" href="/gestion">Volver a Gestión</a></p></main></body></html>')
    return Response(cuerpo, estado, mimetype="text/html")


def ruta_permitida(ruta: str, prefijo: str) -> bool:
    """Rutas que no exigen sesión: el propio flujo de ingreso, la salud y los recursos estáticos de Dash."""
    libres = ("ingresar", "callback", "salir", "salud", "assets/", "_dash-component-suites/", "_favicon.ico")
    return any(ruta.startswith(prefijo + l) for l in libres)

