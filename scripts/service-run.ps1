<#
.SYNOPSIS
  Task Scheduler launcher for FinSentinel (used by scripts/deploy.ps1, DEP-08).

.DESCRIPTION
  Starts the server from the working directory (the 'current' junction) with stdout/stderr
  appended to a dated log file under -LogDir, and waits for it. Node runs .ts natively; the
  configuration comes from .env in the release directory. --use-system-ca lets the Anthropic
  gateway trust the corporate proxy CA when a real key is configured.
#>
param(
    [string]$NodeExe = 'node',
    [string]$LogDir = '.\logs'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd'
$out = Join-Path $LogDir ("finsentinel-{0}.log" -f $stamp)
$err = Join-Path $LogDir ("finsentinel-{0}.err.log" -f $stamp)
$cwd = (Get-Location).Path
$proc = Start-Process -FilePath $NodeExe `
    -ArgumentList @('--use-system-ca', '--env-file=.env', 'src/server.ts') `
    -WorkingDirectory $cwd -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
try {
    Wait-Process -Id $proc.Id
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
exit $proc.ExitCode
