# [PowerShell en el PC] Operación de la VM: iniciar, estado o desasignar (solo desasignada deja de cobrar cómputo).
param(
    [Parameter(Mandatory)][ValidateSet('iniciar', 'estado', 'desasignar')][string]$Accion,
    [string]$Suscripcion = '3655a98c-85a4-4c18-b443-032524c0f489',
    [string]$Nombre = 'clb-ventas'
)
$ErrorActionPreference = 'Stop'
function az-ok { az @args; if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') falló ($LASTEXITCODE)" } }
$Grupo = "$Nombre-rg"; $Vm = "$Nombre-vm"
$base = @('-g', $Grupo, '-n', $Vm, '--subscription', $Suscripcion)

switch ($Accion) {
    'iniciar' { az-ok vm start @base -o none }
    'desasignar' { az-ok vm deallocate @base -o none }
}
$vista = az vm get-instance-view @base -o json | Out-String | ConvertFrom-Json
"Estado: " + (($vista.instanceView.statuses | Where-Object { $_.code -like 'PowerState/*' }).code)
"IP: " + (az network public-ip show -g $Grupo -n "$Nombre-ip" --subscription $Suscripcion --query ipAddress -o tsv)
$apagado = az resource show -g $Grupo -n "shutdown-computevm-$Vm" --resource-type Microsoft.DevTestLab/schedules --subscription $Suscripcion --query properties -o json | Out-String | ConvertFrom-Json
"Autoapagado: $($apagado.status) a las $($apagado.dailyRecurrence.time) ($($apagado.timeZoneId))"