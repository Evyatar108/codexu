[CmdletBinding()]
param(
    [switch]$FullBuild,
    [string]$ArtifactRoot
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
$expectedHead = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $expectedHead -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to resolve the expected source commit.'
}

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
& node $helper test-security --repoRoot $repoRoot --testRoot (Join-Path $testRoot 'security')
if ($LASTEXITCODE -ne 0) {
    throw 'Output confinement or cleanup fixture tests failed.'
}

$builderBytes = [IO.File]::ReadAllBytes($builder)
$helperBytes = [IO.File]::ReadAllBytes($helper)
$zipHelperBytes = [IO.File]::ReadAllBytes($zipHelper)
$testBytes = [IO.File]::ReadAllBytes($PSCommandPath)
if (@($builderBytes + $helperBytes + $zipHelperBytes + $testBytes | Where-Object { $_ -gt 127 }).Count -ne 0) {
    throw 'Portable artifact scripts must remain ASCII-only.'
}

$resultPath = $null
if ($FullBuild) {
    if (-not [string]::IsNullOrWhiteSpace($ArtifactRoot)) {
        throw 'ArtifactRoot cannot be combined with FullBuild.'
    }
    $resultPath = Join-Path $outputRoot (
        '.full-build-result-{0}-{1}.json' -f $PID, [Guid]::NewGuid().ToString('N')
    )
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $builder -OutputRoot $outputRoot `
        -ResultPath $resultPath -SkipDependencyInstall
    if ($LASTEXITCODE -ne 0) {
        throw 'Full portable artifact build failed.'
    }
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw 'Full build did not return its exact result file.'
    }
    $buildResult = Get-Content -Raw -LiteralPath $resultPath | ConvertFrom-Json
    $ArtifactRoot = [string]$buildResult.artifactRoot
    if ($buildResult.sourceCommit -ne $expectedHead -or
        (Split-Path -Leaf $ArtifactRoot) -ne $buildResult.artifactId) {
        throw 'Full build result identity does not match this invocation.'
    }
} elseif ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $artifact = Get-ChildItem -Directory $outputRoot -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'COMPLETE.json') } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $artifact) {
        throw 'No completed local artifact is available. Re-run with -FullBuild or -ArtifactRoot.'
    }
    $ArtifactRoot = $artifact.FullName
}

$ArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
& node $helper assert-output --repoRoot $repoRoot --target $ArtifactRoot
if ($LASTEXITCODE -ne 0) {
    throw 'ArtifactRoot failed output confinement.'
}

try {
    if (Test-Path -LiteralPath $testRoot) {
        & node $helper cleanup-output --repoRoot $repoRoot --target $testRoot
        if ($LASTEXITCODE -ne 0) {
            throw 'Test extraction root failed safe cleanup.'
        }
    }
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    $extractedRoot = Join-Path $testRoot 'extracted'
    & node $helper verify --repoRoot $repoRoot --artifactRoot $ArtifactRoot `
        --extractionRoot $extractedRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Artifact metadata/archive verification failed.'
    }

    $manifestPath = Join-Path $ArtifactRoot 'manifest.json'
    $reportPath = Join-Path $ArtifactRoot 'build-report.json'
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $complete = Get-Content -Raw -LiteralPath (Join-Path $ArtifactRoot 'COMPLETE.json') | ConvertFrom-Json
    $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json
    $sbom = Get-Content -Raw -LiteralPath (Join-Path $ArtifactRoot 'sbom.spdx.json') | ConvertFrom-Json
    $licenses = Get-Content -Raw -LiteralPath (Join-Path $ArtifactRoot 'licenses.json') | ConvertFrom-Json

    if ($FullBuild -and $manifest.source.commit -ne $expectedHead) {
        throw 'Full build manifest source commit does not equal the expected HEAD.'
    }
    if ($manifest.artifactId -ne (Split-Path -Leaf $ArtifactRoot)) {
        throw 'Manifest artifact id does not match the exact artifact path.'
    }
    if ($manifest.files.Count -ne $manifest.archive.fileCount) {
        throw 'Manifest file inventory count is inconsistent.'
    }
    if ($manifest.files.relativePath | Where-Object { -not $_.StartsWith('payload/') }) {
        throw 'Manifest contains a path outside payload/.'
    }
    if ($manifest.files.sha256 | Where-Object { $_ -cnotmatch '^[0-9A-F]{64}$' }) {
        throw 'Manifest contains a non-canonical SHA-256.'
    }
    if ($complete.manifestSha256 -cnotmatch '^[0-9A-F]{64}$' -or
        $manifest.report.sha256 -cnotmatch '^[0-9A-F]{64}$') {
        throw 'Integrity chain contains a non-canonical SHA-256.'
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $reportPath).Hash -cne $manifest.report.sha256) {
        throw 'Manifest build-report hash binding failed.'
    }
    if ($sbom.spdxVersion -ne 'SPDX-2.3' -or $sbom.packages.Count -eq 0) {
        throw 'SPDX package inventory is missing or malformed.'
    }
    if ($licenses.packages.Count -eq 0) {
        throw 'License inventory is missing.'
    }
    $anthropic = $licenses.packages | Where-Object {
        $_.name -eq '@anthropic-ai/claude-agent-sdk'
    } | Select-Object -First 1
    if (-not $anthropic -or
        $anthropic.rawDeclared -ne 'SEE LICENSE IN README.md' -or
        $anthropic.declared -notmatch '^LicenseRef-Npm-' -or
        $anthropic.normalization -ne 'invalid-npm-declaration' -or
        -not ($anthropic.files.relativePath -match '/README\.md$')) {
        throw 'Anthropic invalid npm license fixture was not normalized with README evidence.'
    }
    $anthropicSpdx = $sbom.packages | Where-Object {
        $_.name -eq '@anthropic-ai/claude-agent-sdk'
    } | Select-Object -First 1
    if ($anthropicSpdx.licenseDeclared -ne $anthropic.declared -or
        -not ($sbom.hasExtractedLicensingInfos.licenseId -contains $anthropic.declared)) {
        throw 'Anthropic SPDX LicenseRef is missing extracted evidence.'
    }
    if (-not $report.localOnly -or $report.publishAttempted -or $report.oneDriveWritten -or
        $report.checks.machineMetadata -ne 'clean' -or
        $report.checks.reproducibleZipMetadata -ne 'clean' -or
        $report.checks.externalSmokeCleanup -ne 'clean') {
        throw 'Build report does not prove the required local-only checks.'
    }
    if (Get-ChildItem -Recurse -Force -File $extractedRoot | Where-Object {
        $_.Name -in @('.modules.yaml', '.pnpm-workspace-state-v1.json', 'lock.yaml')
    }) {
        throw 'Extracted payload retained pnpm machine metadata.'
    }
    $badFiles = Get-ChildItem -Recurse -Force -File $extractedRoot |
        Where-Object {
            $_.Name -match '^\.env($|\.)|\.log$|\.(test|spec)\.[^.]+$' -or
            $_.FullName -match '[\\/](test|tests|__tests__|fixtures|__fixtures__|coverage|\.cache)[\\/]'
        }
    if ($badFiles) {
        throw "Forbidden extracted content found: $($badFiles[0].FullName)"
    }
    if (Test-Path -LiteralPath (Join-Path $outputRoot ".external-smoke\$($manifest.artifactId)")) {
        throw 'External-smoke extraction was retained after build.'
    }
    if (Test-Path -LiteralPath (Join-Path $outputRoot ".smoke-state\$($manifest.artifactId)")) {
        throw 'External-smoke state was retained after build.'
    }

    Write-Host 'Portable artifact validation passed.'
    Write-Host "Artifact: $ArtifactRoot"
    Write-Host "Archive bytes: $($manifest.archive.length)"
    Write-Host "Payload files: $($manifest.archive.fileCount)"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        & node $helper cleanup-output --repoRoot $repoRoot --target $testRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($resultPath) -and
        (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        & node $helper assert-output --repoRoot $repoRoot --target $resultPath
        if ($LASTEXITCODE -eq 0) {
            Remove-Item -Force -LiteralPath $resultPath
        }
    }
}
