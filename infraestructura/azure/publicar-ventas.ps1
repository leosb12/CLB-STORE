# [PowerShell en el PC] Compila la imagen de Ventas y la carga en la VM junto con Compose y Caddyfile.
# No copia secretos: la configuración privada vive solo en la VM (/srv/clb/.env.ventas).
# Uso: .\publicar-ventas.ps1 -Ip <IP pública de la VM>
param([Parameter(Mandatory)][string]$Ip)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Ok($paso) { if ($LASTEXITCODE -ne 0) { throw "$paso falló ($LASTEXITCODE)" } }
$ssh = @('-i', "$HOME\.ssh\clb_azure", '-o', 'StrictHostKeyChecking=accept-new')
$destino = "clb@$Ip"
$tar = Join-Path $env:TEMP 'clb_ventas_azure.tar'

docker build -t clb_ventas:azure ..\..\microservicios\ventas; Ok 'docker build'
docker save -o $tar clb_ventas:azure; Ok 'docker save'
ssh @ssh $destino 'mkdir -p /srv/clb/ventas'; Ok 'ssh mkdir'
scp @ssh -C $tar compose.ventas.yaml Caddyfile.ventas .env.ventas.example "${destino}:/srv/clb/ventas/"; Ok 'scp'
ssh @ssh $destino 'docker load -i /srv/clb/ventas/clb_ventas_azure.tar && rm /srv/clb/ventas/clb_ventas_azure.tar'; Ok 'docker load'
Remove-Item $tar
'Imagen y archivos publicados. En la VM: cd /srv/clb/ventas && docker compose -f compose.ventas.yaml --env-file /srv/clb/.env.ventas up -d --no-build'