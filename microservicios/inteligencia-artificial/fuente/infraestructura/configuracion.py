"""Configuración por variables de entorno (desarrollo local y cloud se separan solo aquí)."""
import os
from dataclasses import dataclass, field

from psycopg.conninfo import make_conninfo


def _env(clave: str, defecto: str | None = None) -> str:
    valor = os.environ.get(clave, defecto)
    if valor is None or valor == "":
        raise RuntimeError(f"Defina {clave}.")
    return valor


@dataclass(frozen=True)
class Configuracion:
    analitica_servidor: str = field(default_factory=lambda: _env("CLB_ANALITICA_SERVIDOR", "127.0.0.1"))
    analitica_puerto: int = field(default_factory=lambda: int(_env("CLB_ANALITICA_PUERTO", "5432")))
    analitica_base: str = field(default_factory=lambda: _env("CLB_ANALITICA_BASE", "clb_analitica"))
    analitica_usuario: str = field(default_factory=lambda: _env("CLB_ANALITICA_USUARIO", "clb_analitica"))
    analitica_clave: str = field(default_factory=lambda: _env("CLB_ANALITICA_CLAVE"))
    analitica_esquema: str = field(default_factory=lambda: _env("CLB_ANALITICA_ESQUEMA", "public"))
    ventas_url: str = field(default_factory=lambda: _env("CLB_VENTAS_URL", "http://ventas:8080"))
    inventario_url: str = field(default_factory=lambda: _env("CLB_INVENTARIO_URL", "http://inventario:8000"))
    clientes_url: str = field(default_factory=lambda: _env("CLB_CLIENTES_URL", "http://clientes:3000"))
    identidad_emisor: str = field(default_factory=lambda: _env("CLB_IDENTIDAD_EMISOR"))
    identidad_interno: str = field(default_factory=lambda: _env("CLB_IDENTIDAD_INTERNO", "http://identidad:8080/identidad"))
    identidad_secreto: str = field(default_factory=lambda: _env("CLB_IDENTIDAD_SECRETO_IA"))
    ollama_url: str = field(default_factory=lambda: _env("CLB_IA_OLLAMA_URL", "http://host.docker.internal:11434"))
    # Opcionales: token de servicio de Cloudflare Access si Ollama está detrás de un túnel protegido.
    ollama_access_id: str = field(default_factory=lambda: os.environ.get("CLB_IA_OLLAMA_ACCESS_ID", ""))
    ollama_access_clave: str = field(default_factory=lambda: os.environ.get("CLB_IA_OLLAMA_ACCESS_CLAVE", ""), repr=False)
    modelo: str = field(default_factory=lambda: _env("CLB_IA_MODELO", "qwen3:8b"))
    modelo_voz: str = field(default_factory=lambda: _env("CLB_IA_MODELO_VOZ", "small"))
    directorio_modelos: str = field(default_factory=lambda: _env("CLB_IA_DIRECTORIO_MODELOS", "/modelos"))
    intervalo_ingesta: float = field(default_factory=lambda: float(_env("CLB_IA_INTERVALO_INGESTA", "20")))
    mcp_url: str = field(default_factory=lambda: _env("CLB_IA_MCP_URL", "http://127.0.0.1:8000/mcp/"))
    # Esquema del dataset sintético de inteligencia de negocios (demo_*); vacío = sin conjunto de demostración.
    bi_esquema: str = field(default_factory=lambda: os.environ.get("CLB_BI_ESQUEMA", "demo_bi"))

    @property
    def jwks(self) -> str:
        return f"{self.identidad_interno}/realms/clb/protocol/openid-connect/certs"

    @property
    def token_url(self) -> str:
        return f"{self.identidad_interno}/realms/clb/protocol/openid-connect/token"

    @property
    def conexion(self) -> str:
        # make_conninfo cita cada valor: una clave con espacios o «=» no rompe ni agrega parámetros.
        return make_conninfo(host=self.analitica_servidor, port=self.analitica_puerto, dbname=self.analitica_base,
                             user=self.analitica_usuario, password=self.analitica_clave, application_name="clb-ia")
