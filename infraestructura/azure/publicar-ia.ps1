# [PowerShell en el PC] Compila las imágenes de IA (backend y worker_prendas) y las carga en la VM de Ventas, con el
# modelo U²-Net verificado por SHA-256 y los archivos de Compose/Caddy. No copia secretos ni bases locales.
# Uso: .\publicar-ia.ps1 -Ip <IP pública de la VM>
param([Parameter(Mandatory)][string]$Ip)
Set-Location $PSScriptRoot
function Ok($paso) { if ($LASTEXITCODE -ne 0) { throw "$paso falló ($LASTEXITCODE)" } }
$ssh = @('-i', "$HOME\.ssh\clb_azure", '-o', 'StrictHostKeyChecking=accept-new')
$destino = "clb@$Ip"
$ia = '..\..\microservicios\inteligencia-artificial'
$tar = Join-Path $env:TEMP 'clb_ia_azure.tar'
$u2net = "$ia\modelos-prendas\u2net.onnx"
$sha = '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'   # mismo valor que worker_prendas.py

if ((Get-FileHash $u2net).Hash.ToLower() -ne $sha) { throw 'u2net.onnx no coincide con el SHA-256 esperado.' }
docker build -t clb_ia:azure $ia; Ok 'docker build ia'
docker build -t clb_ia_prendas:azure -f "$ia\Dockerfile.prendas" $ia; Ok 'docker build prendas'
docker save -o $tar clb_ia:azure clb_ia_prendas:azure; Ok 'docker save'
ssh @ssh $destino 'mkdir -p /srv/clb/ventas /srv/clb/modelos-prendas'; Ok 'ssh mkdir'
scp @ssh -C $tar compose.ventas.yaml Caddyfile.ventas .env.ventas.example "${destino}:/srv/clb/ventas/"; Ok 'scp'
scp @ssh $u2net "${destino}:/srv/clb/modelos-prendas/u2net.onnx"; Ok 'scp modelo'
ssh @ssh $destino "echo '$sha  /srv/clb/modelos-prendas/u2net.onnx' | sha256sum -c - && docker load -i /srv/clb/ventas/clb_ia_azure.tar && rm /srv/clb/ventas/clb_ia_azure.tar"; Ok 'docker load'
Remove-Item $tar
'Publicado. En la VM: cd /srv/clb/ventas && docker compose -f compose.ventas.yaml --env-file /srv/clb/.env.ventas up -d --no-build  (IA y prendas: añadir --profile ia cuando estén los datos de Keycloak)'
