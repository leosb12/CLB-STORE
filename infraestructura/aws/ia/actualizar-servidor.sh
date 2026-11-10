#!/bin/bash
set -euo pipefail
exec 9>/var/lock/clb-ia-despliegue.lock
flock -n 9 || { echo 'Hay una actualización IA en curso.'; exit 1; }
test -f /etc/clb/ia-servidor-preparado
base=/opt/clb/ia
anterior=$(readlink -f "$base/actual" || true)
enlazar() { ln -sfn "$1" "$base/siguiente"; mv -Tf "$base/siguiente" "$base/actual"; }
salud() {
  for intento in $(seq 1 90); do
    if curl -fsS --max-time 8 http://127.0.0.1:8000/salud | jq -e '.estado == "ACTIVO" and .dependencias.ollama == "ACTIVO"' >/dev/null && curl -fsS --max-time 8 http://127.0.0.1:8001/salud | jq -e '.estado == "ACTIVO"' >/dev/null; then return 0; fi
    sleep 10
  done
  return 1
}
if [ "${CLB_VOLVER:-0}" = 1 ]; then
  destino=$(readlink -f "$base/anterior")
  test -f "$destino/compose.yaml"
  enlazar "$destino"
  bash "$base/actual/arrancar.sh"
  salud || { enlazar "$anterior"; bash "$base/actual/arrancar.sh"; exit 1; }
  ln -sfn "$anterior" "$base/anterior"
  echo 'Versión anterior de IA restaurada y saludable.'
  exit 0
fi
[[ "$CLB_VERSION" =~ ^ia_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9-]+_UTC_[a-z]+$ ]]
carpeta="$base/versiones/$CLB_VERSION"
test ! -e "$carpeta"
paquete=$(mktemp /var/tmp/clb-ia-XXXXXX.tar.gz)
trap 'rm -f "$paquete"' EXIT
aws s3 cp "$CLB_PAQUETE_S3" "$paquete" --region us-east-2 --only-show-errors
echo "$CLB_SHA256  $paquete" | sha256sum --check -
install -d -m 700 "$carpeta"
tar -xzf "$paquete" --no-same-owner -C "$carpeta"
cd "$carpeta"
chmod +x ./*.sh
export CLB_VERSION
componer() { docker compose --env-file /etc/clb/ia.env -f compose.yaml "$@"; }
componer config --quiet
componer build ia vton
# Fijar imágenes externas a su digest en el primer arranque; las actualizaciones no cambian PostgreSQL/Ollama.
if [ ! -e "$base/actual" ]; then
  componer pull postgres ollama
  for par in 'CLB_POSTGRES_IMAGEN postgres:16-bookworm' 'CLB_OLLAMA_IMAGEN ollama/ollama:latest'; do
    read -r clave imagen <<< "$par"
    digest=$(docker image inspect -f '{{index .RepoDigests 0}}' "$imagen")
    sed -i "s#^${clave}=.*#${clave}=${digest}#" /etc/clb/ia.env
  done
fi
install -d -m 700 /opt/clb/ia/datos/vton
chown 10001:10001 /opt/clb/ia/datos/vton
# Solo modelos públicos descargados y comprobados. No copiar fotos personales.
if [ ! -f /opt/clb/ia/modelos/prendas/u2net.onnx ]; then
  componer run --rm --no-deps --user 0 --entrypoint python -v /opt/clb/ia/modelos/prendas:/app/modelos-prendas ia preparar-modelo-prendas.py
fi
componer run --rm --no-deps -e HF_HUB_OFFLINE=0 --entrypoint python ia -m fuente.infraestructura.voz
if [ ! -f /opt/clb/ia/modelos/vton/manifiesto.json ]; then
  componer run --rm --no-deps --user 0 -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 -v /opt/clb/ia/modelos/vton:/weights --entrypoint python vton setup_weights.py
  componer run --rm --no-deps --user 0 -v /opt/clb/ia/modelos/vton:/weights --entrypoint python vton optimizar_weights.py
fi
componer run --rm --no-deps --entrypoint python vton setup_weights.py --verificar
enlazar "$carpeta"
componer up -d postgres ollama
componer exec -T ollama ollama pull qwen3:8b
componer up -d ia prendas
# Inferencia real de calentamiento; no alcanza con que /api/tags responda.
componer exec -T ia python -c 'import urllib.request,json; d={"model":"qwen3:8b","prompt":"Responde solamente LISTO.","think":False,"stream":False,"keep_alive":-1,"options":{"num_ctx":4096,"num_predict":16}}; r=json.load(urllib.request.urlopen(urllib.request.Request("http://ollama:11434/api/generate",data=json.dumps(d).encode(),headers={"Content-Type":"application/json"}),timeout=180)); assert r.get("response", "").strip() and r.get("eval_count",0)>0; print(json.dumps({"modelo":"qwen3:8b","inferencia_real":True,"tokens":r["eval_count"],"duracion_ns":r["total_duration"]}))'
componer up -d vton
if ! salud; then
  if [ -n "$anterior" ] && [ -f "$anterior/compose.yaml" ]; then
    enlazar "$anterior"
    bash "$base/actual/arrancar.sh"
    salud || { echo 'No se pudo recuperar la salud anterior de IA.'; exit 2; }
    echo 'Candidata IA rechazada; versión anterior restaurada.'
  fi
  exit 1
fi
if [ -n "$anterior" ] && [ -d "$anterior" ]; then ln -sfn "$anterior" "$base/anterior"; fi
cat > /etc/systemd/system/clb-ia.service <<'SERVICIO'
[Unit]
Description=CLB Store - Inteligencia Artificial
After=network-online.target docker.service
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash /opt/clb/ia/actual/arrancar.sh
Restart=on-failure
RestartSec=10
[Install]
WantedBy=multi-user.target
SERVICIO
for tarea in vigilar respaldar; do
  cat > "/etc/systemd/system/clb-ia-${tarea}.service" <<SERVICIO
[Unit]
Description=CLB IA - ${tarea}
After=docker.service clb-ia.service
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/clb/ia/actual/${tarea}.sh
SERVICIO
done
printf '[Unit]\nDescription=Vigilar salud IA\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1min\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/clb-ia-vigilar.timer
printf '[Unit]\nDescription=Respaldo diario IA\n[Timer]\nOnCalendar=daily\nPersistent=true\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/clb-ia-respaldar.timer
systemctl daemon-reload
systemctl enable clb-ia
systemctl enable --now clb-ia-vigilar.timer clb-ia-respaldar.timer
echo "IA instalada y saludable: $CLB_VERSION"
