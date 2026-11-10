#!/usr/bin/env bash
# [Bash EN LA VM] Ubuntu 24.04, una sola vez: Docker oficial, carpetas persistentes y diario del sistema acotado.
# Uso: bash ~/preparar-vm.sh && sudo reboot
set -euo pipefail

sudo apt-get update
sudo install -m 0755 -d /etc/apt/keyrings
# Docker Engine + Compose + Buildx desde el repositorio oficial de Docker.
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker
sudo usermod -aG docker "$USER"
# Limita el diario del sistema: el disco es de 32 GiB.
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' | sudo tee /etc/systemd/journald.conf.d/clb.conf >/dev/null

# Datos persistentes en el disco del sistema (nunca en /mnt, el disco temporal de Azure).
# /srv/clb/ventas: Compose y Caddyfile · /srv/clb/respaldos: pg_dump, solo el administrador.
sudo mkdir -p /srv/clb/ventas /srv/clb/respaldos
sudo chown -R "$USER" /srv/clb
chmod 700 /srv/clb/respaldos

echo "Listo. Reiniciar con: sudo reboot"
