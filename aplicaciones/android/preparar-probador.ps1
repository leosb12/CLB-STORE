# Copia el microfrontend React del probador (build) y BlazePose a assets/probador para la RA 3D sin red.
# Es un artefacto generado: no se versiona (.gitignore). Ejecutarlo antes de `flutter build` (preparar-movil.ps1 lo llama).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$probador = Join-Path $PSScriptRoot '..\probador-virtual'
$destino = Join-Path $PSScriptRoot 'assets\probador'

Push-Location $probador
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'El probador React no compiló.' }
    # Los pesos de BlazePose deben coincidir con sus hashes antes de empaquetarse.
    foreach ($linea in Get-Content 'modelos-blazepose.sha256') {
        $hash, $ruta = $linea -split '\s+', 2
        if ((Get-FileHash -LiteralPath "public/modelos/$ruta" -Algorithm SHA256).Hash -ne $hash.ToUpper()) {
            throw "Hash distinto: $ruta"
        }
    }
} finally {
    Pop-Location
}

if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $destino 'assets'), (Join-Path $destino 'prendas'), (Join-Path $destino 'modelos') | Out-Null
Copy-Item (Join-Path $probador 'dist\probador.js') $destino
Copy-Item (Join-Path $probador 'dist\assets\*') (Join-Path $destino 'assets')
# Solo la RA corre en la WebView: MoveNet y el segmentador web no se empaquetan (Android usa sus versiones TFLite).
Copy-Item (Join-Path $probador 'public\modelos\blazepose-3d') (Join-Path $destino 'modelos') -Recurse
# Modelo 3D y espalda de las prendas empaquetadas (la misma copia que publica la web).
Copy-Item (Join-Path $PSScriptRoot '..\web\public\prendas\*.modelo.json'), (Join-Path $PSScriptRoot '..\web\public\prendas\*.espalda.png') (Join-Path $destino 'prendas')
Write-Host "Probador listo en assets/probador ($([math]::Round((Get-ChildItem $destino -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)) MB)."
