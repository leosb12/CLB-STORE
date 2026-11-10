# [PowerShell en el PC] Crea (o completa) la VM de Ventas. Idempotente: reutiliza lo que ya existe.
# Recursos facturables: VM (por defecto Standard_B2als_v2), disco SO Standard SSD (32 GiB, E4), IP pública Standard estática.
# Primero: .\aprovisionar.ps1 -SoloComprobar   (cuota y restricciones del tamaño en la región; no crea nada)
param(
    [string]$Suscripcion = '3655a98c-85a4-4c18-b443-032524c0f489',
    [string]$Region = 'northcentralus',
    [string]$Nombre = 'clb-ventas',                # prefijo: <Nombre>-rg, -vm, -ip, -nsg, -vnet, -disco
    [string]$Tamano = 'Standard_B2als_v2',
    [int]$DiscoGb = 32,
    [string]$FamiliaCuota = 'Standard Basv2 Family vCPUs',
    [int]$VcpuNecesarias = 2,
    [string[]]$OrigenesHttps = @(),                # IP de salida (CIDR) de la pasarela GCP, IA y n8n; se suma la del administrador
    [switch]$SoloComprobar
)
$ErrorActionPreference = 'Stop'
function az-ok { az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') falló ($LASTEXITCODE)" } }
$Grupo = "$Nombre-rg"; $Vm = "$Nombre-vm"

$cuota = az vm list-usage -l $Region --subscription $Suscripcion -o json | Out-String | ConvertFrom-Json
$familia = $cuota | Where-Object { $_.localName -eq $FamiliaCuota }
$regional = $cuota | Where-Object { $_.localName -eq 'Total Regional vCPUs' }
"$FamiliaCuota en ${Region}: $($familia.currentValue)/$($familia.limit) · Total regional: $($regional.currentValue)/$($regional.limit)"
$restr = az vm list-skus -l $Region --size $Tamano --all --subscription $Suscripcion --query "[?name=='$Tamano'].restrictions[].reasonCode" -o tsv
"Restricciones de $Tamano en ${Region}: $(if ($restr) { $restr -join ', ' } else { 'ninguna' })"
if ($SoloComprobar) { return }
foreach ($c in $familia, $regional) {
    if (-not $c -or [int]$c.limit - [int]$c.currentValue -lt $VcpuNecesarias) { throw "Sin cuota suficiente en ${Region}: no se crea nada." }
}
if ($restr) { throw "$Tamano restringido en ${Region}: no se crea nada." }

$miIp = (Invoke-RestMethod 'https://api.ipify.org').Trim()
$origenes = @("$miIp/32") + $OrigenesHttps
$clave = Join-Path $HOME '.ssh\clb_azure'
if (-not (Test-Path "$clave.pub")) { ssh-keygen -t ed25519 -f $clave -N '""' -C clb-azure; if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen falló' } }

az-ok group create -n $Grupo -l $Region --subscription $Suscripcion --tags proyecto=clb-store componente=ventas curso=ingsoft2-g5 -o none
az-ok network nsg create -g $Grupo -n "$Nombre-nsg" --subscription $Suscripcion -o none
az-ok network nsg rule create -g $Grupo --nsg-name "$Nombre-nsg" -n ssh-admin --priority 100 --access Allow --protocol Tcp --direction Inbound --source-address-prefixes "$miIp/32" --destination-port-ranges 22 --subscription $Suscripcion -o none
az-ok network nsg rule create -g $Grupo --nsg-name "$Nombre-nsg" -n https-autorizado --priority 110 --access Allow --protocol Tcp --direction Inbound --source-address-prefixes $origenes --destination-port-ranges 443 --subscription $Suscripcion -o none
# 80 abierto a Internet: Let's Encrypt valida desde IP no publicadas. Caddy solo atiende el desafío ACME y redirige a 443.
az-ok network nsg rule create -g $Grupo --nsg-name "$Nombre-nsg" -n acme-http --priority 120 --access Allow --protocol Tcp --direction Inbound --source-address-prefixes Internet --destination-port-ranges 80 --subscription $Suscripcion -o none
az-ok network vnet create -g $Grupo -n "$Nombre-vnet" --address-prefixes 10.41.0.0/24 --subnet-name app --subnet-prefixes 10.41.0.0/26 --network-security-group "$Nombre-nsg" --subscription $Suscripcion -o none
az-ok network public-ip create -g $Grupo -n "$Nombre-ip" --sku Standard --allocation-method Static --version IPv4 --subscription $Suscripcion -o none

if (-not (az vm list -g $Grupo --subscription $Suscripcion --query "[?name=='$Vm'].id" -o tsv)) {
    az-ok vm create -g $Grupo -n $Vm --subscription $Suscripcion --size $Tamano `
        --image Canonical:ubuntu-24_04-lts:server:latest --security-type TrustedLaunch `
        --admin-username clb --ssh-key-values "$clave.pub" --authentication-type ssh `
        --os-disk-size-gb $DiscoGb --storage-sku StandardSSD_LRS --os-disk-name "$Nombre-disco" `
        --vnet-name "$Nombre-vnet" --subnet app --nsg '""' --public-ip-address "$Nombre-ip" -o none
}
# 23:00 America/La_Paz (UTC-4) = 03:00 UTC. Desasigna una vez al día; no impide encenderla después.
az-ok vm auto-shutdown -g $Grupo -n $Vm --time 0300 --subscription $Suscripcion -o none
az-ok resource show -g $Grupo -n "shutdown-computevm-$Vm" --resource-type Microsoft.DevTestLab/schedules --subscription $Suscripcion --query "{estado:properties.status,hora:properties.dailyRecurrence.time,zona:properties.timeZoneId}" -o table
"IP pública: " + (az network public-ip show -g $Grupo -n "$Nombre-ip" --subscription $Suscripcion --query ipAddress -o tsv)