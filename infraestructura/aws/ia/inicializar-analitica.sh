#!/bin/bash
set -euo pipefail
# Solo se ejecuta al inicializar el volumen vacío. Clave por variable privada, nunca se imprime.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set clave="$CLB_ANALITICA_CLAVE" <<'SQL'
CREATE ROLE clb_analitica LOGIN PASSWORD :'clave' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE clb_analitica OWNER TO clb_analitica;
ALTER SCHEMA public OWNER TO clb_analitica;
REVOKE ALL ON DATABASE clb_analitica FROM PUBLIC;
GRANT CONNECT ON DATABASE clb_analitica TO clb_analitica;
SQL
