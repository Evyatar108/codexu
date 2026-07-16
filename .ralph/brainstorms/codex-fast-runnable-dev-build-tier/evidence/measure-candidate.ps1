param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,

    [string]$Profile = "dev-small",

    [string]$TargetDir = "D:\codex-targets\frdbt-dev-small-inc",

    [ValidateSet(0, 1)]
    [int]$Incremental = 1,

    [switch]$UseSccache,

    [string]$SccacheDir = "D:\codex-sccache-frdbt",

    [switch]$ProbeCore,

    [switch]$ProbeHighFanout,

    [switch]$SmokeChangedArtifact
)

$ErrorActionPreference = "Stop"

$evidenceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$brainstormDir = Split-Path -Parent $evidenceDir
$worktree = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $brainstormDir))
$codexRoot = Join-Path $worktree "codex"
$workspace = Join-Path $codexRoot "external\repos\codex-patched\codex-rs"
$probePath = $null
$probeKind = $null
$probeFrom = $null
$probeTo = $null
if ($ProbeCore -and $ProbeHighFanout) {
    throw "Select at most one probe."
}
if ($SmokeChangedArtifact -and -not ($ProbeCore -or $ProbeHighFanout)) {
    throw "SmokeChangedArtifact requires a source probe."
}
if ($ProbeCore) {
    $probePath = Join-Path $workspace "core\src\session_prefix.rs"
    $probeKind = "semantics-preserving low-fanout core edit"
    $probeFrom = '        None => format!("- {agent_reference}"),'
    $probeTo = '        None => ["- ", agent_reference].concat(),'
} elseif ($ProbeHighFanout) {
    $probePath = Join-Path $workspace "core\src\config\mod.rs"
    $probeKind = "public high-fanout core metadata/codegen edit"
    $probeFrom = '    pub fn legacy_sandbox_policy(&self) -> SandboxPolicy {'
    $probeTo = "    #[inline]`n    pub fn legacy_sandbox_policy(&self) -> SandboxPolicy {"
}
$probeEnabled = $ProbeCore -or $ProbeHighFanout

function Remove-EnvironmentFamily {
    param([string[]]$Patterns)

    Get-ChildItem Env: | ForEach-Object {
        $name = $_.Name
        foreach ($pattern in $Patterns) {
            if ($name -like $pattern) {
                Remove-Item "Env:$name" -ErrorAction SilentlyContinue
                break
            }
        }
    }
}

function Invoke-CargoBuild {
    param(
        [string]$OutputStem
    )

    $stdoutPath = Join-Path $evidenceDir "$OutputStem.cargo.jsonl"
    $stderrPath = Join-Path $evidenceDir "$OutputStem.cargo.stderr.log"
    $arguments = @(
        "build",
        "--locked",
        "-vv",
        "--profile", $Profile,
        "-p", "codex-cli",
        "--bin", "codex-core",
        "-p", "codex-copilot-launcher",
        "--bin", "codex",
        "--timings",
        "--message-format=json-render-diagnostics"
    )

    $startedAt = [DateTime]::UtcNow
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process `
        -FilePath "cargo.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $workspace `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -NoNewWindow `
        -Wait `
        -PassThru
    $stopwatch.Stop()
    $finishedAt = [DateTime]::UtcNow

    $timingsSource = Join-Path $TargetDir "cargo-timings\cargo-timing.html"
    $timingsDestination = Join-Path $evidenceDir "$OutputStem.cargo-timing.html"
    if (Test-Path $timingsSource) {
        Copy-Item $timingsSource $timingsDestination -Force
    }

    return [ordered]@{
        startedAt = $startedAt.ToString("o")
        finishedAt = $finishedAt.ToString("o")
        wallSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        exitCode = $process.ExitCode
        stdout = [IO.Path]::GetFileName($stdoutPath)
        stderr = [IO.Path]::GetFileName($stderrPath)
        timings = if (Test-Path $timingsDestination) {
            [IO.Path]::GetFileName($timingsDestination)
        } else {
            $null
        }
        argv = @("cargo") + $arguments
    }
}

function Get-BinaryEvidence {
    $profileDir = Join-Path $TargetDir $Profile
    $launcher = Join-Path $profileDir "codex.exe"
    $core = Join-Path $profileDir "codex-core.exe"

    return [ordered]@{
        profileDir = $profileDir
        launcher = if (Test-Path $launcher) {
            [ordered]@{
                path = $launcher
                bytes = (Get-Item $launcher).Length
                sha256 = (Get-FileHash $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
                lastWriteTimeUtc = (Get-Item $launcher).LastWriteTimeUtc.ToString("o")
            }
        } else {
            $null
        }
        core = if (Test-Path $core) {
            [ordered]@{
                path = $core
                bytes = (Get-Item $core).Length
                sha256 = (Get-FileHash $core -Algorithm SHA256).Hash.ToLowerInvariant()
                lastWriteTimeUtc = (Get-Item $core).LastWriteTimeUtc.ToString("o")
            }
        } else {
            $null
        }
    }
}

function Get-DirectoryBytes {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return 0
    }

    return (Get-ChildItem $Path -Recurse -Force -File | Measure-Object Length -Sum).Sum
}

Remove-EnvironmentFamily @(
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_TARGET_*_RUSTFLAGS",
    "RUSTC",
    "CARGO_BUILD_RUSTC",
    "RUSTC_BOOTSTRAP",
    "CARGO_BUILD_TARGET",
    "CARGO_BUILD_TARGET_DIR",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
    "SCCACHE_*",
    "CARGO_PROFILE_*"
)

$env:PATH = "C:\Program Files\LLVM\bin;$env:PATH"
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc"
$env:CC = "clang-cl"
$env:CXX = "clang-cl"
$env:AR = "llvm-lib"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = "lld-link"
$env:CARGO_TARGET_DIR = $TargetDir
$env:CARGO_INCREMENTAL = [string]$Incremental
$env:CARGO_BUILD_JOBS = "8"

$xwin = Join-Path $HOME ".xwin"
$env:LIB = @(
    (Join-Path $xwin "crt\lib\x86_64"),
    (Join-Path $xwin "sdk\lib\um\x86_64"),
    (Join-Path $xwin "sdk\lib\ucrt\x86_64")
) -join ";"
$env:INCLUDE = @(
    (Join-Path $xwin "crt\include"),
    (Join-Path $xwin "sdk\include\ucrt"),
    (Join-Path $xwin "sdk\include\um"),
    (Join-Path $xwin "sdk\include\shared")
) -join ";"

$cargoToml = Get-Content (Join-Path $workspace "Cargo.toml") -Raw
$v8Match = [regex]::Match($cargoToml, '(?m)^v8\s*=\s*"=([^"]+)"')
if (-not $v8Match.Success) {
    throw "Unable to parse the workspace v8 version."
}
$env:RUSTY_V8_ARCHIVE = Join-Path $HOME ".cargo\.rusty_v8\rusty_v8_release_x86_64-pc-windows-msvc_v$($v8Match.Groups[1].Value).lib"

if ($UseSccache) {
    $env:RUSTC_WRAPPER = "sccache"
    $env:SCCACHE_DIR = $SccacheDir
    $env:SCCACHE_CACHE_SIZE = "50G"
}

$required = @(
    "C:\Program Files\LLVM\bin\clang-cl.exe",
    "C:\Program Files\LLVM\bin\lld-link.exe",
    (Join-Path $xwin "crt"),
    (Join-Path $xwin "sdk"),
    $env:RUSTY_V8_ARCHIVE
)
$missing = @($required | Where-Object { -not (Test-Path $_) })
if ($missing.Count -gt 0) {
    throw "Missing build prerequisites: $($missing -join ', ')"
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$beforeStatus = (& git -C $workspace status --porcelain) -join "`n"
$beforeTargetBytes = Get-DirectoryBytes $TargetDir
$probe = $null
$measured = $null
$reconciliation = $null
$measuredExit = 1
$reconciliationExit = 0
$measuredBinaryEvidence = $null
$changedArtifactSmoke = $null

if ($probeEnabled) {
    $originalBytes = [IO.File]::ReadAllBytes($probePath)
    $originalText = [Text.Encoding]::UTF8.GetString($originalBytes)
    $originalItem = Get-Item $probePath
    $originalMtime = $originalItem.LastWriteTimeUtc
    $originalAttributes = $originalItem.Attributes
    $originalHash = (Get-FileHash $probePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $matchCount = ([regex]::Matches($originalText, [regex]::Escape($probeFrom))).Count
    if ($matchCount -ne 1) {
        throw "Expected exactly one probe match, found $matchCount."
    }
    $editedText = $originalText.Replace($probeFrom, $probeTo)
    $editedBytes = [Text.UTF8Encoding]::new($false).GetBytes($editedText)

    try {
        [IO.File]::WriteAllBytes($probePath, $editedBytes)

        $probe = [ordered]@{
            path = $probePath
            kind = $probeKind
            replacement = [ordered]@{
                from = $probeFrom
                to = $probeTo
            }
            originalSha256 = $originalHash
            probeSha256 = (Get-FileHash $probePath -Algorithm SHA256).Hash.ToLowerInvariant()
            originalLastWriteTimeUtc = $originalMtime.ToString("o")
        }
        $measured = Invoke-CargoBuild $RunId
        $measuredExit = $measured.exitCode
        $measuredBinaryEvidence = Get-BinaryEvidence
        if ($SmokeChangedArtifact -and $measuredExit -eq 0) {
            $smokePrefix = "$RunId.changed-smoke"
            $smokeScript = Join-Path $evidenceDir "smoke-candidate.ps1"
            & $smokeScript `
                -Profile $Profile `
                -TargetDir $TargetDir `
                -OutputPrefix $smokePrefix `
                -Authenticated
            $changedArtifactSmoke = "$smokePrefix-results.json"
        }
    } finally {
        [IO.File]::WriteAllBytes($probePath, $originalBytes)
        (Get-Item $probePath).Attributes = $originalAttributes
        (Get-Item $probePath).LastWriteTimeUtc = $originalMtime
    }

    $restoredHash = (Get-FileHash $probePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($restoredHash -ne $originalHash) {
        throw "Probe restoration hash mismatch."
    }

    (Get-Item $probePath).LastWriteTimeUtc = [DateTime]::UtcNow
    try {
        $reconciliation = Invoke-CargoBuild "$RunId.reconcile"
        $reconciliationExit = $reconciliation.exitCode
    } finally {
        (Get-Item $probePath).LastWriteTimeUtc = $originalMtime
    }
} else {
    $measured = Invoke-CargoBuild $RunId
    $measuredExit = $measured.exitCode
    $measuredBinaryEvidence = Get-BinaryEvidence
}

$afterStatus = (& git -C $workspace status --porcelain) -join "`n"
$finalBinaryEvidence = Get-BinaryEvidence
$afterTargetBytes = Get-DirectoryBytes $TargetDir
$result = [ordered]@{
    schemaVersion = 1
    runId = $RunId
    repository = [ordered]@{
        codexWrapper = (& git -C $codexRoot rev-parse HEAD).Trim()
        patchedCodex = (& git -C $workspace rev-parse HEAD).Trim()
        beforeStatus = $beforeStatus
        afterStatus = $afterStatus
    }
    candidate = [ordered]@{
        profile = $Profile
        targetDir = $TargetDir
        incremental = $Incremental
        sccache = [bool]$UseSccache
        sccacheDir = if ($UseSccache) { $SccacheDir } else { $null }
        lto = "off (dev profile default)"
        jobs = 8
        packageBins = @(
            "codex-cli/codex-core",
            "codex-copilot-launcher/codex"
        )
    }
    environment = [ordered]@{
        cargo = (& cargo -V).Trim()
        rustc = (& rustc -V).Trim()
        clangCl = (& clang-cl --version | Select-Object -First 1).Trim()
        linker = "lld-link"
        rustyV8Archive = $env:RUSTY_V8_ARCHIVE
        lib = $env:LIB
        include = $env:INCLUDE
    }
    target = [ordered]@{
        bytesBefore = $beforeTargetBytes
        bytesAfter = $afterTargetBytes
    }
    probe = $probe
    changedArtifactSmoke = $changedArtifactSmoke
    measured = $measured
    reconciliation = $reconciliation
    binaries = [ordered]@{
        measured = $measuredBinaryEvidence
        final = $finalBinaryEvidence
    }
}

$json = $result | ConvertTo-Json -Depth 20
$jsonPath = Join-Path $evidenceDir "$RunId.json"
[IO.File]::WriteAllText($jsonPath, $json + "`n", [Text.UTF8Encoding]::new($false))

if ($beforeStatus -ne $afterStatus) {
    throw "Nested repository status changed during measurement."
}
if ($measuredExit -ne 0) {
    exit $measuredExit
}
if ($reconciliationExit -ne 0) {
    exit $reconciliationExit
}
