param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgumentosPhp)

$ErrorActionPreference = 'Stop'
$carpeta = Join-Path $PSScriptRoot '.herramientas'
if (Test-Path -LiteralPath (Join-Path $carpeta 'mongodb.ini')) {
    $env:PHP_INI_SCAN_DIR = $carpeta
}
Push-Location $PSScriptRoot
try {
    & php @ArgumentosPhp
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
