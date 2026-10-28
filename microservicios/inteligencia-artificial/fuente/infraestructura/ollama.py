"""LLM local con Ollama (qwen3:8b por defecto, `CLB_IA_MODELO`). Corre nativo en el host para usar la GPU."""
import httpx

from fuente.aplicacion.interfaces import ModeloNoDisponible


class ModeloOllama:
    def __init__(self, http: httpx.AsyncClient, url: str, modelo: str):
        self.http, self.url, self.modelo = http, f"{url}/api/chat", modelo

    async def _chat(self, cuerpo: dict) -> dict:
        cuerpo = {"model": self.modelo, "stream": False, "think": False, "keep_alive": "30m",
                  "options": {"temperature": 0}, **cuerpo}
        try:
            respuesta = await self.http.post(self.url, json=cuerpo, timeout=60)
        except httpx.HTTPError as error:
            raise ModeloNoDisponible(f"Ollama: {type(error).__name__}") from error
        if respuesta.status_code != 200:
            raise ModeloNoDisponible(f"Ollama respondió HTTP {respuesta.status_code}.")
        return respuesta.json()["message"]

    async def json(self, sistema: str, usuario: str, esquema: dict) -> str:
        # «format» con un esquema JSON: Ollama restringe la salida a esa forma (salida estructurada).
        mensaje = await self._chat({"format": esquema, "messages": [{"role": "system", "content": sistema},
                                                                     {"role": "user", "content": usuario}]})
        return mensaje.get("content", "")

    async def conversar(self, mensajes: list[dict], herramientas: list[dict]) -> dict:
        cuerpo = {"messages": mensajes}
        if herramientas:
            cuerpo["tools"] = [{"type": "function", "function": {"name": h["nombre"], "description": h["descripcion"],
                                                                 "parameters": h["esquema"]}} for h in herramientas]
        return await self._chat(cuerpo)

    async def disponible(self) -> bool:
        try:
            return (await self.http.get(self.url.replace("/api/chat", "/api/tags"), timeout=3)).status_code == 200
        except httpx.HTTPError:
            return False
