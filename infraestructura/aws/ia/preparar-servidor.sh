#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl jq unzip gnupg docker.io docker-compose-v2 openssl
systemctl enable --now docker
if ! command -v aws >/dev/null; then
  cd /var/tmp
  curl --retry 4 -fSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o clb-aws.zip
  unzip -q clb-aws.zip -d clb-aws
  ./clb-aws/aws/install
fi
if ! command -v nvidia-ctk >/dev/null; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update
  apt-get install -y nvidia-container-toolkit
fi
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker
# La AMI oficial Deep Learning ya incluye el controlador NVIDIA; no reemplazarlo a ciegas.
nvidia-smi
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
install -d -m 700 /etc/clb /opt/clb/ia/versiones /opt/clb/ia/datos /opt/clb/ia/modelos/voz /opt/clb/ia/modelos/prendas /opt/clb/ia/modelos/vton
chmod 755 /opt/clb/ia/modelos /opt/clb/ia/modelos/voz /opt/clb/ia/modelos/prendas /opt/clb/ia/modelos/vton
chown 10001:10001 /opt/clb/ia/modelos/voz
if [ ! -f /etc/clb/ia.env ]; then
  umask 077
  cat > /etc/clb/ia.env <<ENTORNO
CLB_ANALITICA_SERVIDOR=postgres
CLB_ANALITICA_PUERTO=5432
CLB_ANALITICA_BASE=clb_analitica
CLB_ANALITICA_USUARIO=clb_analitica
CLB_ANALITICA_CLAVE=$(openssl rand -hex 32)
CLB_IDENTIDAD_EMISOR=https://auth.leonardoserrate.xyz/realms/clb
CLB_IDENTIDAD_INTERNO=https://auth.leonardoserrate.xyz
CLB_IDENTIDAD_SECRETO_IA=$(openssl rand -hex 32)
CLB_CLIENTES_URL=https://clientes.leonardoserrate.xyz
CLB_INVENTARIO_URL=https://inventario.leonardoserrate.xyz
CLB_VENTAS_URL=https://ventas.leonardoserrate.xyz
CLB_IA_INTERVALO_INGESTA=0
CLB_IA_OLLAMA_URL=http://ollama:11434
CLB_IA_MODELO=qwen3:8b
CLB_IA_MODELO_RESIDENCIA=-1
CLB_IA_MODELO_CONTEXTO=4096
CLB_IA_MODELO_VOZ=small
CLB_POSTGRES_IMAGEN=postgres:16-bookworm
CLB_OLLAMA_IMAGEN=ollama/ollama:latest
CLB_PRENDAS_INTERVALO=3
ENTORNO
  clave_db=$(sed -n 's/^CLB_ANALITICA_CLAVE=//p' /etc/clb/ia.env)
  printf 'POSTGRES_DB=clb_analitica\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=%s\nCLB_ANALITICA_CLAVE=%s\n' "$(openssl rand -hex 32)" "$clave_db" > /etc/clb/ia-postgres.env
  chmod 600 /etc/clb/ia.env /etc/clb/ia-postgres.env
fi
# Swap protege el host ante picos de carga de checkpoints; no aumenta VRAM ni reemplaza RAM de inferencia.
if [ ! -f /swap-clb-ia ]; then
  fallocate -l 2G /swap-clb-ia
  chmod 600 /swap-clb-ia
  mkswap /swap-clb-ia
  swapon /swap-clb-ia
  printf '/swap-clb-ia none swap sw 0 0\n' >> /etc/fstab
fi
mkdir -p /etc/docker
# Conservar cualquier configuración del runtime NVIDIA añadida por nvidia-ctk.
jq '. + {"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' /etc/docker/daemon.json > /var/tmp/clb-docker.json
install -m 644 /var/tmp/clb-docker.json /etc/docker/daemon.json
systemctl restart docker
cat > /etc/caddy/Caddyfile <<'CADDY'
:80 {
    handle /salud {
        reverse_proxy 127.0.0.1:8000
    }
    handle {
        respond "HTTPS requerido" 426
    }
}
CADDY
systemctl enable --now caddy
touch /etc/clb/ia-servidor-preparado
