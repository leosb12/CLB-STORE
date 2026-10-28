# Aprovisionamiento completo en Windows. No modifica claves, servicios ni volúmenes de negocio.
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    python setup_weights.py
    if ($LASTEXITCODE -ne 0) { throw 'Falló la descarga o verificación de pesos.' }
    docker build -f Dockerfile.vton -t clb_ia_vton:local .
    if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción del worker.' }
    $pesosVton = (Resolve-Path ./weights).Path
    docker run --rm --network none --memory 4g --mount "type=bind,source=$pesosVton,target=/weights" --entrypoint python clb_ia_vton:local optimizar_weights.py
    if ($LASTEXITCODE -ne 0) { throw 'Falló la exportación local fp16.' }
    python setup_weights.py --verificar
    if ($LASTEXITCODE -ne 0) { throw 'Falló la verificación final.' }
} finally { Pop-Location }
