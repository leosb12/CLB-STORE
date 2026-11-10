#!/bin/bash
# Ejecutado por SSM. Solo recibe paquetes propios comprobados por SHA-256.
set -euo pipefail
exec 9>/var/lock/clb-clientes-despliegue.lock
flock -n 9 || { echo 'Ya hay una actualización en curso.'; exit 1; }
base=/opt/clb/clientes
anterior=$(readlink -f "$base/actual" || true)
salud() {
  for intento in $(seq 1 30); do
    if curl --fail --silent --max-time 5 http://127.0.0.1:3000/salud | jq -e '.estado == "ACTIVO" and .dependencias.dynamodb == "ACTIVO"' >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
enlazar() {
  ln -sfn "$1" "$base/siguiente"
  mv -Tf "$base/siguiente" "$base/actual"
}
if [ "${CLB_VOLVER:-0}" = 1 ]; then
  destino=$(readlink -f "$base/anterior")
  test -d "$destino/dist/fuente"
  enlazar "$destino"
  systemctl restart clb-clientes
  if salud; then
    ln -sfn "$anterior" "$base/anterior"
    echo 'Versión anterior restaurada y saludable.'
    exit 0
  fi
  enlazar "$anterior"
  systemctl restart clb-clientes
  echo 'No se pudo restaurar; se repuso la versión inicial.'
  exit 1
fi
test -f /etc/clb/servidor-preparado
test -n "$CLB_PAQUETE_S3"
test -n "$CLB_SHA256"
test -n "$CLB_VERSION"
[[ "$CLB_VERSION" =~ ^clientes_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9-]+_UTC_[a-z]+$ ]]
carpeta="$base/versiones/$CLB_VERSION"
test ! -e "$carpeta"
paquete=$(mktemp /var/tmp/clb-clientes-XXXXXX.tar.gz)
trap 'rm -f "$paquete"' EXIT
aws s3 cp "$CLB_PAQUETE_S3" "$paquete" --region us-east-2 --only-show-errors
echo "$CLB_SHA256  $paquete" | sha256sum --check -
install -d -o clb -g clb -m 755 "$carpeta"
tar -xzf "$paquete" -C "$carpeta" --no-same-owner
chown -R clb:clb "$carpeta"
cd "$carpeta"
runuser -u clb -- /usr/local/bin/npm ci --omit=dev --no-audit --no-fund
if [ ! -f /etc/clb/clientes.env ]; then
  cat > /etc/clb/clientes.env <<'ENTORNO'
CLB_ENTORNO=produccion
CLB_CLIENTES_HOST=127.0.0.1
CLB_CLIENTES_PUERTO_INTERNO=3000
CLB_CLIENTES_TABLA=clb_fidelizacion
CLB_DYNAMODB_REGION=us-east-2
CLB_S3_BUCKET=clb-store-archivos-leonardoserrate
CLB_ARCHIVOS_TABLA=clb_archivos
CLB_CORS_ORIGENES=https://leonardoserrate.xyz,https://tienda.leonardoserrate.xyz
CLB_IDENTIDAD_EMISOR=https://auth.leonardoserrate.xyz/realms/clb
CLB_IDENTIDAD_JWKS=https://auth.leonardoserrate.xyz/realms/clb/protocol/openid-connect/certs
CLB_NOTIFICACIONES_HABILITADAS=false
CLB_NOTIFICACIONES_CORREO_HABILITADO=false
ENTORNO
  chown root:clb /etc/clb/clientes.env
  chmod 640 /etc/clb/clientes.env
fi
if [ "${CLB_PROBAR_RECUPERACION:-0}" = 1 ]; then
  test -d "$anterior/dist/fuente"
  printf 'throw new Error("Prueba controlada de recuperación CLB");\n' > dist/fuente/principal.js
fi
enlazar "$carpeta"
systemctl restart clb-clientes
if salud; then
  if [ -n "$anterior" ] && [ -d "$anterior" ]; then ln -sfn "$anterior" "$base/anterior"; fi
  echo "Versión instalada: $CLB_VERSION"
else
  if [ -n "$anterior" ] && [ -d "$anterior" ]; then
    enlazar "$anterior"
    systemctl restart clb-clientes
    salud || { echo 'La recuperación no logró restablecer la salud.'; exit 2; }
    echo 'Actualización rechazada; versión anterior recuperada y saludable.'
    if [ "${CLB_PROBAR_RECUPERACION:-0}" = 1 ]; then exit 0; fi
  fi
  exit 1
fi
