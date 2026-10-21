$ErrorActionPreference = 'Stop'
$versiónPhp = & php -r 'echo PHP_VERSION;'
if (-not $versiónPhp.StartsWith('8.4.')) {
    throw 'Este auxiliar local requiere PHP 8.4 para Windows x64. En otros entornos instale ext-mongodb mediante su gestor de PHP.'
}
$modo = if ((& php -r 'echo PHP_ZTS;') -eq '1') { 'ts' } else { 'nts' }
$carpeta = Join-Path $PSScriptRoot '.herramientas'
New-Item -ItemType Directory -Path $carpeta -Force | Out-Null
$versión = '2.5.5'
$publicación = Invoke-RestMethod "https://api.github.com/repos/mongodb/mongo-php-driver/releases/tags/$versión"
$nombre = "php_mongodb-$versión-8.4-$modo-vs17-x86_64.zip"
$archivo = $publicación.assets | Where-Object name -eq $nombre
if (-not $archivo) { throw 'No se encontró el driver oficial compatible.' }
$descarga = Join-Path $carpeta 'mongodb.zip'
Invoke-WebRequest $archivo.browser_download_url -OutFile $descarga
if ($archivo.digest -and ('sha256:' + (Get-FileHash $descarga -Algorithm SHA256).Hash.ToLowerInvariant()) -ne $archivo.digest) {
    throw 'La descarga no coincide con la huella SHA-256 del proveedor.'
}
$extracción = Join-Path $carpeta 'mongodb'
Expand-Archive $descarga -DestinationPath $extracción -Force
$biblioteca = Get-ChildItem $extracción -Filter '*.dll' | Select-Object -First 1
$destino = Join-Path $carpeta 'php_mongodb.dll'
if (-not (Test-Path -LiteralPath $destino) -or
    (Get-FileHash $biblioteca.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $destino -Algorithm SHA256).Hash) {
    Copy-Item -LiteralPath $biblioteca.FullName -Destination $destino -Force
}
[IO.File]::WriteAllText((Join-Path $carpeta 'mongodb.ini'), ('extension="' + $destino + '"'), [Text.UTF8Encoding]::new($false))
Write-Output 'Extensión MongoDB preparada. Utilice ejecutar-php.ps1 para cargarla sin modificar PHP globalmente.'
