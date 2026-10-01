<#
.SYNOPSIS
  Sums Claude Code token usage from session transcripts for this project.

.DESCRIPTION
  Reads the JSONL transcript(s) Claude Code writes under
  ~/.claude/projects/C--Users-OFBrena-vscode-projects-sentinel1/
  and prints per-session totals of input, output, cache-read and
  cache-write tokens. Use the output to append rows to logs/token_log.md.

.PARAMETER Session
  Optional session id prefix (e.g. b8cec19e). Default: all sessions.

.EXAMPLE
  .\scripts\token_report.ps1
  .\scripts\token_report.ps1 -Session b8cec19e
#>
param(
    [string]$Session = ""
)

$dir = Join-Path $env:USERPROFILE ".claude\projects\C--Users-OFBrena-vscode-projects-sentinel1"
$files = Get-ChildItem $dir -Filter "*.jsonl" -File
if ($Session) { $files = $files | Where-Object { $_.BaseName -like "$Session*" } }

$rows = foreach ($f in $files) {
    $in = 0; $out = 0; $cr = 0; $cw = 0; $n = 0
    Get-Content $f.FullName | ForEach-Object {
        try { $o = $_ | ConvertFrom-Json } catch { return }
        if ($o.type -eq 'assistant' -and $o.message.usage) {
            $u = $o.message.usage
            $n++
            $in += [int]$u.input_tokens
            $out += [int]$u.output_tokens
            $cr += [int]$u.cache_read_input_tokens
            $cw += [int]$u.cache_creation_input_tokens
        }
    }
    [pscustomobject]@{
        Session      = $f.BaseName.Substring(0, 8)
        LastWrite    = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
        Turns        = $n
        Input        = $in
        Output       = $out
        CacheRead    = $cr
        CacheWrite   = $cw
        Total        = $in + $out + $cr + $cw
    }
}

$rows | Format-Table -AutoSize
