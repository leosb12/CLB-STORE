#!/bin/bash
set -euo pipefail
umask 077
cd /opt/clb/ia/actual
export CLB_VERSION=$(basename "$(readlink -f /opt/clb/ia/actual)")
temporal=$(mktemp /var/tmp/clb-analitica-XXXXXX.dump)
trap 'rm -f "$temporal"' EXIT
docker compose --env-file /etc/clb/ia.env exec -T postgres sh -c 'PGPASSWORD="$CLB_ANALITICA_CLAVE" pg_dump -h 127.0.0.1 -U clb_analitica -d clb_analitica -Fc' > "$temporal"
test -s "$temporal"
fecha=$(date -u +'%Y-%m-%d_%H-%M-%S-%3N_UTC')
objeto="RESPALDOS/ANALITICA/analitica-clb-store_${fecha}.dump"
huella=$(sha256sum "$temporal" | cut -d' ' -f1)
checksum=$(openssl dgst -sha256 -binary "$temporal" | base64 -w0)
aws s3api put-object --region us-east-2 --bucket clb-store-archivos-leonardoserrate --key "$objeto" --body "$temporal" --if-none-match '*' --checksum-sha256 "$checksum" --metadata "sha256=$huella,funcion=analitica" >/dev/null
real=$(aws s3api head-object --region us-east-2 --bucket clb-store-archivos-leonardoserrate --key "$objeto" --checksum-mode ENABLED --query ChecksumSHA256 --output text)
test "$real" = "$checksum"
printf '{"ruta_s3":"s3://clb-store-archivos-leonardoserrate/%s","sha256":"%s"}\n' "$objeto" "$huella" | tee -a /opt/clb/ia/respaldos.jsonl
