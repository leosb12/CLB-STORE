#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
estado="$HOME/.clb-gcp"
mkdir -m 700 -p "$estado"
exec 9> "$estado/actualizar.lock"
flock -n 9
anterior=$(readlink -f "$estado/activa" || true)
if [[ ! -f "$anterior/compose.generado.yaml" && -f "$HOME/clb-store/infraestructura/gcp/compose.generado.yaml" ]]; then
    anterior="$HOME/clb-store/infraestructura/gcp"
fi
if [[ ! -f .env && -f "$anterior/.env" ]]; then
    cp -p "$anterior/.env" .env
fi
python3 preparar.py
if [[ -f "$anterior/privado/operador.txt" && ! -f privado/operador.txt ]]; then
    cp -p "$anterior/privado/operador.txt" privado/operador.txt
fi
compose=(sudo docker compose -f compose.generado.yaml)
"${compose[@]}" config --quiet
imagenes=(clb_inventario clb_web clb_probador clb_bi)
anteriores=()
for imagen in "${imagenes[@]}"; do
    anteriores+=("$(sudo docker image inspect -f '{{.Id}}' "$imagen:gcp" 2>/dev/null || true)")
done
restaurar() {
    for i in "${!imagenes[@]}"; do
        if [[ -n "${anteriores[$i]}" ]]; then
            sudo docker tag "${anteriores[$i]}" "${imagenes[$i]}:gcp"
        fi
    done
}
if ! "${compose[@]}" --parallel 1 build inventario web probador bi; then
    restaurar
    exit 1
fi
servicios=(postgres-sso identidad pasarela web probador automatizacion borde bi)
if grep -q '^CLB_MONGO_URI=.' .env; then
    servicios+=(inventario)
fi
if ! "${compose[@]}" up -d --wait --wait-timeout 600 "${servicios[@]}"; then
    restaurar
    if [[ -f "$anterior/compose.generado.yaml" && -n "${anteriores[0]}" && -n "${anteriores[1]}" && -n "${anteriores[2]}" ]]; then
        (
            cd "$anterior"
            volver=(postgres-sso identidad pasarela web probador automatizacion borde)
            if grep -q '^CLB_MONGO_URI=.' .env; then
                volver+=(inventario)
            fi
            sudo docker compose -f compose.generado.yaml up -d --wait --wait-timeout 300 "${volver[@]}"
        )
    fi
    exit 1
fi
bash cliente-bi.sh
ln -sfn "$PWD" "$estado/activa"
"${compose[@]}" ps
