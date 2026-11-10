"""Cliente del microservicio de IA: GraphQL de gestión (con el token del usuario) y el modelo de tallas público.

El tablero no abre bases de datos: todo sale de estos contratos existentes, por la pasarela.
"""
import httpx

INDICADORES = """query($d: Date, $h: Date, $c: String, $p: String) {
  indicadoresDemostracion(desde: $d, hasta: $h, categoria: $c, producto: $p) }"""
GENERAR_REPORTE = """mutation($e: JSON) { generarReporte(especificacion: $e) { identificador interpretacion } }"""


class SesionVencida(Exception):
    pass


class SinPermiso(Exception):
    pass


class DatosInvalidos(Exception):
    pass


class ServicioNoDisponible(Exception):
    pass


class ClienteIA:
    def __init__(self, base_url: str, http: httpx.Client | None = None):
        self.http = http or httpx.Client(base_url=base_url, timeout=httpx.Timeout(20, read=120))

    def _enviar(self, metodo: str, ruta: str, **kwargs) -> httpx.Response:
        try:
            respuesta = self.http.request(metodo, ruta, **kwargs)
        except httpx.HTTPError as error:
            raise ServicioNoDisponible("No se pudo contactar al servicio de IA.") from error
        if respuesta.status_code == 401:
            raise SesionVencida()
        if respuesta.status_code == 403:
            raise SinPermiso()
        if respuesta.status_code == 422:
            raise DatosInvalidos(respuesta.json().get("mensaje", "Datos inválidos."))
        if respuesta.status_code >= 500:
            raise ServicioNoDisponible(f"El servicio de IA respondió {respuesta.status_code}.")
        return respuesta

    def graphql(self, consulta: str, variables: dict, token: str) -> dict:
        cuerpo = self._enviar("POST", "/api/v1/graphql", json={"query": consulta, "variables": variables},
                              headers={"Authorization": f"Bearer {token}"}).json()
        if cuerpo.get("errors"):
            error = cuerpo["errors"][0]
            estado = (error.get("extensions") or {}).get("estado_http")
            if estado == 403:
                raise SinPermiso()
            if estado and estado >= 500:
                raise ServicioNoDisponible(error.get("message", "Error del servicio."))
            raise DatosInvalidos(error.get("message", "Consulta rechazada."))
        return cuerpo["data"]

    def indicadores(self, variables: dict, token: str) -> dict:
        return self.graphql(INDICADORES, variables, token)["indicadoresDemostracion"]

    def generar_reporte(self, especificacion: dict, token: str) -> dict:
        return self.graphql(GENERAR_REPORTE, {"e": especificacion}, token)["generarReporte"]

    def dataset_csv(self, nombre: str, token: str) -> tuple[bytes, str]:
        """CSV del dataset sintético (REST de IA, solo admin). Devuelve contenido y nombre de archivo sugerido."""
        respuesta = self._enviar("GET", f"/api/v1/demostracion/dataset/{nombre}.csv", headers={"Authorization": f"Bearer {token}"})
        if respuesta.status_code == 404:
            raise DatosInvalidos("El dataset de demostración no está generado.")
        disposicion = respuesta.headers.get("content-disposition", "")
        archivo = disposicion.split('filename="')[-1].rstrip('"') if 'filename="' in disposicion else f"clb-demostracion-{nombre}.csv"
        return respuesta.content, archivo

    def modelo_tallas(self) -> dict:
        return self._enviar("GET", "/api/v1/tallas/modelo").json()

    def recomendar_talla(self, medidas: dict) -> dict:
        return self._enviar("POST", "/api/v1/tallas/recomendacion", json=medidas).json()
