[CmdletBinding()]
param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Repository,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & git -C $Repository @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git -C $Repository $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Ensure-Remote {
    param(
        [string]$Repository,
        [string]$Name,
        [string]$Url
    )

    & git -C $Repository remote get-url $Name *> $null
    if ($LASTEXITCODE -eq 0) {
        Invoke-Git $Repository @("remote", "set-url", $Name, $Url)
    } else {
        Invoke-Git $Repository @("remote", "add", $Name, $Url)
    }
}

function Ensure-Worktree {
    param(
        [string]$Repository,
        [string]$Path,
        [string]$Branch,
        [string]$RemoteRef
    )

    if (Test-Path $Path) {
        Write-Host "Worktree already exists: $Path"
        return
    }

    & git -C $Repository show-ref --verify --quiet "refs/heads/$Branch"
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git $Repository @("branch", $Branch, $RemoteRef)
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    Invoke-Git $Repository @("worktree", "add", $Path, $Branch)
}

$root = (Resolve-Path $Root).Path
$codex = Join-Path $root "codex"
$toolkit = Join-Path $root "ai-developer-toolkit"

Invoke-Git $root @("submodule", "sync")
Invoke-Git $root @("submodule", "update", "--init", "codex", "ai-developer-toolkit")

Ensure-Remote $codex "vm-mirror" "https://github.com/evmitran_microsoft/codexu-codex.git"
Invoke-Git $codex @("fetch", "vm-mirror", "--prune")
Invoke-Git $toolkit @("fetch", "origin", "--prune")

$wrapperWorktree = Join-Path $codex ".worktrees\codex-v2-copilot-encrypted-subagent-handoff"
$buildWorktree = Join-Path $codex ".worktrees\codex-rs-core-change-incremental-build-over-30m"
$ralphReleaseWorktree = Join-Path $toolkit ".worktrees\publish-ralph-564"
$ralphHardeningWorktree = Join-Path $toolkit ".worktrees\ralph-v2-encrypted-role-wait-terminal-hardening"

Ensure-Worktree $codex $wrapperWorktree `
    "ralph/codex-v2-copilot-encrypted-subagent-handoff" `
    "vm-mirror/ralph/codex-v2-copilot-encrypted-subagent-handoff"
Ensure-Worktree $codex $buildWorktree `
    "ralph/codex-rs-core-change-incremental-build-over-30m" `
    "vm-mirror/ralph/codex-rs-core-change-incremental-build-over-30m"
Ensure-Worktree $toolkit $ralphReleaseWorktree `
    "release/ralph-564-publish" `
    "origin/release/ralph-564-publish"
Ensure-Worktree $toolkit $ralphHardeningWorktree `
    "ralph/ralph-v2-encrypted-role-wait-terminal-hardening" `
    "origin/ralph/ralph-v2-encrypted-role-wait-terminal-hardening"

Invoke-Git $wrapperWorktree @("submodule", "sync")
Invoke-Git $wrapperWorktree @(
    "config",
    "submodule.external/repos/codex-patched.url",
    "https://github.com/evmitran_microsoft/codexu-codex-patched.git"
)
Invoke-Git $wrapperWorktree @("submodule", "update", "--init", "external/repos/codex-patched")

$nested = Join-Path $wrapperWorktree "external\repos\codex-patched"
Ensure-Remote $nested "vm-mirror" "https://github.com/evmitran_microsoft/codexu-codex-patched.git"
Invoke-Git $nested @("fetch", "vm-mirror", "--prune")

$sourceBranch = "ralph/codex-v2-copilot-encrypted-subagent-handoff-source"
& git -C $nested show-ref --verify --quiet "refs/heads/$sourceBranch"
if ($LASTEXITCODE -eq 0) {
    Invoke-Git $nested @("switch", $sourceBranch)
} else {
    Invoke-Git $nested @(
        "switch",
        "--create",
        $sourceBranch,
        "--track",
        "vm-mirror/$sourceBranch"
    )
}

$nestedHead = (& git -C $nested rev-parse HEAD).Trim()
if ($nestedHead -ne "6d73e16c44d65ac243834a942d7fab2c3b279221") {
    throw "Unexpected nested source HEAD: $nestedHead"
}

Write-Host ""
Write-Host "VM workspace restored."
Write-Host "Root: $root"
Write-Host "PRD B wrapper: $wrapperWorktree"
Write-Host "PRD B nested source: $nestedHead"
Write-Host "Resume from .ralph\handoffs\2026-07-14-vm-migration-handoff.md"
