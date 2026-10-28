#!/bin/sh
# Solo en un volumen vacío (lo ejecuta la imagen de PostgreSQL una vez): crea la base y el usuario del modelo de lectura
# de Inteligencia Artificial, igual que crear-analitica.py. La clave llega por variable de entorno, nunca en la línea SQL.
if [ -n "${CLB_ANALITICA_CLAVE:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv clave CLB_ANALITICA_CLAVE
SELECT format('CREATE ROLE clb_analitica LOGIN PASSWORD %L', :'clave') \gexec
CREATE DATABASE clb_analitica OWNER clb_analitica ENCODING 'UTF8';
REVOKE ALL ON DATABASE clb_analitica FROM PUBLIC;
REVOKE CONNECT ON DATABASE clb_ventas FROM PUBLIC;
SQL
else
  echo "CLB_ANALITICA_CLAVE vacía: no se crea clb_analitica (ejecutar crear-analitica.py luego)."
fi
