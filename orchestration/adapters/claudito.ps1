<#
claudito.ps1 - Claudito adapter for OpenClaw orchestration.

Hands an approved mission brief to Claude Code non-interactively (claude -p)
and captures the run as durable artifacts plus a receipt.

Usage:
  powershell -ExecutionPolicy Bypass -File claudito.ps1 -MissionFile <path> [-WorkspaceRoot <path>] [-Model <name>] [-AllowMcp]

Exit codes (machine-readable):
  0  mission executed and Claude Code exited 0 (see receipt for evidence)
  2  mission file not found
  3  mission malformed: required fields missing or unsafe mission ID
  4  approval absent or ambiguous (silence is not approval)
  5  mission requests forbidden action(s) without explicit approval
  6  claude CLI not found or not runnable
  7  Claude Code executed but returned a non-zero exit code
  8  unexpected adapter error

This adapter never runs git, never deletes, never moves, never restarts
anything, and never elevates. It creates files only under orchestration/runs/
and orchestration/receipts/.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MissionFile,

    # Workspace root. Default: two levels above this script (adapters -> orchestration -> workspace).
    [string]$WorkspaceRoot,

    # Optional model override passed to claude --model. Default: CLI default.
    [string]$Model,

    # By default MCP servers are disabled in the child session (--strict-mcp-config
    # with no --mcp-config). Pass -AllowMcp to let the child load configured MCP servers.
    [switch]$AllowMcp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$AdapterVersion = '0.1.0'

function Refuse([int]$Code, [string]$Message) {
    Write-Host ""
    Write-Host "REFUSED (exit $Code): $Message"
    exit $Code
}

try {
    # ---- Resolve workspace root (portable: no hardcoded user, drive, or machine) ----
    if (-not $WorkspaceRoot) {
        $WorkspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    }
    else {
        $WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
    }
    $OrchRoot = Join-Path $WorkspaceRoot 'orchestration'
    if (-not (Test-Path -LiteralPath $OrchRoot -PathType Container)) {
        Refuse 3 "No orchestration directory under workspace root: $WorkspaceRoot"
    }

    # ---- Requirement 1-2: mission file must exist ----
    if (-not (Test-Path -LiteralPath $MissionFile -PathType Leaf)) {
        Refuse 2 "Mission file not found: $MissionFile"
    }
    $MissionPath = (Resolve-Path -LiteralPath $MissionFile).Path
    $Mission = Get-Content -LiteralPath $MissionPath -Raw

    # ---- Requirement 3-4: parse and require fields ----
    function Get-BulletField([string]$Name) {
        if ($Mission -match "(?m)^\s*-\s*$([regex]::Escape($Name)):\s*(.+?)\s*$") { return $Matches[1] }
        return $null
    }
    function Get-MissionSection([string]$Header) {
        if ($Mission -match "(?ms)^##\s*$([regex]::Escape($Header))\s*\r?\n(.*?)(?=^##\s|\z)") { return $Matches[1].Trim() }
        return $null
    }

    $MissionId = Get-BulletField 'Mission ID'
    $Requester = Get-BulletField 'Requester'
    $Objective = Get-MissionSection 'Objective'
    $Scope     = Get-MissionSection 'Allowed scope'
    $Forbidden = Get-MissionSection 'Forbidden actions'

    $missing = @()
    if (-not $MissionId) { $missing += 'Mission ID' }
    if (-not $Requester) { $missing += 'Requester' }
    if (-not $Objective) { $missing += 'Objective section' }
    if (-not $Scope)     { $missing += 'Allowed scope section' }
    if (-not $Forbidden) { $missing += 'Forbidden actions section' }
    if ($missing.Count -gt 0) {
        Refuse 3 ("Mission is missing required fields: " + ($missing -join ', '))
    }
    if ($MissionId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
        Refuse 3 "Mission ID contains characters unsafe for a directory name: '$MissionId'"
    }

    # ---- Requirement 5: approval must be explicit and unambiguous ----
    $ApprovalValue = $null
    if ($Mission -match '(?m)^\s*-\s*Brief approved by Trey:\s*(.+?)\s*$') { $ApprovalValue = $Matches[1] }
    if (-not $ApprovalValue) {
        Refuse 4 'No "Brief approved by Trey:" line found in the mission. Silence is not approval.'
    }
    if ($ApprovalValue -notmatch '^(?i)granted\b' -or $ApprovalValue -match '(?i)pending|denied|\|') {
        Refuse 4 "Approval status is not an unambiguous grant: '$ApprovalValue'"
    }

    # ---- Requirement 6: forbidden-action tripwire over the requested work ----
    # Conservative keyword screen of Objective + Allowed scope (what the mission
    # ASKS FOR; the Forbidden actions section itself is expected to name these
    # words and is deliberately not scanned). False positives are possible and
    # accepted: reword the mission, or add an explicit line
    #   - Forbidden-action approval: granted <ISO 8601> covering: <actions>
    # after Trey approves the specific action.
    $ForbiddenPatterns = @(
        'git\s+add', 'git\s+commit', 'git\s+push', '\bcommit\b', '\bpush\b',
        '\bstage\b', '\bstaging\b', '\bdelete\b', '\bremove\b', '\berase\b',
        '\bmove\b', '\brename\b', '\brestart\b', '\breboot\b', '\bshutdown\b',
        '\bkill\b', '\binstall\b', '\buninstall\b', '\bupgrade\b', '\bVPS\b',
        '\bregistry\b', 'Windows\s+settings'
    )
    $RequestText = "$Objective`n$Scope"
    $TripwireHits = @()
    foreach ($pat in $ForbiddenPatterns) {
        if ($RequestText -match "(?i)$pat") { $TripwireHits += $pat }
    }
    $ForbiddenApprovalLine = $null
    if ($Mission -match '(?m)^\s*-\s*Forbidden-action approval:\s*(granted\b.+?)\s*$') {
        $ForbiddenApprovalLine = $Matches[1]
    }
    if ($TripwireHits.Count -gt 0 -and -not $ForbiddenApprovalLine) {
        Refuse 5 ("Mission text requests forbidden action(s) with no explicit 'Forbidden-action approval: granted' line. Tripwire hits: " + ($TripwireHits -join ', '))
    }

    # ---- Tools: default read-only; mission may narrow/widen via "Tools allowed:" ----
    $Tools = 'Read,Glob,Grep'
    if ($Scope -match '(?m)^\s*-?\s*Tools allowed:\s*(.+?)\s*$') { $Tools = $Matches[1] }
    if ($Tools -notmatch '^[A-Za-z0-9_,]+$') {
        Refuse 3 "Tools allowed value contains unsafe characters: '$Tools'"
    }
    if ($Model -and $Model -notmatch '^[A-Za-z0-9.-]+$') {
        Refuse 3 "Model value contains unsafe characters: '$Model'"
    }

    # ---- Requirement 3: display before execution ----
    Write-Host "=== Claudito adapter v$AdapterVersion ==="
    Write-Host "Mission ID:        $MissionId"
    Write-Host "Requester:         $Requester"
    Write-Host "Approval:          $ApprovalValue"
    Write-Host "Objective:         $Objective"
    Write-Host "Allowed scope:"
    Write-Host ($Scope -replace '(?m)^', '  ')
    Write-Host "Forbidden actions:"
    Write-Host ($Forbidden -replace '(?m)^', '  ')
    Write-Host "Tools for child:   $Tools"
    if ($TripwireHits.Count -gt 0) {
        Write-Host "Tripwire hits:     $($TripwireHits -join ', ') (covered by: $ForbiddenApprovalLine)"
    }

    # ---- Requirement 7: locate claude CLI (verified syntax, no guessed flags) ----
    $ClaudeCmdInfo = Get-Command claude -ErrorAction SilentlyContinue
    if (-not $ClaudeCmdInfo) { Refuse 6 'claude CLI not found on PATH.' }
    $ClaudeExe = $ClaudeCmdInfo.Source
    if ($ClaudeExe -like '*.ps1') {
        # Start-Process cannot execute a .ps1 shim directly; npm installs a .cmd sibling.
        $CmdSibling = [System.IO.Path]::ChangeExtension($ClaudeExe, '.cmd')
        if (Test-Path -LiteralPath $CmdSibling) { $ClaudeExe = $CmdSibling }
        else { Refuse 6 "claude resolves to a .ps1 shim and no .cmd sibling exists: $ClaudeExe" }
    }

    # ---- Requirement 10: run artifacts under orchestration/runs/<mission-id>/ ----
    # Each invocation gets its own run-<stamp> subfolder; nothing is overwritten.
    $RunStamp = Get-Date -Format 'yyyyMMddTHHmmss'
    $RunDir = Join-Path (Join-Path (Join-Path $OrchRoot 'runs') $MissionId) ("run-" + $RunStamp)
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

    $PromptFile = Join-Path $RunDir 'prompt.txt'
    $StdoutFile = Join-Path $RunDir 'stdout.json'
    $StderrFile = Join-Path $RunDir 'stderr.txt'
    $RunInfoFile = Join-Path $RunDir 'run-info.json'
    Copy-Item -LiteralPath $MissionPath -Destination (Join-Path $RunDir 'mission-copy.md')

    $Preamble = @"
You are Claudito, the scoped engineering agent in the OpenClaw orchestration
system. Execute exactly the mission brief below and nothing else.

Hard rules for this run:
- Stay strictly inside the Allowed scope. Treat every Forbidden action as absolute.
- Your toolset for this run is restricted to: $Tools. Do not attempt writes,
  git operations, installs, restarts, deletions, or external side effects.
- If the mission asks for something your tools cannot do, say so plainly
  instead of improvising a workaround.
- Never invent results. Report only what you actually observed.

End your reply with exactly these three sections:
FILES READ:
FINDINGS:
ACTIONS NOT TAKEN:
"@
    $Prompt = $Preamble + "`n`n----- MISSION BRIEF (verbatim) -----`n`n" + $Mission
    $Prompt | Out-File -LiteralPath $PromptFile -Encoding utf8

    # ---- Requirement 7-9: launch and capture ----
    # Verified against claude --help (v2.0.35):
    #   -p/--print          non-interactive, prompt read from stdin
    #   --output-format json  single JSON result on stdout
    #   --tools <names>     restrict built-in toolset (print mode only)
    #   --strict-mcp-config only use MCP servers from --mcp-config (none given -> none)
    #   --model <name>      optional model override
    $ArgList = @('-p', '--output-format', 'json', '--tools', $Tools)
    if (-not $AllowMcp) { $ArgList += '--strict-mcp-config' }
    if ($Model) { $ArgList += @('--model', $Model) }

    $CommandLine = ('"{0}" {1}' -f $ClaudeExe, ($ArgList -join ' '))
    Write-Host ""
    Write-Host "Launching: $CommandLine"
    Write-Host "Working directory: $WorkspaceRoot"

    $StartTime = Get-Date -Format o
    $proc = Start-Process -FilePath $ClaudeExe -ArgumentList $ArgList `
        -WorkingDirectory $WorkspaceRoot `
        -RedirectStandardInput $PromptFile `
        -RedirectStandardOutput $StdoutFile `
        -RedirectStandardError $StderrFile `
        -NoNewWindow -PassThru
    $null = $proc.Handle   # cache handle so ExitCode is reliable on PS 5.1
    $proc.WaitForExit()
    $ClaudeExitCode = $proc.ExitCode
    $EndTime = Get-Date -Format o

    # ---- Requirement 9: durable run record ----
    $RunInfo = [ordered]@{
        missionId        = $MissionId
        missionFile      = $MissionPath
        adapterVersion   = $AdapterVersion
        command          = $ClaudeExe
        argumentList     = $ArgList
        commandLine      = $CommandLine
        workingDirectory = $WorkspaceRoot
        startTime        = $StartTime
        endTime          = $EndTime
        exitCode         = $ClaudeExitCode
        toolsAllowed     = $Tools
        mcpEnabled       = [bool]$AllowMcp
        modelOverride    = if ($Model) { $Model } else { $null }
        stdoutFile       = $StdoutFile
        stderrFile       = $StderrFile
        promptFile       = $PromptFile
    }
    $RunInfo | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $RunInfoFile -Encoding utf8

    # ---- Evidence summary from captured output (never trusted blindly) ----
    $ResultExcerpt = '(stdout not parseable as JSON; see stdout.json)'
    $IsError = $null
    try {
        $StdoutRaw = Get-Content -LiteralPath $StdoutFile -Raw
        if ($StdoutRaw -and $StdoutRaw.Trim().Length -gt 0) {
            $Parsed = $StdoutRaw | ConvertFrom-Json
            if ($Parsed.PSObject.Properties.Name -contains 'is_error') { $IsError = $Parsed.is_error }
            if ($Parsed.PSObject.Properties.Name -contains 'result' -and $Parsed.result) {
                $ResultExcerpt = [string]$Parsed.result
                if ($ResultExcerpt.Length -gt 800) { $ResultExcerpt = $ResultExcerpt.Substring(0, 800) + ' ...[truncated; full text in stdout.json]' }
            }
        }
        else {
            $ResultExcerpt = '(stdout was empty)'
        }
    }
    catch {
        # keep the placeholder excerpt; raw stdout remains on disk as evidence
    }

    $Success = ($ClaudeExitCode -eq 0 -and $IsError -ne $true)

    # ---- Requirement 11-12: receipt per RECEIPT-SCHEMA.md (append-only naming) ----
    $ReceiptPath = Join-Path (Join-Path $OrchRoot 'receipts') ($MissionId + '-RECEIPT.md')
    if (Test-Path -LiteralPath $ReceiptPath) {
        $ReceiptPath = Join-Path (Join-Path $OrchRoot 'receipts') ($MissionId + '-RECEIPT-' + $RunStamp + '.md')
    }
    $FinalResult = if ($Success) { 'done - Claude Code run completed with exit code 0; see run artifacts for evidence' }
                   elseif ($ClaudeExitCode -eq 0) { 'failed - exit code 0 but the CLI reported is_error=true; see stdout.json' }
                   else { "failed - Claude Code exited with code $ClaudeExitCode; see stderr.txt and stdout.json" }
    $TripwireNote = if ($TripwireHits.Count -gt 0) { ($TripwireHits -join ', ') + ' (covered by mission line: ' + $ForbiddenApprovalLine + ')' } else { 'none triggered' }

    $Receipt = @"
# Receipt: $MissionId

- Mission ID: $MissionId
- Date/time: $StartTime / $EndTime
- Requester: $Requester
- Assigned agent: Claudito (Claude Code via claudito.ps1 adapter v$AdapterVersion)
- Objective: $Objective
- Allowed scope: see mission-copy.md in the run directory; tools restricted to: $Tools
- Forbidden actions: per mission brief and standing policies; tripwire hits: $TripwireNote
- Files read: adapter read the mission file ($MissionPath). Files read by the
  child agent are self-reported in its FILES READ section inside stdout.json.
- Commands/tools used: $CommandLine (working directory: $WorkspaceRoot; prompt
  delivered on stdin from prompt.txt)
- Files created or changed: created run artifacts in $RunDir
  (prompt.txt, stdout.json, stderr.txt, run-info.json, mission-copy.md) and this
  receipt. The child session's toolset ($Tools) cannot write files.
- Tests/checks run: adapter verified mission fields, approval wording, and
  forbidden-action tripwire before launch. Child exit code: $ClaudeExitCode.
  CLI is_error flag: $(if ($null -eq $IsError) { 'not present in output' } else { $IsError }).
- Approvals required: brief approval by Trey (gate enforced by adapter).
- Approval status: Brief approved by Trey: $ApprovalValue. All other gates: not needed.
- Failures/errors: $(if ($Success) { 'none' } else { 'see stderr.txt and stdout.json in the run directory' })
- Final result: $FinalResult
- Unresolved questions: none recorded by the adapter; review the child agent's
  ACTIONS NOT TAKEN section in stdout.json.
- Next action: Trey reviews run artifacts in $RunDir

## Child agent result excerpt

$ResultExcerpt
"@
    $Receipt | Out-File -LiteralPath $ReceiptPath -Encoding utf8

    # ---- Requirement 14-15: honest final status, machine-readable exit ----
    Write-Host ""
    Write-Host "Run artifacts: $RunDir"
    Write-Host "Receipt:       $ReceiptPath"
    if ($Success) {
        Write-Host "RESULT: done (claude exit code 0)"
        exit 0
    }
    else {
        Write-Host "RESULT: FAILED (claude exit code $ClaudeExitCode, is_error=$IsError). Evidence retained; nothing is claimed as success."
        exit 7
    }
}
catch {
    Write-Host "ADAPTER ERROR (exit 8): $($_.Exception.Message)"
    exit 8
}
