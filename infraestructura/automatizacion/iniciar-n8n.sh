#!/bin/sh
# Arranque de n8n en CLB Store: importa y publica los flujos versionados si aún no existen, y luego inicia n8n.
# Repetible. Con CLB_N8N_REIMPORTAR=true se reimportan (sus cursores vuelven a 0: los eventos se reprocesan y, como cada
# escritura es idempotente, no se duplica ninguna alerta ni comprobante).
set -eu
existentes=$(n8n list:workflow --onlyId 2>/dev/null || true)
for archivo in /clb/flujos/*.json; do
  id=$(basename "$archivo" .json)
  if [ "${CLB_N8N_REIMPORTAR:-false}" = "true" ] || ! printf "%s\n" "$existentes" | grep -qx "$id"; then
    n8n import:workflow --input="$archivo"
    n8n publish:workflow --id="$id"
  fi
done
exec n8n start
