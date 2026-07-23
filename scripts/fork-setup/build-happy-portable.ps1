[CmdletBinding()]
param(
    [string]$OutputRoot,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'The Happy portable artifact builder supports Windows only.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot '.test-output\happy-portable'
} elseif (-not [IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot $OutputRoot
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if (-not $OutputRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot must be inside this repository worktree.'
}
foreach ($name in @('OneDrive', 'OneDriveCommercial', 'OneDriveConsumer')) {
    $oneDriveRoot = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($oneDriveRoot)) {
        $oneDrivePrefix = [IO.Path]::GetFullPath($oneDriveRoot).TrimEnd('\') + '\'
        if ($OutputRoot.StartsWith($oneDrivePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'OutputRoot must not be inside OneDrive.'
        }
    }
}

$status = & git -C $repoRoot status --porcelain=v1 --untracked-files=all
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the source worktree.'
}
if ($status) {
    throw 'The source commit must be clean before building the portable artifact.'
}

if (-not $SkipDependencyInstall) {
    & pnpm -C $repoRoot install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        throw 'pnpm install --frozen-lockfile failed.'
    }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$helper = Join-Path $repoRoot 'packages\happy-cli\scripts\portable-artifact.cjs'
& node $helper build --repoRoot $repoRoot --outputRoot $OutputRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Portable artifact build failed.'
}

$artifact = Get-ChildItem -Directory $OutputRoot |
    Where-Object { Test-Path (Join-Path $_.FullName 'COMPLETE.json') } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $artifact) {
    throw 'Builder completed without a COMPLETE artifact.'
}

$report = Get-Content -Raw (Join-Path $artifact.FullName 'build-report.json') | ConvertFrom-Json
Write-Host "Happy portable artifact: $($artifact.FullName)"
Write-Host "Archive bytes: $($report.archive.length)"
Write-Host "Payload files: $($report.archive.fileCount)"
Write-Host 'Local staging only; no publish or OneDrive write was attempted.'
