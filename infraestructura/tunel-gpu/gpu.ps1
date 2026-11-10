# [PowerShell en el PC] Coordina la VRAM (8 GB) entre Ollama qwen3:8b y el worker CatVTON. Nunca borra datos.
#   ambos   : VTON residente (~3,2 GB) + qwen3:8b (~5,6 GB). Medido: pico 7,8/8,15 GB, sin OOM (margen ~300 MiB).
#   vton    : descarga qwen3:8b de la VRAM y deja solo el worker.
#   ollama  : detiene el worker (libera su VRAM; conserva volumen y trabajos) y precarga qwen3:8b.
#   detener : detiene el worker y descarga qwen3:8b. cloudflared y Ollama siguen como servicio/aplicación.
#   estado  : GPU, modelos cargados, worker, túnel.
param([Parameter(Mandatory)][ValidateSet('ambos', 'vton', 'ollama', 'detener', 'estado')][string]$Modo)
# Sin ErrorActionPreference=Stop: PowerShell 5.1 trataría el progreso que docker escribe en stderr como error.
# Los fallos reales se detectan con $LASTEXITCODE y el estado de salud.
$compose = @('compose', '-f', "$PSScriptRoot\compose.vton.yaml", '--env-file', "$PSScriptRoot\.env")

function Precargar-Qwen {
    # keep_alive 30m: sigue en VRAM durante la presentación sin quedar residente toda la noche.
    $cuerpo = @{ model = 'qwen3:8b'; prompt = ''; keep_alive = '30m' } | ConvertTo-Json
    Invoke-RestMethod http://127.0.0.1:11434/api/generate -Method Post -Body $cuerpo -ContentType 'application/json' -TimeoutSec 180 | Out-Null
}
function Iniciar-Vton {
    docker @compose up -d --no-build
    if ($LASTEXITCODE) { throw 'No se pudo iniciar el worker VTON.' }
    $inicio = Get-Date
    do { Start-Sleep 10; $salud = docker inspect clb_worker_vton_tunel --format '{{.State.Health.Status}}' }
    while ($salud -eq 'starting' -and ((Get-Date) - $inicio).TotalSeconds -lt 900)
    if ($salud -ne 'healthy') { throw "Worker VTON: $salud. Revise: docker logs clb_worker_vton_tunel" }
}

switch ($Modo) {
    'ambos'   { Iniciar-Vton; Precargar-Qwen }
    'vton'    { ollama stop qwen3:8b; Iniciar-Vton }
    'ollama'  { docker @compose stop vton; Precargar-Qwen }
    'detener' { docker @compose stop vton; ollama stop qwen3:8b }
}
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
ollama ps
docker ps -a --filter name=clb_worker_vton_tunel --format '{{.Names}} {{.Status}} {{.Ports}}'
(Get-Service cloudflared).Status
