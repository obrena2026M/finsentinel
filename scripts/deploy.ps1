<#
.SYNOPSIS
  Deploys a FinSentinel release to a Windows host (STAGE05 DEP-08..DEP-11).

.DESCRIPTION
  Immutable-release deployment for the "Windows host via self-hosted GitHub runner" profile.
  Runs from GitHub Actions (self-hosted runner) or by hand. Layout under -InstallDir:

    shared\.env            environment-specific configuration (created once, never overwritten)
    shared\data\           SQLite database, uploads, backups (survive releases)
    shared\logs\           server stdout/stderr per release
    releases\<ref>-<ts>\   one directory per deployed release (git clone + npm ci + web build)
    current                junction to the active release
    previous.txt           path of the release before the current one (rollback target)

  Steps: preflight -> clone ref -> npm ci -> build -> backup database -> stop app ->
  switch 'current' -> start app (Task Scheduler) -> smoke test -> on failure: rollback
  (previous release + pre-deploy backup) and exit 1. Migrations run at application start
  (idempotent, Architecture §16); the pre-deploy backup is the recovery point.

.PARAMETER Environment   staging | production. Selects the task name and default .env profile.
.PARAMETER Ref           Git tag or branch to deploy (e.g. v0.1.0).
.PARAMETER Repo          Git URL or local path to clone from. Default: the repository containing this script.
.PARAMETER InstallDir    Root of the installation. Default: C:\finsentinel\<Environment>.
.PARAMETER Port          Port written to a newly created shared\.env. Default 3000 (production) / 3001 (staging).
.PARAMETER Rollback      Switch 'current' back to previous.txt and restart (no clone). Add -RestoreDb to also
                         restore the latest backup.
.PARAMETER RestoreDb     With -Rollback: restore the most recent backup before restarting.
.PARAMETER Status        Print current release, task state and health, then exit.
.PARAMETER KeepReleases  Number of release directories to keep. Default 3.

.EXAMPLE
  .\scripts\deploy.ps1 -Environment staging -Ref v0.1.0
  .\scripts\deploy.ps1 -Environment production -Ref v0.1.0 -Repo https://github.com/<owner>/finsentinel.git
  .\scripts\deploy.ps1 -Environment production -Rollback -RestoreDb
  .\scripts\deploy.ps1 -Environment production -Status
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('staging', 'production')][string]$Environment,
    [string]$Ref = '',
    [string]$Repo = '',
    [string]$InstallDir = '',
    [int]$Port = 0,
    [switch]$Rollback,
    [switch]$RestoreDb,
    [switch]$Status,
    [int]$KeepReleases = 3
)

$ErrorActionPreference = 'Stop'
trap { Write-Host ""; Write-Host ("FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red; exit 1 }
$script:StepNo = 0
function Write-Step([string]$Text) { $script:StepNo++; Write-Host ""; Write-Host ("[{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host ("    OK   {0}" -f $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ("    ..   {0}" -f $Text) -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host ("    WARN {0}" -f $Text) -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host ""; Write-Host ("FAILED: {0}" -f $Text) -ForegroundColor Red; exit 1 }

function Invoke-Native([string]$Label, [string]$Exe, [string[]]$Arguments, [string]$WorkDir) {
    Write-Info ("{0} {1}" -f (Split-Path -Leaf $Exe), ($Arguments -join ' '))
    Push-Location $WorkDir
    try { & $Exe @Arguments; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { throw ("{0} exited with code {1}" -f $Label, $code) }
}
function Resolve-Tool([string]$Name) { $c = Get-Command $Name -ErrorAction SilentlyContinue; if ($null -eq $c) { return $null }; return $c.Source }
function New-Secret([int]$Length) {
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $bytes) { [void]$sb.Append($alphabet[$b % $alphabet.Length]) }
    return $sb.ToString()
}
function Read-EnvValue([string]$Path, [string]$Key) {
    $line = Get-Content $Path | Where-Object { $_ -match ("^{0}=(.*)$" -f [regex]::Escape($Key)) } | Select-Object -First 1
    if ($line) { return ($line -replace ("^{0}=" -f [regex]::Escape($Key)), '').Trim() }
    return $null
}

# ---------------------------------------------------------------------------
# Resolve paths and names
# ---------------------------------------------------------------------------
$ScriptRepo = Split-Path -Parent $PSScriptRoot
if (-not $Repo) { $Repo = $ScriptRepo }
if (-not $InstallDir) { $InstallDir = Join-Path 'C:\finsentinel' $Environment }
if ($Port -eq 0) { $Port = if ($Environment -eq 'production') { 3000 } else { 3001 } }
$TaskName   = "FinSentinel-$Environment"
$SharedDir  = Join-Path $InstallDir 'shared'
$DataDir    = Join-Path $SharedDir 'data'
$LogDir     = Join-Path $SharedDir 'logs'
$ReleasesDir = Join-Path $InstallDir 'releases'
$CurrentLink = Join-Path $InstallDir 'current'
$PreviousFile = Join-Path $InstallDir 'previous.txt'
$SharedEnv  = Join-Path $SharedDir '.env'

$nodeExe = Resolve-Tool 'node'
$npmCmd  = Resolve-Tool 'npm'
$gitExe  = Resolve-Tool 'git'

function Get-CurrentRelease {
    if (Test-Path $CurrentLink) { return (Get-Item $CurrentLink).Target | Select-Object -First 1 }
    return $null
}
function Get-AppProcesses {
    # node.exe processes started from this installation (any release directory under InstallDir).
    $esc = [regex]::Escape($InstallDir)
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -match $esc) }
}
function Stop-App {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName; Write-Info "scheduled task stopped" }
    $procs = @(Get-AppProcesses)
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($procs.Count) { Write-Info ("{0} node process(es) terminated" -f $procs.Count) }
    Start-Sleep -Milliseconds 800
}
function Register-App([string]$ReleaseDir) {
    # DEP-08: the app runs as a Task Scheduler task owned by the deploying user: survives the
    # deploy session, restarts on failure, starts at logon. Direct node.exe, no npm shim, so
    # Stop-ScheduledTask stops the actual server process.
    $launcher = Join-Path $ReleaseDir 'scripts\service-run.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -NodeExe "{1}" -LogDir "{2}"' -f $launcher, $nodeExe, $LogDir) `
        -WorkingDirectory $CurrentLink
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force `
        -Description ("FinSentinel {0} - Financial Crime Risk Assessment Workbench" -f $Environment) | Out-Null
}
function Start-App([string]$ReleaseDir) {
    Register-App $ReleaseDir
    Start-ScheduledTask -TaskName $TaskName
    Write-Info ("task {0} started" -f $TaskName)
}
function Invoke-Smoke([string]$ReleaseDir) {
    Invoke-Native 'smoke test' $nodeExe @('scripts\smoke.ts', ("--url=http://127.0.0.1:{0}" -f $Port), '--wait=90000') $ReleaseDir
}
function Set-Current([string]$ReleaseDir) {
    if (Test-Path $CurrentLink) { (Get-Item $CurrentLink).Delete() }
    New-Item -ItemType Junction -Path $CurrentLink -Target $ReleaseDir | Out-Null
}
function Invoke-Backup([string]$ReleaseDir) {
    $dbPath = Read-EnvValue $SharedEnv 'DB_PATH'
    if (-not $dbPath -or -not (Test-Path $dbPath)) { Write-Info "no database yet; nothing to back up"; return $null }
    $before = Get-ChildItem (Join-Path $DataDir 'backups') -Filter '*.db' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    Invoke-Native 'backup' $nodeExe @('--env-file=.env', 'scripts\backup.ts') $ReleaseDir
    $after = Get-ChildItem (Join-Path $DataDir 'backups') -Filter '*.db' | Where-Object { $before -notcontains $_.Name } | Sort-Object Name | Select-Object -Last 1
    if ($after) { Write-Ok ("backup {0}" -f $after.Name); return $after.FullName }
    return $null
}

Write-Host ""
Write-Host ("FinSentinel deploy - {0}" -f $Environment) -ForegroundColor White
Write-Host ("Install dir: {0}   Task: {1}   Port: {2}" -f $InstallDir, $TaskName, $Port) -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
if ($Status) {
    $cur = Get-CurrentRelease
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Host ("current release : {0}" -f ($(if ($cur) { $cur } else { '(none)' })))
    Write-Host ("previous release: {0}" -f ($(if (Test-Path $PreviousFile) { Get-Content $PreviousFile } else { '(none)' })))
    Write-Host ("task state      : {0}" -f ($(if ($task) { $task.State } else { 'not registered' })))
    Write-Host ("node processes  : {0}" -f @(Get-AppProcesses).Count)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/health/ready" -f $Port) -TimeoutSec 5
        Write-Host ("health/ready    : {0} {1}" -f $r.StatusCode, $r.Content)
    } catch { Write-Host ("health/ready    : unreachable ({0})" -f $_.Exception.Message) }
    exit 0
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
if ($Rollback) {
    Write-Step "Rolling back"
    if (-not (Test-Path $PreviousFile)) { Fail "no previous release recorded in previous.txt" }
    $prev = (Get-Content $PreviousFile | Select-Object -First 1).Trim()
    if (-not (Test-Path $prev)) { Fail ("previous release directory missing: {0}" -f $prev) }
    $cur = Get-CurrentRelease
    Stop-App
    if ($RestoreDb) {
        Invoke-Native 'restore' $nodeExe @('--env-file=.env', 'scripts\restore.ts', '--latest', '--yes') $prev
    }
    Set-Current $prev
    if ($cur) { Set-Content -Path $PreviousFile -Value $cur -Encoding ASCII }
    Start-App $prev
    try { Invoke-Smoke $prev } catch { Fail ("rollback started but smoke test failed: {0}" -f $_.Exception.Message) }
    Write-Ok ("rolled back to {0}" -f $prev)
    exit 0
}

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
if (-not $Ref) { Fail "-Ref <tag|branch> is required for a deployment" }

Write-Step "Preflight"
if ($null -eq $nodeExe) { Fail "node not found on PATH (Node >= 24 required)" }
$nodeMajor = [int]((& $nodeExe --version).Trim().TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { Fail ("Node >= 24 required, found {0}" -f (& $nodeExe --version)) }
if ($null -eq $npmCmd) { Fail "npm not found on PATH" }
if ($null -eq $gitExe) { Fail "git not found on PATH" }
$env:NODE_USE_SYSTEM_CA = '1'   # npm behind the corporate TLS proxy (tools.md §2.1)
Write-Ok ("node {0}, git present, NODE_USE_SYSTEM_CA=1" -f (& $nodeExe --version).Trim())
foreach ($d in @($SharedDir, $DataDir, (Join-Path $DataDir 'uploads'), (Join-Path $DataDir 'backups'), $LogDir, $ReleasesDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}
Write-Ok "directory layout ready"

Write-Step "Fetching release $Ref"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safeRef = ($Ref -replace '[^A-Za-z0-9._-]', '_')
$ReleaseDir = Join-Path $ReleasesDir ("{0}-{1}" -f $safeRef, $stamp)
$cloneArgs = @('clone', '--quiet')
if (-not (Test-Path $Repo)) { $cloneArgs += @('--depth', '1') }   # local clones ignore --depth and warn
$cloneArgs += @('--branch', $Ref, $Repo, $ReleaseDir)
Invoke-Native 'git clone' $gitExe $cloneArgs $InstallDir
$sha = (& $gitExe -C $ReleaseDir rev-parse --short HEAD).Trim()
Write-Ok ("{0} @ {1} -> {2}" -f $Ref, $sha, $ReleaseDir)

Write-Step "Configuration (shared\.env)"
if (-not (Test-Path $SharedEnv)) {
    # DEP-07: production profile. Demo cases are not seeded unless an operator opts in explicitly.
    $seed = if ($Environment -eq 'production') { '0' } else { '1' }
    $allow = if ($Environment -eq 'production') { '0' } else { '1' }
    $lines = @(
        "# FinSentinel $Environment - generated by scripts/deploy.ps1 on $(Get-Date -Format s). Edit here; copied into each release.",
        "NODE_ENV=production",
        "PORT=$Port",
        "HOST=127.0.0.1",
        "DB_PATH=$($DataDir -replace '\\','/')/finsentinel.db",
        "UPLOAD_DIR=$($DataDir -replace '\\','/')/uploads",
        "BACKUP_DIR=$($DataDir -replace '\\','/')/backups",
        "SESSION_SECRET=$(New-Secret 48)",
        "AUTH_MODE=simulation",
        "LLM_GATEWAY=mock",
        "# LLM_GATEWAY=anthropic",
        "# ANTHROPIC_API_KEY=sk-ant-...   (set via a secret store, never commit)",
        "LOG_LEVEL=info",
        "SEED_ON_START=$seed",
        "ALLOW_SEED=$allow",
        "MOCK_LATENCY_MS=1800",
        "TRUST_PROXY=0",
        "COOKIE_SECURE=0",
        "# CORS_ORIGIN=https://finsentinel.example.com"
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($SharedEnv, [string[]]$lines, $utf8NoBom)
    Write-Ok "created shared\.env with a generated SESSION_SECRET (review before go-live)"
} else {
    Write-Ok "shared\.env exists; left untouched"
}
Copy-Item $SharedEnv (Join-Path $ReleaseDir '.env') -Force
Write-Ok "shared\.env copied into the release"

Write-Step "Installing dependencies and building the web app"
Invoke-Native 'npm ci' $npmCmd @('ci', '--no-fund', '--no-audit', '--silent') $ReleaseDir
# The app validates the configuration itself (zod schema); fail here rather than after the switch.
Invoke-Native 'env check' $nodeExe @('--env-file=.env', '-e', "import('./src/config/env.ts').then(m=>{const e=m.loadEnv();console.log('    ..   env ok: NODE_ENV='+e.NODE_ENV+' gateway='+e.LLM_GATEWAY+' seed='+e.SEED_ON_START+' port='+e.PORT)})") $ReleaseDir
Invoke-Native 'npm run build' $npmCmd @('run', 'build', '--silent') $ReleaseDir
if (-not (Test-Path (Join-Path $ReleaseDir 'web\dist\index.html'))) { Fail "web/dist/index.html not produced" }
Write-Ok "release built"

Write-Step "Backing up the database (recovery point)"
$previous = Get-CurrentRelease
$backupFile = Invoke-Backup $ReleaseDir

Write-Step "Switching to the new release"
Stop-App
Set-Current $ReleaseDir
if ($previous) { Set-Content -Path $PreviousFile -Value $previous -Encoding ASCII }
Start-App $ReleaseDir
Write-Ok ("current -> {0}" -f $ReleaseDir)

Write-Step "Smoke test"
try {
    Invoke-Smoke $ReleaseDir
    Write-Ok "smoke test passed"
} catch {
    Write-Warn ("smoke test failed: {0}" -f $_.Exception.Message)
    if ($previous -and (Test-Path $previous)) {
        Write-Step "Automatic rollback"
        Stop-App
        if ($backupFile) {
            Invoke-Native 'restore' $nodeExe @('--env-file=.env', 'scripts\restore.ts', ("--from={0}" -f $backupFile), '--yes') $previous
        }
        Set-Current $previous
        Set-Content -Path $PreviousFile -Value $ReleaseDir -Encoding ASCII
        Start-App $previous
        try { Invoke-Smoke $previous; Write-Warn ("rolled back to {0}" -f $previous) } catch { Write-Warn "rollback smoke test also failed; manual intervention required" }
    } else {
        Write-Warn "no previous release to roll back to; application left stopped"
        Stop-App
    }
    Fail "deployment of $Ref failed smoke test"
}

Write-Step "Housekeeping"
$keep = @($ReleaseDir); if ($previous) { $keep += $previous }
Get-ChildItem $ReleasesDir -Directory | Sort-Object Name -Descending | Select-Object -Skip $KeepReleases |
    Where-Object { $keep -notcontains $_.FullName } | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue; Write-Info ("removed old release {0}" -f $_.Name)
    }

Write-Host ""
Write-Host ("Deployed {0} ({1}) to {2}: http://127.0.0.1:{3}" -f $Ref, $sha, $Environment, $Port) -ForegroundColor Green
Write-Host ("Logs: {0}   Rollback: .\scripts\deploy.ps1 -Environment {1} -Rollback [-RestoreDb]" -f $LogDir, $Environment) -ForegroundColor DarkGray
exit 0
