param([string]$Servidor = 'Leonardo@35.208.191.124')
$ErrorActionPreference = 'Stop'
$repositorio = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$clave = Join-Path $env:USERPROFILE '.ssh/google_compute_engine'
$temporal = Join-Path ([IO.Path]::GetTempPath()) ('clb-gcp-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporal | Out-Null
Push-Location $repositorio
try {
    $rutas = @(
        'microservicios/inventario', 'aplicaciones/web', 'aplicaciones/probador-virtual',
        'infraestructura/automatizacion', 'infraestructura/pasarela',
        'infraestructura/identidad/realm-clb.json', 'infraestructura/bases-de-datos/compose.yaml'
    )
    $archivos = @(git -c core.quotepath=false ls-files -- $rutas)
    if ($LASTEXITCODE) { throw 'No se pudo enumerar el código.' }
    # Tablero BI: también los archivos aún no rastreados (respeta .gitignore: sin .venv ni cachés).
    $archivos += @(git -c core.quotepath=false ls-files --cached --others --exclude-standard -- 'aplicaciones/inteligencia-negocios')
    if ($LASTEXITCODE) { throw 'No se pudo enumerar el tablero BI.' }
    $archivos += @('infraestructura/gcp/preparar.py','infraestructura/gcp/Caddyfile','infraestructura/gcp/actualizar.sh','infraestructura/gcp/cliente-bi.sh')
    $archivos += 'microservicios/inventario/fuente/Adaptadores/Salida/ArchivosCompartidos.php'
    $archivos = $archivos | Sort-Object -Unique
    $archivos = $archivos | Where-Object { (Test-Path -LiteralPath $_ -PathType Leaf) -and $_ -notmatch '(^|/)\.env(\.|$)' }
    $lista = Join-Path $temporal 'archivos.txt'
    [IO.File]::WriteAllLines($lista, [string[]]$archivos, [Text.UTF8Encoding]::new($false))
    $paquete = Join-Path $temporal 'codigo.tar.gz'
    tar.exe -czf $paquete -T $lista
    if ($LASTEXITCODE) { throw 'No se pudo empaquetar el código.' }
    $nombreRemoto = [IO.Path]::GetFileName($temporal) + '.tar.gz'
    scp -i $clave $paquete "${Servidor}:$nombreRemoto"
    if ($LASTEXITCODE) { throw 'No se pudo enviar el código.' }
    $entrega = [IO.Path]::GetFileName($temporal)
    ssh -i $clave $Servidor "mkdir -m 700 -p ~/.clb-gcp && mkdir -p ~/.clb-gcp/entregas/$entrega && cd ~/.clb-gcp/entregas/$entrega && tar -xzf ~/$nombreRemoto && rm ~/$nombreRemoto && sed -i 's/\r$//' infraestructura/gcp/actualizar.sh && bash infraestructura/gcp/actualizar.sh"
    if ($LASTEXITCODE) { throw 'La actualización remota falló.' }
} finally {
    Pop-Location
    Remove-Item -LiteralPath (Join-Path $temporal 'archivos.txt'),(Join-Path $temporal 'codigo.tar.gz') -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporal -ErrorAction SilentlyContinue
}
