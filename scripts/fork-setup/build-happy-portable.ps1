[CmdletBinding()]
param(
    [string]$OutputRoot,
    [string]$ResultPath,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'The Happy portable artifact builder supports Windows only.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$helper = Join-Path $repoRoot 'packages\happy-cli\scripts\portable-artifact.cjs'
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
& node $helper assert-output --repoRoot $repoRoot --target $OutputRoot
if ($LASTEXITCODE -ne 0) {
    throw 'OutputRoot failed the resolved-path and reparse-component guard.'
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
$deleteResult = $false
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $ResultPath = Join-Path $OutputRoot (
        '.build-result-{0}-{1}.json' -f $PID, [Guid]::NewGuid().ToString('N')
    )
    $deleteResult = $true
} elseif (-not [IO.Path]::IsPathRooted($ResultPath)) {
    $ResultPath = Join-Path $OutputRoot $ResultPath
}
$ResultPath = [IO.Path]::GetFullPath($ResultPath)
$resultPrefix = $OutputRoot.TrimEnd('\') + '\'
if (-not $ResultPath.StartsWith($resultPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ResultPath must be inside OutputRoot.'
}
& node $helper assert-output --repoRoot $repoRoot --target $ResultPath
if ($LASTEXITCODE -ne 0) {
    throw 'ResultPath failed the resolved-path and reparse-component guard.'
}
if (Test-Path -LiteralPath $ResultPath) {
    throw 'ResultPath must not already exist.'
}

try {
    & node $helper build --repoRoot $repoRoot --outputRoot $OutputRoot --resultPath $ResultPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Portable artifact build failed.'
    }
    if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf)) {
        throw 'Builder completed without an exact structured result.'
    }
    $result = Get-Content -Raw -LiteralPath $ResultPath | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($result.artifactRoot) -or
        [string]::IsNullOrWhiteSpace($result.artifactId)) {
        throw 'Builder result is missing its artifact identity.'
    }
    & node $helper assert-output --repoRoot $repoRoot --target $result.artifactRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Builder returned an unsafe artifact path.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $result.artifactRoot 'COMPLETE.json') -PathType Leaf)) {
        throw 'Builder returned an artifact without COMPLETE.json.'
    }

    Write-Host "Happy portable artifact: $($result.artifactRoot)"
    Write-Host "Archive bytes: $($result.archive.length)"
    Write-Host "Payload files: $($result.archive.fileCount)"
    Write-Host 'Local staging only; no publish or OneDrive write was attempted.'
    Write-Output ('HAPPY_PORTABLE_RESULT=' + ($result | ConvertTo-Json -Compress -Depth 8))
} finally {
    if ($deleteResult -and (Test-Path -LiteralPath $ResultPath -PathType Leaf)) {
        & node $helper assert-output --repoRoot $repoRoot --target $ResultPath
        if ($LASTEXITCODE -eq 0) {
            Remove-Item -Force -LiteralPath $ResultPath
        }
    }
}
