"""Soporte común: backend asíncrono de anyio y conexión real a clb_analitica en un esquema temporal."""
import asyncio
import os
import pathlib
import sys
import uuid

import pytest

ENV = pathlib.Path(__file__).resolve().parents[3] / "infraestructura" / "bases-de-datos" / ".env"


@pytest.fixture
def anyio_backend():
    # psycopg asíncrono no funciona con el bucle Proactor de Windows.
    opciones = {"loop_factory": asyncio.SelectorEventLoop} if sys.platform == "win32" else {}
    return "asyncio", opciones


def conexion_analitica() -> str | None:
    env = {}
    if ENV.exists():
        env = dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
    clave = os.environ.get("CLB_ANALITICA_CLAVE", env.get("CLB_ANALITICA_CLAVE"))
    if not clave:
        return None
    puerto = os.environ.get("CLB_ANALITICA_PUERTO", env.get("CLB_POSTGRES_PUERTO", "5432"))
    servidor = os.environ.get("CLB_ANALITICA_SERVIDOR", "127.0.0.1")
    return f"host={servidor} port={puerto} dbname=clb_analitica user=clb_analitica password={clave}"


@pytest.fixture
async def repositorio():
    from fuente.infraestructura.analitica import RepositorioPostgres
    conexion = conexion_analitica()
    if not conexion:
        pytest.skip("Sin CLB_ANALITICA_CLAVE: requiere clb_postgres con clb_analitica.")
    esquema = f"clb_prueba_{uuid.uuid4().hex[:12]}"
    repo = RepositorioPostgres(conexion, esquema)
    await repo.abrir()
    try:
        yield repo
    finally:
        async with repo.pool.connection() as c:
            await c.execute(f"drop schema {esquema} cascade")
        await repo.cerrar()
