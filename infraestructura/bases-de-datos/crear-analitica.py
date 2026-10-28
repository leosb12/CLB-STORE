"""Crea (o actualiza) la base privada clb_analitica y su usuario en clb_postgres. Es repetible y no borra datos.

La base es propiedad del microservicio de Inteligencia Artificial: es su modelo de lectura (CQRS, D3) para reportes
frecuentes cuyos datos vienen de varios microservicios. Ventas sigue sin compartir su base `clb_ventas`.

Uso (con clb_postgres saludable):  python crear-analitica.py
Toma las claves del .env local; nunca las imprime. Las tablas las crea el propio servicio con sus migraciones.
"""
import os
import pathlib
import subprocess
import sys

ENV = pathlib.Path(__file__).resolve().parent / ".env"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    env = dict(l.split("=", 1) for l in ENV.read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
    for clave in ("CLB_POSTGRES_USUARIO", "CLB_ANALITICA_CLAVE"):
        if not env.get(clave):
            raise SystemExit(f"Defina {clave} en {ENV}")
    # La clave viaja por variable de entorno (\getenv): no aparece en argv ni en la línea SQL, y queda citada con %L.
    sql = r"""
\getenv clave CLB_ANALITICA_CLAVE
SELECT format('CREATE ROLE clb_analitica LOGIN PASSWORD %L', :'clave') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clb_analitica') \gexec
SELECT format('ALTER ROLE clb_analitica LOGIN PASSWORD %L', :'clave') \gexec
SELECT 'CREATE DATABASE clb_analitica OWNER clb_analitica ENCODING ''UTF8''' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'clb_analitica') \gexec
REVOKE ALL ON DATABASE clb_analitica FROM PUBLIC;
-- Por defecto PUBLIC puede conectarse a cualquier base: se revoca para que cada servicio entre solo a la suya.
REVOKE CONNECT ON DATABASE clb_ventas FROM PUBLIC;
"""
    resultado = subprocess.run(
        ["docker", "exec", "-i", "-e", "CLB_ANALITICA_CLAVE", "clb_postgres", "psql", "-v", "ON_ERROR_STOP=1",
         "-U", env["CLB_POSTGRES_USUARIO"], "-d", "clb_ventas", "-q"],
        input=sql, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "CLB_ANALITICA_CLAVE": env["CLB_ANALITICA_CLAVE"]})
    if resultado.returncode != 0:
        raise SystemExit("No se pudo preparar clb_analitica: " + resultado.stderr.strip()[:300])
    print("  ✓ base clb_analitica y usuario clb_analitica listos (sin acceso a clb_ventas)")


if __name__ == "__main__":
    main()
