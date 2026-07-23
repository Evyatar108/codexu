[CmdletBinding()]
param(
    [switch]$FullBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'The Happy portable artifact tests support Windows only.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$helper = Join-Path $repoRoot 'packages\happy-cli\scripts\portable-artifact.cjs'
$zipHelper = Join-Path $repoRoot 'packages\happy-cli\scripts\portable-zip.ps1'
$builder = Join-Path $repoRoot 'scripts\fork-setup\build-happy-portable.ps1'
$outputRoot = Join-Path $repoRoot '.test-output\happy-portable'
$testRoot = Join-Path $repoRoot '.test-output\happy-portable-tests'

$source = Get-Content -Raw $builder
$source += Get-Content -Raw $helper
$forbiddenOperations = @(
    'Copy-Item *OneDrive',
    'Publish-EvCopilotHappy',
    'git push',
    'npm publish',
    'pnpm publish',
    'gh release',
    'New-Item *\$PROFILE',
    'Set-Content *\$PROFILE'
)
foreach ($pattern in $forbiddenOperations) {
    if ($source -match $pattern) {
        throw "Forbidden builder operation found: $pattern"
    }
}

& node $helper test-paths
if ($LASTEXITCODE -ne 0) {
    throw 'ZIP path fixture tests failed.'
}
& pwsh -NoProfile -ExecutionPolicy Bypass -File $zipHelper -TestPaths
if ($LASTEXITCODE -ne 0) {
    throw 'PowerShell ZIP path fixture tests failed.'
}

$builderBytes = [IO.File]::ReadAllBytes($builder)
$helperBytes = [IO.File]::ReadAllBytes($helper)
$zipHelperBytes = [IO.File]::ReadAllBytes($zipHelper)
if (@($builderBytes + $helperBytes + $zipHelperBytes | Where-Object { $_ -gt 127 }).Count -ne 0) {
    throw 'Portable artifact scripts must remain ASCII-only.'
}

if ($FullBuild) {
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $builder -OutputRoot $outputRoot -SkipDependencyInstall
    if ($LASTEXITCODE -ne 0) {
        throw 'Full portable artifact build failed.'
    }
}

$artifact = Get-ChildItem -Directory $outputRoot -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'COMPLETE.json') } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $artifact) {
    throw 'No completed local artifact is available. Re-run with -FullBuild.'
}

if (Test-Path $testRoot) {
    Remove-Item -Recurse -Force $testRoot
}
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
& node $helper verify --artifactRoot $artifact.FullName --extractionRoot (Join-Path $testRoot 'extracted')
if ($LASTEXITCODE -ne 0) {
    throw 'Artifact metadata/archive verification failed.'
}

$manifest = Get-Content -Raw (Join-Path $artifact.FullName 'manifest.json') | ConvertFrom-Json
$complete = Get-Content -Raw (Join-Path $artifact.FullName 'COMPLETE.json') | ConvertFrom-Json
$report = Get-Content -Raw (Join-Path $artifact.FullName 'build-report.json') | ConvertFrom-Json
$sbom = Get-Content -Raw (Join-Path $artifact.FullName 'sbom.spdx.json') | ConvertFrom-Json
$licenses = Get-Content -Raw (Join-Path $artifact.FullName 'licenses.json') | ConvertFrom-Json

if ($manifest.files.Count -ne $manifest.archive.fileCount) {
    throw 'Manifest file inventory count is inconsistent.'
}
if ($manifest.files.relativePath | Where-Object { -not $_.StartsWith('payload/') }) {
    throw 'Manifest contains a path outside payload/.'
}
if ($manifest.files.sha256 | Where-Object { $_ -cnotmatch '^[0-9A-F]{64}$' }) {
    throw 'Manifest contains a non-canonical SHA-256.'
}
if ($complete.manifestSha256 -cnotmatch '^[0-9A-F]{64}$') {
    throw 'Completion marker has a non-canonical manifest SHA-256.'
}
if ($sbom.spdxVersion -ne 'SPDX-2.3' -or $sbom.packages.Count -eq 0) {
    throw 'SPDX package inventory is missing or malformed.'
}
if ($licenses.packages.Count -eq 0) {
    throw 'License inventory is missing.'
}
if (-not $report.localOnly -or $report.publishAttempted -or $report.oneDriveWritten) {
    throw 'Build report does not prove local-only behavior.'
}

$badFiles = Get-ChildItem -Recurse -Force -File (Join-Path $testRoot 'extracted') |
    Where-Object {
        $_.Name -match '^\.env($|\.)|\.log$|\.(test|spec)\.[^.]+$' -or
        $_.FullName -match '[\\/](test|tests|__tests__|fixtures|__fixtures__|coverage|\.cache)[\\/]'
    }
if ($badFiles) {
    throw "Forbidden extracted content found: $($badFiles[0].FullName)"
}

Write-Host 'Portable artifact validation passed.'
Write-Host "Artifact: $($artifact.FullName)"
Write-Host "Archive bytes: $($manifest.archive.length)"
Write-Host "Payload files: $($manifest.archive.fileCount)"
