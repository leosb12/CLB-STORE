#!/usr/bin/env bash
# Crea o actualiza el cliente Keycloak clb-bi (tablero /bi/) en el Keycloak de esta VM. Idempotente.
# Usa el administrador y el secreto ya presentes en .env; no imprime claves y borra la sesión de kcadm al terminar.
set -euo pipefail
cd "$(dirname "$0")"
leer() { grep -m1 "^$1=" .env | cut -d= -f2-; }
compose=(sudo docker compose -f compose.generado.yaml)
kc() { "${compose[@]}" exec -T identidad /opt/keycloak/bin/kcadm.sh "$@"; }
trap '"${compose[@]}" exec -T identidad rm -f /opt/keycloak/.keycloak/kcadm.config >/dev/null 2>&1 || true' EXIT
kc config credentials --server http://127.0.0.1:8080/identidad --realm master \
    --user "$(leer CLB_IDENTIDAD_ADMINISTRADOR)" --password "$(leer CLB_IDENTIDAD_CLAVE_ADMINISTRADOR)" >/dev/null
ajustes=(-s 'name=CLB Store — tablero de inteligencia de negocios' -s enabled=true -s publicClient=false
         -s standardFlowEnabled=true -s directAccessGrantsEnabled=false -s serviceAccountsEnabled=false
         -s implicitFlowEnabled=false -s 'redirectUris=["https://store.leonardoserrate.xyz/bi/callback"]'
         -s 'attributes."pkce.code.challenge.method"=S256')
id=$(kc get clients -r clb -q clientId=clb-bi --fields id --format csv --noquotes | head -1 | tr -d '\r')
if [[ -z "$id" ]]; then
    kc create clients -r clb -s clientId=clb-bi "${ajustes[@]}" -s 'defaultClientScopes=["basic","clb-api","profile"]' >/dev/null
    id=$(kc get clients -r clb -q clientId=clb-bi --fields id --format csv --noquotes | head -1 | tr -d '\r')
else
    kc update "clients/$id" -r clb "${ajustes[@]}" >/dev/null
fi
kc update "clients/$id" -r clb -s "secret=$(leer CLB_IDENTIDAD_SECRETO_BI)" >/dev/null
echo "✓ cliente clb-bi listo"
