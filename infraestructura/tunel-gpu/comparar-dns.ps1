# [PowerShell en el PC] Compara lo que responden Namecheap (vigente) y la zona Cloudflare (preparada) para cada nombre.
# Antes del cambio de nameservers todo debe salir IGUAL, salvo clb-ollama y clb-vton (solo existen en Cloudflare).
# Después del cambio: .\comparar-dns.ps1 -Publico  (consulta 1.1.1.1 y 8.8.8.8 en lugar de los autoritativos).
# Agregar a -Nombres cualquier registro que aparezca en la exportación de Namecheap.
param(
    [string[]]$Nombres = @('@', 'www', 'api', 'auth', 'store', 'probador', 'ia', 'ventas', 'clientes', 'clb-ollama', 'clb-vton', '_dmarc'),
    [switch]$Publico
)
$dominio = 'leonardoserrate.xyz'
$servidores = if ($Publico) { @{ A = '1.1.1.1'; B = '8.8.8.8' } } else { @{ A = 'dns1.registrar-servers.com'; B = 'matt.ns.cloudflare.com' } }
function Respuesta($nombre, $tipo, $servidor) {
    try {
        (Resolve-DnsName $nombre -Type $tipo -Server $servidor -DnsOnly -ErrorAction Stop | Where-Object { $_.Section -eq 'Answer' -and $_.Type -eq $tipo } |
            ForEach-Object { "$($_.IPAddress)$($_.NameHost)$($_.NameExchange)$($_.Strings)" } | Sort-Object) -join ','
    } catch { '—' }
}
foreach ($n in $Nombres) {
    $fqdn = if ($n -eq '@') { $dominio } else { "$n.$dominio" }
    foreach ($tipo in 'A', 'CNAME', 'MX', 'TXT', 'CAA') {
        $a = Respuesta $fqdn $tipo $servidores.A; $b = Respuesta $fqdn $tipo $servidores.B
        if ($a -in '', '—' -and $b -in '', '—') { continue }
        # Los nombres con proxy de Cloudflare devuelven IP de Cloudflare, no el CNAME del túnel.
        $estado = if ($a -eq $b) { 'IGUAL' } else { 'DISTINTO' }
        '{0,-9} {1,-34} {2,-5} {3}={4} | {5}={6}' -f $estado, $fqdn, $tipo, $servidores.A, $a, $servidores.B, $b
    }
}
