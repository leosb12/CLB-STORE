"""Clientes REST hacia Ventas, Inventario y Clientes por la red interna de Compose (nunca sus bases)."""
import asyncio
import time
from urllib.parse import quote

import httpx

from fuente.aplicacion.interfaces import CursorFueraDeRango, RechazoDeServicio, ServicioNoDisponible

LIMITE_EVENTOS = 100


class TokenDeServicio:
    """Client credentials del cliente `clb-ia` (rol servicio), en caché hasta poco antes de vencer."""

    def __init__(self, http: httpx.AsyncClient, url: str, secreto: str):
        self.http, self.url, self.secreto = http, url, secreto
        self._token, self._vence, self._cerrojo = None, 0.0, asyncio.Lock()

    async def obtener(self) -> str:
        if self._token and time.monotonic() < self._vence:
            return self._token
        async with self._cerrojo:
            if not self._token or time.monotonic() >= self._vence:
                respuesta = await self.http.post(self.url, data={"grant_type": "client_credentials", "client_id": "clb-ia",
                                                                 "client_secret": self.secreto})
                if respuesta.status_code != 200:
                    raise ServicioNoDisponible(f"Keycloak rechazó el token de servicio (HTTP {respuesta.status_code}).")
                datos = respuesta.json()
                self._token, self._vence = datos["access_token"], time.monotonic() + datos.get("expires_in", 60) - 30
            return self._token

    def descartar(self):
        self._token = None


async def _get(http: httpx.AsyncClient, url: str, token: str | None = None, **parametros) -> httpx.Response:
    try:
        return await http.get(url, params=parametros, headers={"Authorization": f"Bearer {token}"} if token else {})
    except httpx.HTTPError as error:
        # Sin la URL interna en el mensaje: llega al cliente.
        raise ServicioNoDisponible(f"sin respuesta ({type(error).__name__})") from error


def _comprobar(respuesta: httpx.Response) -> dict:
    if respuesta.status_code >= 400:
        try:
            cuerpo = respuesta.json()
        except ValueError:
            cuerpo = {}
        if respuesta.status_code >= 500:
            raise ServicioNoDisponible(cuerpo.get("mensaje", f"HTTP {respuesta.status_code}"))
        raise RechazoDeServicio(respuesta.status_code, cuerpo)
    return respuesta.json()


class EventosRest:
    """Registro de eventos interno de un servicio (`/api/v1/interno/eventos?desde=&límite=`) con token de servicio."""

    def __init__(self, http: httpx.AsyncClient, base: str, token: TokenDeServicio):
        self.http, self.url, self.token = http, f"{base}/api/v1/interno/eventos", token

    async def eventos(self, desde: int) -> tuple[list[dict], int]:
        for intento in range(2):
            respuesta = await _get(self.http, self.url, await self.token.obtener(), desde=desde, **{"límite": LIMITE_EVENTOS})
            if respuesta.status_code == 401 and intento == 0:
                self.token.descartar()
                continue
            if respuesta.status_code == 409:
                raise CursorFueraDeRango()
            datos = _comprobar(respuesta)
            return datos["eventos"], int(datos["siguiente"])
        raise ServicioNoDisponible("Token de servicio rechazado.")


class CatalogoInventario:
    """Copia de existencias desde el catálogo público de Inventario (productos y variantes activos)."""

    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http, self.base = http, base

    async def variantes(self) -> list[dict]:
        productos, pagina = [], 1
        while True:
            datos = _comprobar(await _get(self.http, f"{self.base}/api/v1/productos", **{"página": pagina, "límite": 100}))
            productos += datos["productos"]
            if pagina >= datos["paginación"]["páginas"]:
                break
            pagina += 1
        resultado = []
        # ponytail: una petición por producto; si el catálogo crece mucho, Inventario puede publicar variantes por lote.
        for producto in productos:
            datos = _comprobar(await _get(self.http, f"{self.base}/api/v1/productos/{producto['identificador']}/variantes"))
            for variante in datos["variantes"]:
                resultado.append({**variante, "nombre": producto["nombre"], "categoria": producto["categoría"]})
        return resultado


class InventarioRest:
    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http, self.base = http, base

    async def version(self, variante: str) -> int:
        return _comprobar(await _get(self.http, f"{self.base}/api/v1/variantes/{variante}"))["variante"]["versión_sincronización"]

    async def registrar_entrada(self, variante: str, cuerpo: dict, clave: str, token: str) -> dict:
        try:
            respuesta = await self.http.post(f"{self.base}/api/v1/variantes/{variante}/movimientos", json=cuerpo,
                                             headers={"Authorization": f"Bearer {token}", "Idempotency-Key": clave})
        except httpx.HTTPError as error:
            raise ServicioNoDisponible(f"Inventario sin respuesta ({type(error).__name__})") from error
        return _comprobar(respuesta)


class InventarioGestionRest:
    """Operaciones de gestión de Inventario (lista cerrada) sobre su API REST propietaria, por la red interna.

    Reenvía el JWT del administrador, la Idempotency-Key y el cuerpo tal cual (incluida `versión_esperada`): Inventario
    sigue autorizando, validando y deduplicando. Un 4xx vuelve como RechazoDeServicio con el cuerpo del propietario.
    """

    OPERACIONES = {
        "productos_admin": ("GET", "/productos/administracion"),
        "producto_admin": ("GET", "/productos/administracion/{producto}"),
        "crear_producto": ("POST", "/productos"),
        "modificar_producto": ("PUT", "/productos/{producto}"),
        "variantes_admin": ("GET", "/administracion/productos/{producto}/variantes"),
        "variante_admin": ("GET", "/administracion/variantes/{variante}"),
        "crear_variante": ("POST", "/productos/{producto}/variantes"),
        "modificar_variante": ("PUT", "/variantes/{variante}"),
        "registrar_movimiento": ("POST", "/variantes/{variante}/movimientos"),
        "fijar_minimo": ("PUT", "/variantes/{variante}/minimo"),
        "movimientos": ("GET", "/variantes/{variante}/movimientos"),
        "capacidades_ingesta": ("GET", "/administracion/recursos-probador/capacidades"),
        "trabajo_ingesta": ("GET", "/productos/{producto}/recursos-probador/{trabajo}"),
        "publicar_recurso": ("POST", "/productos/{producto}/recursos-probador/{trabajo}/publicar"),
    }

    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http, self.base = http, f"{base}/api/v1"

    async def ejecutar(self, operacion: str, token: str, *, ruta: dict | None = None, clave: str | None = None,
                       datos: dict | None = None, consulta: dict | None = None) -> dict:
        metodo, plantilla = self.OPERACIONES[operacion]
        url = self.base + plantilla.format(**{k: quote(str(v), safe="") for k, v in (ruta or {}).items()})
        cabeceras = {"Authorization": f"Bearer {token}", **({"Idempotency-Key": clave} if clave else {})}
        try:
            respuesta = await self.http.request(metodo, url, params=consulta, json=datos, headers=cabeceras)
        except httpx.HTTPError as error:
            raise ServicioNoDisponible(f"Inventario sin respuesta ({type(error).__name__})") from error
        return _comprobar(respuesta)


class PerfilesRest:
    def __init__(self, http: httpx.AsyncClient, base: str):
        self.http, self.base = http, base

    async def medidas(self, token: str) -> dict:
        return _comprobar(await _get(self.http, f"{self.base}/api/v1/perfiles/yo", token))["perfil"].get("medidas", {})


class DirectorioClientesRest:
    """`POST /api/v1/interno/clientes/nombres` de Clientes con el token de servicio de IA."""

    def __init__(self, http: httpx.AsyncClient, base: str, token: TokenDeServicio):
        self.http, self.url, self.token = http, f"{base}/api/v1/interno/clientes/nombres", token

    async def nombres(self, clientes: list[str]) -> list[dict]:
        uuids = [c for c in clientes if len(c) == 36]  # Clientes solo acepta UUID v4; otros identificadores quedan sin nombre
        if not uuids:
            return []
        try:
            respuesta = await self.http.post(self.url, json={"clientes": uuids},
                                             headers={"Authorization": f"Bearer {await self.token.obtener()}"})
        except httpx.HTTPError as error:
            raise ServicioNoDisponible(f"sin respuesta ({type(error).__name__})") from error
        if respuesta.status_code == 401:
            self.token.descartar()
        return _comprobar(respuesta)["clientes"]

