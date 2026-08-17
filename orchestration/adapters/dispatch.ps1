<#
dispatch.ps1 - OpenClaw-side trigger for the Claudito adapter.

The OpenClaw agent (or Trey directly) calls this with a mission ID or mission
file. It validates, enforces approval and duplicate guards, then hands the
mission to claudito.ps1 and records the dispatch as durable trigger evidence.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File dispatch.ps1 -Mission <mission-id-or-path> [-WorkspaceRoot <path>] [-AllowRerun] [-DispatchedBy <name>]

Exit codes (dispatcher-level refusals are 10-14; adapter exit codes 0-8 pass
through unchanged so callers see the true result):
  0   dispatched; adapter and child both succeeded
  2-8 adapter refusal/failure codes, passed through (see claudito.ps1 header)
  10  mission not found (no such file; no unique mission with that ID)
  11  mission malformed or dispatcher misconfigured
  12  approval absent or ambiguous (silence is not approval)
  13  duplicate dispatch for this mission ID (use -AllowRerun to override)
  14  recursion guard: dispatch already active in this process chain

This script never runs git, never deletes, never moves, never restarts
anything, and never elevates. It writes only under orchestration/runs/.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Mission,

    [string]$WorkspaceRoot,

    # Explicit override of the one-dispatch-per-mission guard.
    [switch]$AllowRerun,

    # Recorded in the dispatch record: who pulled the trigger.
    [string]$DispatchedBy = 'openclaw-agent'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$DispatcherVersion = '0.1.0'

function Refuse([int]$Code, [string]$Message) {
    Write-Host ""
    Write-Host "DISPATCH REFUSED (exit $Code): $Message"
    exit $Code
}

try {
    # ---- Recursion guard: a dispatch must never trigger another dispatch ----
    if ($env:CLAUDITO_DISPATCH_ACTIVE) {
        Refuse 14 'CLAUDITO_DISPATCH_ACTIVE is set: refusing nested dispatch.'
    }
    $env:CLAUDITO_DISPATCH_ACTIVE = '1'

    # ---- Resolve workspace root (portable) ----
    if (-not $WorkspaceRoot) {
        $WorkspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
    }
    else {
        $WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
    }
    $OrchRoot = Join-Path $WorkspaceRoot 'orchestration'
    $AdapterPath = Join-Path $OrchRoot 'adapters\claudito.ps1'
    if (-not (Test-Path -LiteralPath $AdapterPath -PathType Leaf)) {
        Refuse 11 "Adapter not found: $AdapterPath"
    }

    # ---- Resolve mission: literal file path, or mission ID looked up in missions/ ----
    $MissionPath = $null
    if (Test-Path -LiteralPath $Mission -PathType Leaf) {
        $MissionPath = (Resolve-Path -LiteralPath $Mission).Path
    }
    elseif ($Mission -match '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
        $matches_ = @()
        foreach ($f in Get-ChildItem -LiteralPath (Join-Path $OrchRoot 'missions') -Filter '*.md' -File) {
            $content = Get-Content -LiteralPath $f.FullName -Raw
            if ($content -match "(?m)^\s*-\s*Mission ID:\s*$([regex]::Escape($Mission))\s*$") { $matches_ += $f.FullName }
        }
        if ($matches_.Count -eq 1) { $MissionPath = $matches_[0] }
        elseif ($matches_.Count -gt 1) { Refuse 11 ("Mission ID '$Mission' matches multiple files: " + ($matches_ -join '; ')) }
    }
    if (-not $MissionPath) {
        Refuse 10 "No mission file and no unique mission with ID '$Mission' under orchestration\missions\."
    }
    $MissionText = Get-Content -LiteralPath $MissionPath -Raw

    # ---- Validate required fields against MISSION-TEMPLATE.md shape ----
    function Get-BulletField([string]$Name) {
        if ($MissionText -match "(?m)^\s*-\s*$([regex]::Escape($Name)):\s*(.+?)\s*$") { return $Matches[1] }
        return $null
    }
    function Get-MissionSection([string]$Header) {
        if ($MissionText -match "(?ms)^##\s*$([regex]::Escape($Header))\s*\r?\n(.*?)(?=^##\s|\z)") { return $Matches[1].Trim() }
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
    if ($missing.Count -gt 0) { Refuse 11 ("Mission missing required fields: " + ($missing -join ', ')) }
    if ($MissionId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { Refuse 11 "Unsafe Mission ID: '$MissionId'" }

    # ---- Approval gate (defense in depth; the adapter re-checks) ----
    $ApprovalValue = $null
    if ($MissionText -match '(?m)^\s*-\s*Brief approved by Trey:\s*(.+?)\s*$') { $ApprovalValue = $Matches[1] }
    if (-not $ApprovalValue) { Refuse 12 'No "Brief approved by Trey:" line. Silence is not approval.' }
    if ($ApprovalValue -notmatch '^(?i)granted\b' -or $ApprovalValue -match '(?i)pending|denied|\|') {
        Refuse 12 "Approval not an unambiguous grant: '$ApprovalValue'"
    }

    # ---- Duplicate-execution guard: one dispatch per mission ID ----
    $MissionRunsDir = Join-Path (Join-Path $OrchRoot 'runs') $MissionId
    $priorDispatches = @()
    if (Test-Path -LiteralPath $MissionRunsDir) {
        $priorDispatches = @(Get-ChildItem -LiteralPath $MissionRunsDir -Filter 'dispatch-*.json' -File -ErrorAction SilentlyContinue)
    }
    if ($priorDispatches.Count -gt 0 -and -not $AllowRerun) {
        Refuse 13 ("Mission $MissionId was already dispatched (" + $priorDispatches.Count + " prior dispatch record(s)). Pass -AllowRerun to explicitly re-run.")
    }

    # ---- Display exact scope before execution ----
    $TriggerStamp = Get-Date -Format 'yyyyMMddTHHmmss'
    $TriggerId = "T-$TriggerStamp"
    Write-Host "=== Claudito dispatch v$DispatcherVersion ==="
    Write-Host "Trigger ID:    $TriggerId"
    Write-Host "Dispatched by: $DispatchedBy"
    Write-Host "Mission ID:    $MissionId"
    Write-Host "Mission file:  $MissionPath"
    Write-Host "Requester:     $Requester"
    Write-Host "Approval:      $ApprovalValue"
    Write-Host "Objective:     $Objective"
    Write-Host "Allowed scope:"
    Write-Host ($Scope -replace '(?m)^', '  ')
    Write-Host "Forbidden actions:"
    Write-Host ($Forbidden -replace '(?m)^', '  ')

    # ---- Hand off to the adapter: only the approved mission file, nothing else ----
    New-Item -ItemType Directory -Force -Path $MissionRunsDir | Out-Null
    $AdapterConsoleFile = Join-Path $MissionRunsDir "dispatch-$TriggerStamp-adapter-console.txt"
    $CommandLine = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$AdapterPath`" -MissionFile `"$MissionPath`""
    Write-Host ""
    Write-Host "Invoking adapter: $CommandLine"
    $StartTime = Get-Date -Format o
    $AdapterOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $AdapterPath -MissionFile $MissionPath 2>&1 | Out-String
    $AdapterExit = $LASTEXITCODE
    $EndTime = Get-Date -Format o
    $AdapterOutput | Out-File -LiteralPath $AdapterConsoleFile -Encoding utf8

    # Pull artifact locations out of the adapter's console report
    $RunDir = $null; $ReceiptPath = $null
    if ($AdapterOutput -match '(?m)^Run artifacts:\s*(.+?)\s*$') { $RunDir = $Matches[1] }
    if ($AdapterOutput -match '(?m)^Receipt:\s*(.+?)\s*$') { $ReceiptPath = $Matches[1] }

    # ---- Durable trigger record ----
    $DispatchRecord = [ordered]@{
        triggerId          = $TriggerId
        dispatcherVersion  = $DispatcherVersion
        missionId          = $MissionId
        missionFile        = $MissionPath
        requester          = $Requester
        dispatchedBy       = $DispatchedBy
        approvalLine       = $ApprovalValue
        command            = $CommandLine
        workingDirectory   = $WorkspaceRoot
        startTime          = $StartTime
        endTime            = $EndTime
        adapterExitCode    = $AdapterExit
        adapterConsoleFile = $AdapterConsoleFile
        runDir             = $RunDir
        receiptPath        = $ReceiptPath
        duplicateGuard     = [ordered]@{ priorDispatches = $priorDispatches.Count; allowRerun = [bool]$AllowRerun }
        gitActions         = 'none - git is never invoked by the dispatcher or adapter'
        failures           = if ($AdapterExit -eq 0) { 'none' } else { "adapter exit $AdapterExit; see adapter console and run artifacts" }
    }
    $DispatchRecordFile = Join-Path $MissionRunsDir "dispatch-$TriggerStamp.json"
    $DispatchRecord | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $DispatchRecordFile -Encoding utf8

    # ---- Machine-readable result, honest status, exit passthrough ----
    $ResultJson = (@{ triggerId = $TriggerId; missionId = $MissionId; adapterExit = $AdapterExit; dispatchRecord = $DispatchRecordFile; receipt = $ReceiptPath } | ConvertTo-Json -Compress)
    Write-Host ""
    Write-Host "Dispatch record: $DispatchRecordFile"
    Write-Host "RESULT_JSON: $ResultJson"
    if ($AdapterExit -eq 0) {
        Write-Host "DISPATCH RESULT: done (adapter exit 0)"
    }
    else {
        Write-Host "DISPATCH RESULT: FAILED/REFUSED downstream (adapter exit $AdapterExit). Nothing is claimed as success."
    }
    exit $AdapterExit
}
catch {
    Write-Host "DISPATCHER ERROR (exit 11): $($_.Exception.Message)"
    exit 11
}
finally {
    Remove-Item Env:CLAUDITO_DISPATCH_ACTIVE -ErrorAction SilentlyContinue
}
