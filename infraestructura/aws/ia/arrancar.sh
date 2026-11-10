#!/bin/bash
set -euo pipefail
cd /opt/clb/ia/actual
export CLB_VERSION=$(basename "$(readlink -f /opt/clb/ia/actual)")
exec docker compose --env-file /etc/clb/ia.env -f compose.yaml up -d
