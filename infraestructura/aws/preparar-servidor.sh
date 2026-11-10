#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https jq unzip
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
# Node LTS 24 desde el distribuidor oficial, con hash del mismo distribuidor.
version=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v24.")) | select(.lts != false)][0].version')
test -n "$version"
cd /var/tmp
curl -fsSLO "https://nodejs.org/dist/$version/node-$version-linux-arm64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/$version/SHASUMS256.txt"
grep " node-$version-linux-arm64.tar.xz\$" SHASUMS256.txt | sha256sum --check -
tar -xJf "node-$version-linux-arm64.tar.xz" --strip-components=1 -C /usr/local
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o awscliv2.zip
unzip -q awscliv2.zip
./aws/install --update
id clb >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/clb --shell /usr/sbin/nologin clb
install -d -m 755 -o clb -g clb /opt/clb/clientes/versiones
install -d -m 750 -o root -g clb /etc/clb
# Logs acotados y persistentes sin servicio adicional con cargo.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=100M\nMaxRetentionSec=7day\n' > /etc/systemd/journald.conf.d/clb.conf
systemctl restart systemd-journald
cat > /etc/systemd/system/clb-clientes.service <<'SERVICIO'
[Unit]
Description=CLB Store - Clientes NestJS
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0
[Service]
Type=simple
User=clb
Group=clb
WorkingDirectory=/opt/clb/clientes/actual
EnvironmentFile=/etc/clb/clientes.env
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/local/bin/node dist/fuente/principal.js
Restart=always
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
MemoryMax=600M
UMask=0077
[Install]
WantedBy=multi-user.target
SERVICIO
cat > /etc/caddy/Caddyfile <<'CADDY'
# Arranque seguro sin dominio. configurar-acceso.py activa HTTPS para el dominio y la IP asignada.
:80 {
    header Content-Type application/json
    header Cache-Control no-store
    header -Server
    route {
        @credenciales header Authorization *
        respond @credenciales "HTTPS requerido" 426
        handle /salud {
            reverse_proxy 127.0.0.1:3000
        }
        handle {
            respond "HTTPS requerido" 426
        }
    }
}
CADDY
systemctl daemon-reload
systemctl enable caddy clb-clientes
systemctl restart caddy
touch /etc/clb/servidor-preparado
