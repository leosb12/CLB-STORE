param(
    [string]$Dispositivo = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invocar-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Argumentos)
    & adb -s $Dispositivo @Argumentos
    if ($LASTEXITCODE -ne 0) { throw "ADB falló: $($Argumentos[0])" }
}

Push-Location $PSScriptRoot
try {
    if (-not $Dispositivo) {
        $lista = (& adb devices) -join "`n"
        $conectados = @([regex]::Matches($lista, '(?m)^(\S+)\s+device\s*$') | ForEach-Object { $_.Groups[1].Value })
        if ($conectados.Count -ne 1) { throw 'Conecta y autoriza un solo teléfono o indica -Dispositivo <serial>.' }
        $Dispositivo = $conectados[0]
    }
    & (Join-Path $PSScriptRoot 'preparar-probador.ps1')
    $null = Invoke-RestMethod 'http://127.0.0.1:18000/api/v1/productos?l%C3%ADmite=1' -TimeoutSec 10
    & flutter build apk --debug --target lib/main.dart
    if ($LASTEXITCODE -ne 0) { throw 'La APK normal no compiló; no se instala otra APK.' }
    $apk = Join-Path $PSScriptRoot 'build/app/outputs/flutter-apk/app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'No se generó la APK normal.' }
    Invocar-Adb reverse tcp:18000 tcp:18000
    Invocar-Adb install -r $apk
    # La instalación/reconexión puede reiniciar el transporte: reponer el túnel al final.
    Invocar-Adb reverse tcp:18000 tcp:18000
    $ubicacion = ((Invocar-Adb shell pm path bo.clb.store) -join '').Trim().Replace('package:', '')
    if ($ubicacion -notmatch '^/data/app/[A-Za-z0-9_/~+=.-]+/base\.apk$') { throw 'Ruta inesperada de la APK instalada.' }
    $hashRemoto = ((Invocar-Adb shell sha256sum $ubicacion) -split '\s+')[0]
    if ($hashRemoto -ne (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash) { throw 'La APK instalada no coincide con la compilación.' }
    Invocar-Adb shell am start -n bo.clb.store/bo.clb.clb_store.MainActivity
    Write-Host 'APK normal verificada y conexión USB restablecida. Conserva el cable conectado para sincronizar.'
} finally {
    Pop-Location
}
