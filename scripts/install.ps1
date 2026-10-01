<#
.SYNOPSIS
  Installs FinSentinel (Financial Crime Risk Assessment Workbench) on Windows.

.DESCRIPTION
  One-shot local install for the hackathon build. Runs from any directory and
  operates on the repository that contains this script. Steps:

    1. Checks Node >= 24 and npm are on PATH.
    2. Sets NODE_USE_SYSTEM_CA=1 for this session and persists it for the user
       (required behind the Netskope TLS proxy so npm can download packages).
    3. Creates .env from .env.example if missing, with a freshly generated
       SESSION_SECRET. An existing .env is never modified.
    4. Creates the data directories (db, uploads, backups).
    5. Installs npm dependencies (npm ci when package-lock.json is present).
    6. Verifies Node's built-in SQLite has FTS5 and JSON1.
    7. Applies database migrations and seeds the demo cases.
    8. Builds the React web app into web/dist.
    9. Optionally installs Chromium for Playwright e2e, runs the fast test
       suite, and starts the server.

  Windows PowerShell 5.1 compatible. Only pure-JS dependencies are used, so no
  C++ build tools, Docker or Python are required.

.PARAMETER SkipBuild
  Skip `npm run build` (web/dist). Use with the Vite dev server (npm run dev:web).

.PARAMETER SkipSeed
  Skip migrations and demo-case seeding. The server still seeds on first start
  when SEED_ON_START=1 in .env.

.PARAMETER WithChromium
  Also run `npx playwright install chromium` so `npm run test:e2e` works.

.PARAMETER RunTests
  Run `npm test` (unit, integration, security, adversarial; no browser) after install.

.PARAMETER Start
  Start the server (`npm start`) when the install finishes.

.PARAMETER AnthropicApiKey
  If supplied and .env is being created, configure the real Anthropic gateway
  (LLM_GATEWAY=anthropic) with this key instead of the mock gateway.

.PARAMETER Port
  Port written to a newly created .env. Default 3000.

.EXAMPLE
  .\scripts\install.ps1
  .\scripts\install.ps1 -RunTests -Start
  .\scripts\install.ps1 -WithChromium -RunTests
  .\scripts\install.ps1 -AnthropicApiKey sk-ant-...
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipSeed,
    [switch]$WithChromium,
    [switch]$RunTests,
    [switch]$Start,
    [string]$AnthropicApiKey = "",
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$script:StepNo = 0

function Write-Step([string]$Text) {
    $script:StepNo++
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $script:StepNo, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text)   { Write-Host ("    OK   {0}" -f $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ("    ..   {0}" -f $Text) -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host ("    WARN {0}" -f $Text) -ForegroundColor Yellow }
function Fail([string]$Text) {
    Write-Host ""
    Write-Host ("FAILED: {0}" -f $Text) -ForegroundColor Red
    exit 1
}

# Run a native command and stop on a non-zero exit code.
function Invoke-Native([string]$Label, [string]$Exe, [string[]]$Arguments) {
    Write-Info ("{0} {1}" -f $Exe, ($Arguments -join ' '))
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Fail ("{0} exited with code {1}" -f $Label, $LASTEXITCODE) }
}

# npm/npx are .cmd shims on Windows; resolve them once.
function Resolve-Tool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { return $null }
    return $cmd.Source
}

function New-Secret([int]$Length) {
    $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $bytes) { [void]$sb.Append($alphabet[$b % $alphabet.Length]) }
    return $sb.ToString()
}

# ---------------------------------------------------------------------------
# Locate repository root (parent of scripts/)
# ---------------------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
    Fail "package.json not found next to scripts/. Run this script from the FinSentinel repository."
}
Set-Location $RepoRoot

Write-Host ""
Write-Host "FinSentinel installer" -ForegroundColor White
Write-Host "Financial Crime Risk Assessment Workbench - AI prepares. Rules calculate. Humans decide." -ForegroundColor DarkGray
Write-Host ("Repository: {0}" -f $RepoRoot) -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 1. Toolchain
# ---------------------------------------------------------------------------
Write-Step "Checking toolchain"

$nodeExe = Resolve-Tool 'node'
if ($null -eq $nodeExe) { Fail "Node.js not found on PATH. Install Node 24 LTS from https://nodejs.org and re-run." }
$nodeVersionText = (& $nodeExe --version).Trim()
$nodeMajor = [int]($nodeVersionText.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) {
    Fail ("Node {0} found but FinSentinel needs Node >= 24 (native .ts execution and node:sqlite)." -f $nodeVersionText)
}
Write-Ok ("Node {0}" -f $nodeVersionText)

$npmCmd = Resolve-Tool 'npm'
if ($null -eq $npmCmd) { Fail "npm not found on PATH." }
$npmVersionText = (& $npmCmd --version).Trim()
Write-Ok ("npm {0}" -f $npmVersionText)

$npxCmd = Resolve-Tool 'npx'
if ($null -eq $npxCmd) { Write-Warn "npx not found; Chromium install will be skipped if requested." }

# ---------------------------------------------------------------------------
# 2. Corporate proxy CA trust
# ---------------------------------------------------------------------------
Write-Step "Configuring NODE_USE_SYSTEM_CA"

$env:NODE_USE_SYSTEM_CA = '1'
$persisted = [Environment]::GetEnvironmentVariable('NODE_USE_SYSTEM_CA', 'User')
if ($persisted -eq '1') {
    Write-Ok "Already persisted for this user"
} else {
    try {
        [Environment]::SetEnvironmentVariable('NODE_USE_SYSTEM_CA', '1', 'User')
        Write-Ok "Persisted for this user (new terminals will pick it up)"
    } catch {
        Write-Warn ("Could not persist user environment variable: {0}" -f $_.Exception.Message)
        Write-Warn "Set it manually: setx NODE_USE_SYSTEM_CA 1"
    }
}
Write-Ok "Active for this session"

# ---------------------------------------------------------------------------
# 3. .env
# ---------------------------------------------------------------------------
Write-Step "Preparing .env"

$envPath = Join-Path $RepoRoot '.env'
$envExample = Join-Path $RepoRoot '.env.example'
$envCreated = $false

if (Test-Path $envPath) {
    Write-Ok ".env already exists; leaving it untouched"
    if ($AnthropicApiKey) {
        Write-Warn "-AnthropicApiKey ignored because .env already exists. Edit .env by hand to switch gateways."
    }
} else {
    if (-not (Test-Path $envExample)) { Fail ".env.example is missing; cannot create .env." }
    $lines = Get-Content $envExample -Encoding UTF8
    $secret = New-Secret 48
    $out = foreach ($line in $lines) {
        if ($line -match '^SESSION_SECRET=') { "SESSION_SECRET=$secret"; continue }
        if ($line -match '^PORT=')           { "PORT=$Port"; continue }
        if ($AnthropicApiKey) {
            if ($line -match '^LLM_GATEWAY=mock')        { "LLM_GATEWAY=anthropic"; continue }
            if ($line -match '^#\s*LLM_GATEWAY=anthropic') { continue }
            if ($line -match '^#\s*ANTHROPIC_API_KEY=')    { "ANTHROPIC_API_KEY=$AnthropicApiKey"; continue }
        }
        $line
    }
    # Write without BOM so node --env-file parses the first key cleanly.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($envPath, [string[]]$out, $utf8NoBom)
    $envCreated = $true
    Write-Ok ".env created from .env.example with a generated SESSION_SECRET"
    if ($AnthropicApiKey) {
        Write-Ok "LLM_GATEWAY=anthropic configured"
    } else {
        Write-Ok "LLM_GATEWAY=mock (fixture-backed; no API key needed)"
    }
}

# ---------------------------------------------------------------------------
# 4. Data directories
# ---------------------------------------------------------------------------
Write-Step "Creating data directories"

foreach ($rel in @('data', 'data\uploads', 'data\backups', 'evaluations\results', 'test-results')) {
    $p = Join-Path $RepoRoot $rel
    if (-not (Test-Path $p)) {
        New-Item -ItemType Directory -Path $p | Out-Null
        Write-Ok ("created {0}" -f $rel)
    } else {
        Write-Info ("exists  {0}" -f $rel)
    }
}

# ---------------------------------------------------------------------------
# 5. Dependencies
# ---------------------------------------------------------------------------
Write-Step "Installing npm dependencies (pure-JS only; no node-gyp)"

if (Test-Path (Join-Path $RepoRoot 'package-lock.json')) {
    Invoke-Native 'npm ci' $npmCmd @('ci', '--no-fund', '--no-audit')
} else {
    Invoke-Native 'npm install' $npmCmd @('install', '--no-fund', '--no-audit')
}
Write-Ok "node_modules ready"

# ---------------------------------------------------------------------------
# 6. SQLite capability probe
# ---------------------------------------------------------------------------
Write-Step "Probing node:sqlite for FTS5 and JSON1"

$probe = & $nodeExe (Join-Path $RepoRoot 'scripts\probe_sqlite.mjs') 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Fail "node:sqlite probe failed:`n$probe" }
if ($probe -notmatch 'FTS5: OK') { Fail "SQLite FTS5 is not available in this Node build. Policy retrieval needs it.`n$probe" }
if ($probe -notmatch 'JSON1: OK') { Fail "SQLite JSON1 is not available in this Node build.`n$probe" }
Write-Ok "FTS5 and JSON1 available"

# ---------------------------------------------------------------------------
# 7. Migrate + seed
# ---------------------------------------------------------------------------
if ($SkipSeed) {
    Write-Step "Skipping migrations and seed (-SkipSeed)"
} else {
    Write-Step "Applying migrations and seeding demo cases"
    Invoke-Native 'npm run migrate' $npmCmd @('run', 'migrate', '--silent')
    Invoke-Native 'npm run seed'    $npmCmd @('run', 'seed', '--silent')
    Write-Ok "Database ready"
}

# ---------------------------------------------------------------------------
# 8. Web build
# ---------------------------------------------------------------------------
if ($SkipBuild) {
    Write-Step "Skipping web build (-SkipBuild)"
} else {
    Write-Step "Building web app (web/dist)"
    Invoke-Native 'npm run build' $npmCmd @('run', 'build', '--silent')
    if (-not (Test-Path (Join-Path $RepoRoot 'web\dist\index.html'))) { Fail "web/dist/index.html not produced by the build." }
    Write-Ok "web/dist built"
}

# ---------------------------------------------------------------------------
# 9. Optional: Chromium, tests
# ---------------------------------------------------------------------------
if ($WithChromium) {
    Write-Step "Installing Chromium for Playwright e2e"
    if ($null -eq $npxCmd) {
        Write-Warn "npx unavailable; skipped"
    } else {
        Invoke-Native 'playwright install chromium' $npxCmd @('playwright', 'install', 'chromium')
        Write-Ok "Chromium installed"
    }
}

if ($RunTests) {
    Write-Step "Running fast test suite (unit, integration, security, adversarial)"
    Invoke-Native 'npm test' $npmCmd @('test', '--silent')
    Write-Ok "All tests passed"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$effectivePort = $Port
if (-not $envCreated -and (Test-Path $envPath)) {
    $portLine = Get-Content $envPath | Where-Object { $_ -match '^PORT=(\d+)' } | Select-Object -First 1
    if ($portLine) { $effectivePort = [int]($portLine -replace '^PORT=', '') }
}

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ("  npm start                 API + web on http://localhost:{0}" -f $effectivePort)
Write-Host  "  npm test                  fast suite (no browser)"
Write-Host  "  npm run eval ; npm run gate   evaluation + quality gate"
if (-not $WithChromium) {
    Write-Host "  npx playwright install chromium ; npm run test:e2e   browser walkthrough"
}
Write-Host ""
Write-Host "Sign in by choosing a role tile (simulation mode, synthetic users only)." -ForegroundColor DarkGray
if ($persisted -ne '1') {
    Write-Host "Open a new terminal before running npm commands so NODE_USE_SYSTEM_CA=1 is picked up." -ForegroundColor Yellow
}

if ($Start) {
    Write-Host ""
    Write-Host ("Starting FinSentinel on http://localhost:{0} (Ctrl+C to stop)" -f $effectivePort) -ForegroundColor Cyan
    & $npmCmd start
    exit $LASTEXITCODE
}
