"""Validación de tokens de Keycloak: firma (JWKS interno), emisor público y audiencia `clb-api`, como los demás servicios."""
import asyncio
from dataclasses import dataclass

import jwt


class TokenInvalido(Exception):
    pass


class IdentidadNoDisponible(Exception):
    pass


@dataclass(frozen=True)
class Usuario:
    sub: str
    roles: frozenset[str]
    token: str
    nombre: str = ""


class VerificadorTokens:
    def __init__(self, jwks: str, emisor: str, audiencia: str = "clb-api"):
        # PyJWKClient guarda las llaves en caché y vuelve a descargarlas si llega un «kid» desconocido.
        self.llaves = jwt.PyJWKClient(jwks, cache_keys=True, lifespan=3600, timeout=5)
        self.emisor, self.audiencia = emisor, audiencia

    def _verificar(self, token: str) -> Usuario:
        try:
            llave = self.llaves.get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError as error:
            raise IdentidadNoDisponible() from error
        except (jwt.PyJWKClientError, jwt.InvalidTokenError) as error:  # p. ej., un Bearer que no es un JWT
            raise TokenInvalido(str(error)) from error
        try:
            datos = jwt.decode(token, llave, algorithms=["RS256"], audience=self.audiencia, issuer=self.emisor,
                               options={"require": ["exp", "iss", "sub", "aud"]}, leeway=5)
        except jwt.InvalidTokenError as error:
            raise TokenInvalido(str(error)) from error
        roles = frozenset((datos.get("realm_access") or {}).get("roles") or [])
        return Usuario(datos["sub"], roles, token, datos.get("preferred_username", ""))

    async def verificar(self, token: str) -> Usuario:
        # En un hilo: la primera vez (o ante un «kid» nuevo) descarga el JWKS y no debe bloquear el bucle.
        return await asyncio.to_thread(self._verificar, token)
