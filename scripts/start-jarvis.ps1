# Starts Jarvis in project-isolation mode (read-only, loopback only, demo-vault only).
# Run from anywhere: powershell -File scripts\start-jarvis.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$app  = Join-Path $root 'vendor\jarvis'
$vault = Join-Path $root 'demo-vault'
$runDir = Join-Path $root '.local\run'

if (-not (Test-Path (Join-Path $app 'node_modules'))) {
  throw "Dependencies missing. Run: cd vendor\jarvis; npm ci --ignore-scripts"
}
if (-not (Test-Path $vault)) { throw "demo-vault not found at $vault" }
New-Item -ItemType Directory -Force $runDir | Out-Null

# Set before anything is launched so vite/tsx never fall back to ~\.jarvis-config.yaml
$env:JARVIS_PROJECT_MODE = '1'
$env:JARVIS_PROJECT_VAULT = $vault
# Ports are strict, so pick the first free pair (another Jarvis may already hold the defaults)
function Test-PortFree($p) { -not (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
$apiPort = $null; $uiPort = $null
foreach ($i in 0..9) {
  $a = 3102 + 10 * $i; $u = 5273 + 10 * $i
  if ((Test-PortFree $a) -and (Test-PortFree $u)) { $apiPort = $a; $uiPort = $u; break }
}
if (-not $apiPort) { throw 'No free API/UI port pair found.' }
$env:JARVIS_PROJECT_API_PORT = "$apiPort"
$env:JARVIS_PROJECT_UI_PORT = "$uiPort"
foreach ($n in 'JARVIS_PROJECT_MODE','JARVIS_PROJECT_VAULT','JARVIS_PROJECT_API_PORT','JARVIS_PROJECT_UI_PORT') {
  if (-not [Environment]::GetEnvironmentVariable($n, 'Process')) { throw "$n is not set; refusing to start." }
}

$tsx  = Join-Path $app 'node_modules\.bin\tsx.cmd'
$vite = Join-Path $app 'node_modules\.bin\vite.cmd'

$api = Start-Process -FilePath $tsx -ArgumentList 'server/index.ts' -WorkingDirectory $app -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runDir 'api.out.log') -RedirectStandardError (Join-Path $runDir 'api.err.log')
$ui = Start-Process -FilePath $vite -ArgumentList '--host','127.0.0.1' -WorkingDirectory $app -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runDir 'ui.out.log') -RedirectStandardError (Join-Path $runDir 'ui.err.log')

Set-Content -Path (Join-Path $runDir 'pids.txt') -Value @($api.Id, $ui.Id)
Write-Host "API pid $($api.Id): http://127.0.0.1:$apiPort   UI pid $($ui.Id): http://127.0.0.1:$uiPort"
Write-Host "Logs: $runDir   Stop with: Stop-Process -Id $($api.Id),$($ui.Id)"
