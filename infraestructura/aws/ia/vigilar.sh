#!/bin/bash
set -euo pipefail
cd /opt/clb/ia/actual
export CLB_VERSION=$(basename "$(readlink -f /opt/clb/ia/actual)")
for servicio in ia vton; do
  identificador=$(docker compose --env-file /etc/clb/ia.env ps -q "$servicio")
  if [ -n "$identificador" ] && [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$identificador")" = unhealthy ]; then
    logger -t clb-ia "Reiniciando servicio no saludable: $servicio"
    docker compose --env-file /etc/clb/ia.env restart "$servicio"
  fi
done
