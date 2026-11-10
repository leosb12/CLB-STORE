"""LLM local con Ollama (qwen3:8b por defecto, `CLB_IA_MODELO`). Corre nativo en el servidor para usar la GPU.

Es el modelo del servidor: web y Android lo usan a través de IA; no corre en el teléfono.
"""
import httpx

from fuente.aplicacion.interfaces import ModeloNoDisponible

# Una especificación de reporte cabe holgada en ~300 tokens; el tope evita esperas largas si el modelo divaga.
MAX_TOKENS_JSON = 700


class ModeloOllama:
    def __init__(self, http: httpx.AsyncClient, url: str, modelo: str, limite_segundos: float = 60,
                 residencia: str | int = '30m', contexto: int = 4096, cabeceras: dict | None = None):
        self.http, self.url, self.modelo, self.limite = http, f"{url}/api/chat", modelo, limite_segundos
        self.residencia, self.contexto = residencia, contexto
        # Token de servicio de Cloudflare Access cuando Ollama se publica por túnel; solo viaja a esta URL.
        self.cabeceras = cabeceras or {}

    async def _chat(self, cuerpo: dict, opciones: dict | None = None) -> dict:
        cuerpo = {"model": self.modelo, "stream": False, "think": False, "keep_alive": self.residencia,
                  "options": {"temperature": 0, "num_ctx": self.contexto, **(opciones or {})}, **cuerpo}
        try:
            respuesta = await self.http.post(self.url, json=cuerpo, headers=self.cabeceras, timeout=self.limite)
        except httpx.TimeoutException as error:
            raise ModeloNoDisponible(f"Ollama no respondió en {self.limite:.0f} s.", "TIMEOUT") from error
        except httpx.HTTPError as error:
            raise ModeloNoDisponible(f"Ollama: {type(error).__name__}", "DESCONECTADO") from error
        if respuesta.status_code != 200:
            raise ModeloNoDisponible(f"Ollama respondió HTTP {respuesta.status_code}.", "NO_DISPONIBLE")
        return respuesta.json()

    async def json(self, sistema: str, usuario: str, esquema: dict) -> str:
        # «format» con un esquema JSON: Ollama restringe la salida a esa forma (salida estructurada).
        r = await self._chat({"format": esquema, "messages": [{"role": "system", "content": sistema},
                                                              {"role": "user", "content": usuario}]},
                             {"num_predict": MAX_TOKENS_JSON})
        if r.get("done_reason") == "length":
            raise ModeloNoDisponible("La respuesta del modelo quedó cortada.", "INCOMPATIBLE")
        return r["message"].get("content", "")

    async def conversar(self, mensajes: list[dict], herramientas: list[dict]) -> dict:
        cuerpo = {"messages": mensajes}
        if herramientas:
            cuerpo["tools"] = [{"type": "function", "function": {"name": h["nombre"], "description": h["descripcion"],
                                                                 "parameters": h["esquema"]}} for h in herramientas]
        return (await self._chat(cuerpo))["message"]

    async def disponible(self) -> bool:
        try:
            return (await self.http.get(self.url.replace("/api/chat", "/api/tags"), headers=self.cabeceras, timeout=3)).status_code == 200
        except httpx.HTTPError:
            return False
