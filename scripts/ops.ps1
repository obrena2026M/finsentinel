<#
.SYNOPSIS
  Installs the FinSentinel operations schedule on a Windows host (STAGE06 OPS-01, OPS-06).

.DESCRIPTION
  Registers two Task Scheduler tasks next to the application task created by deploy.ps1:

    FinSentinel-<env>-heartbeat   every N minutes: scripts/heartbeat.ts against the local port,
                                  one JSON line per run appended to shared\logs\heartbeat.jsonl,
                                  metrics snapshot stored in the database for trends
    FinSentinel-<env>-backup      daily at -BackupAt: scripts/backup.ts --keep-days=<retention>
                                  (VACUUM INTO shared\data\backups, prunes old files)

  Both run from <InstallDir>\current (the active release) with its .env, so they follow every deploy
  without re-registration.

.PARAMETER Environment   staging | production
.PARAMETER InstallDir    Default C:\finsentinel\<Environment>
.PARAMETER Port          App port (default 3000 production / 3001 staging)
.PARAMETER HeartbeatEveryMinutes  Default 15
.PARAMETER BackupAt      Daily backup time, default 02:00
.PARAMETER KeepDays      Backup retention in days, default from config/ops.json (14)
.PARAMETER Remove        Unregister both tasks
.PARAMETER RunNow        Start both tasks immediately after (re)registration and print the heartbeat log tail
.PARAMETER Status        Show task states, last results and the last heartbeat line

.EXAMPLE
  .\scripts\ops.ps1 -Environment production
  .\scripts\ops.ps1 -Environment production -RunNow
  .\scripts\ops.ps1 -Environment production -Status
  .\scripts\ops.ps1 -Environment staging -Remove
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('staging', 'production')][string]$Environment,
    [string]$InstallDir = '',
    [int]$Port = 0,
    [int]$HeartbeatEveryMinutes = 15,
    [string]$BackupAt = '02:00',
    [int]$KeepDays = 0,
    [switch]$Remove,
    [switch]$RunNow,
    [switch]$Status
)
$ErrorActionPreference = 'Stop'
trap { Write-Host ""; Write-Host ("FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red; exit 1 }
function Write-Ok([string]$T)   { Write-Host ("    OK   {0}" -f $T) -ForegroundColor Green }
function Write-Info([string]$T) { Write-Host ("    ..   {0}" -f $T) -ForegroundColor Gray }

if (-not $InstallDir) { $InstallDir = Join-Path 'C:\finsentinel' $Environment }
if ($Port -eq 0) { $Port = if ($Environment -eq 'production') { 3000 } else { 3001 } }
$Current = Join-Path $InstallDir 'current'
$LogDir  = Join-Path $InstallDir 'shared\logs'
$HbLog   = Join-Path $LogDir 'heartbeat.jsonl'
$HbTask  = "FinSentinel-$Environment-heartbeat"
$BkTask  = "FinSentinel-$Environment-backup"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
if ($KeepDays -eq 0) {
    $opsCfg = Join-Path $Current 'config\ops.json'
    $KeepDays = 14
    if (Test-Path $opsCfg) { try { $KeepDays = [int](Get-Content $opsCfg -Raw | ConvertFrom-Json).retention.backups_days } catch {} }
}

Write-Host ""
Write-Host ("FinSentinel operations schedule - {0}" -f $Environment) -ForegroundColor White
Write-Host ("Install dir: {0}   Port: {1}   Heartbeat: every {2} min   Backup: daily {3}, keep {4} days" -f $InstallDir, $Port, $HeartbeatEveryMinutes, $BackupAt, $KeepDays) -ForegroundColor DarkGray

if ($Status) {
    foreach ($t in @($HbTask, $BkTask)) {
        $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        if ($task) {
            $info = Get-ScheduledTaskInfo -TaskName $t
            Write-Host ("{0,-40} {1,-8} last run {2}  result {3}  next {4}" -f $t, $task.State, $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
        } else { Write-Host ("{0,-40} not registered" -f $t) }
    }
    if (Test-Path $HbLog) {
        $last = Get-Content $HbLog -Tail 1 | ConvertFrom-Json
        Write-Host ("last heartbeat {0}: {1}" -f $last.taken_at, $last.status.ToUpper())
        foreach ($f in $last.findings | Where-Object { $_.severity -ne 'ok' }) { Write-Host ("  {0,-8} {1,-30} {2}" -f $f.severity.ToUpper(), $f.check, $f.detail) }
    } else { Write-Host "no heartbeat log yet" }
    exit 0
}

if ($Remove) {
    foreach ($t in @($HbTask, $BkTask)) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Write-Ok ("removed {0}" -f $t)
        } else { Write-Info ("{0} not registered" -f $t) }
    }
    exit 0
}

if (-not (Test-Path (Join-Path $Current 'package.json'))) { throw ("no active release at {0}; run deploy.ps1 first" -f $Current) }
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew -StartWhenAvailable

# Heartbeat: every N minutes, indefinitely (OPS-01)
$hbAction = New-ScheduledTaskAction -Execute $nodeExe -WorkingDirectory $Current `
    -Argument ('--env-file=.env scripts\heartbeat.ts --url=http://127.0.0.1:{0} --out="{1}"' -f $Port, $HbLog)
$hbTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $HeartbeatEveryMinutes)
Register-ScheduledTask -TaskName $HbTask -Action $hbAction -Trigger $hbTrigger -Settings $settings -Force `
    -Description ("FinSentinel {0} heartbeat (STAGE06 OPS-01): health, audit chain, backup age, disk, metrics snapshot" -f $Environment) | Out-Null
Write-Ok ("registered {0}" -f $HbTask)

# Backup: daily with retention (OPS-06, NFR-OPS-07)
$bkAction = New-ScheduledTaskAction -Execute $nodeExe -WorkingDirectory $Current `
    -Argument ('--env-file=.env scripts\backup.ts --keep-days={0}' -f $KeepDays)
$bkTrigger = New-ScheduledTaskTrigger -Daily -At $BackupAt
Register-ScheduledTask -TaskName $BkTask -Action $bkAction -Trigger $bkTrigger -Settings $settings -Force `
    -Description ("FinSentinel {0} daily database backup, {1}-day retention (STAGE06 OPS-06)" -f $Environment, $KeepDays) | Out-Null
Write-Ok ("registered {0}" -f $BkTask)

if ($RunNow) {
    foreach ($t in @($BkTask, $HbTask)) {
        Start-ScheduledTask -TaskName $t
        $deadline = (Get-Date).AddSeconds(90)
        do { Start-Sleep -Milliseconds 500 } while ((Get-ScheduledTask -TaskName $t).State -eq 'Running' -and (Get-Date) -lt $deadline)
        $info = Get-ScheduledTaskInfo -TaskName $t
        Write-Info ("{0}: last result {1}" -f $t, $info.LastTaskResult)
    }
    if (Test-Path $HbLog) {
        $last = Get-Content $HbLog -Tail 1 | ConvertFrom-Json
        Write-Host ("heartbeat {0}: {1}" -f $last.taken_at, $last.status.ToUpper())
        foreach ($f in $last.findings) { Write-Host ("  {0,-8} {1,-30} {2}" -f $f.severity.ToUpper(), $f.check, $f.detail) }
    }
}
Write-Host ""
Write-Host ("Schedule installed. Status: .\scripts\ops.ps1 -Environment {0} -Status   Remove: -Remove" -f $Environment) -ForegroundColor DarkGray
exit 0
