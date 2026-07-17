param(
    [Parameter(Mandatory = $true)]
    [string]$RunId,

    [string]$Profile = "dev-small",

    [Parameter(Mandatory = $true)]
    [string]$TargetDir,

    [ValidateSet(0, 1)]
    [int]$Incremental = 1,

    [ValidateSet("normal", "very-verbose")]
    [string]$Verbosity = "normal",

    [string]$RawEvidenceRoot = "D:\codex-targets\frdbt-evidence\audit-20260716",

    [switch]$UseSccache,

    [string]$SccacheDir = "D:\codex-sccache-frdbt",

    [switch]$ProbeCore,

    [switch]$ProbeHighFanout,

    [switch]$SmokeBuiltArtifact
)

$ErrorActionPreference = "Stop"

$evidenceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$brainstormDir = Split-Path -Parent $evidenceDir
$worktree = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $brainstormDir))
$codexRoot = Join-Path $worktree "codex"
$workspace = Join-Path $codexRoot "external\repos\codex-patched\codex-rs"
$resultsDir = Join-Path $evidenceDir "runs"
$smokeDir = Join-Path $evidenceDir "smoke"
$rawRunDir = Join-Path $RawEvidenceRoot $RunId
$scriptPath = $MyInvocation.MyCommand.Path
$scriptSha256 = (Get-FileHash $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
$driverArguments = @(
    $scriptPath,
    "-RunId", $RunId,
    "-Profile", $Profile,
    "-TargetDir", $TargetDir,
    "-Incremental", [string]$Incremental,
    "-Verbosity", $Verbosity,
    "-RawEvidenceRoot", $RawEvidenceRoot,
    "-SccacheDir", $SccacheDir
)
if ($UseSccache) {
    $driverArguments += "-UseSccache"
}
if ($ProbeCore) {
    $driverArguments += "-ProbeCore"
}
if ($ProbeHighFanout) {
    $driverArguments += "-ProbeHighFanout"
}
if ($SmokeBuiltArtifact) {
    $driverArguments += "-SmokeBuiltArtifact"
}
$powerShellProvenance = [ordered]@{
    executable = [Environment]::ProcessPath
    processCommandLine = [Environment]::CommandLine
    processArgv = [Environment]::GetCommandLineArgs()
    effectiveDriverArgv = @([Environment]::ProcessPath) + $driverArguments
    version = $PSVersionTable.PSVersion.ToString()
    edition = $PSVersionTable.PSEdition
    platform = $PSVersionTable.Platform
    os = $PSVersionTable.OS
    culture = [Globalization.CultureInfo]::CurrentCulture.Name
    uiCulture = [Globalization.CultureInfo]::CurrentUICulture.Name
    timeZone = [ordered]@{
        id = [TimeZoneInfo]::Local.Id
        baseUtcOffset = [TimeZoneInfo]::Local.BaseUtcOffset.ToString()
    }
}
$clearedEnvironmentPatterns = @(
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

if ($ProbeCore -and $ProbeHighFanout) {
    throw "Select at most one probe."
}
if (Test-Path $rawRunDir) {
    throw "Raw evidence directory already exists: $rawRunDir"
}

$probePath = $null
$probeKind = $null
$probeFrom = $null
$probeTo = $null
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

function Get-DirectoryStats {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return [ordered]@{
            path = $Path
            bytes = 0
            files = 0
        }
    }

    $measure = Get-ChildItem $Path -Recurse -Force -File | Measure-Object Length -Sum
    return [ordered]@{
        path = $Path
        bytes = [long]($measure.Sum ?? 0)
        files = [int]$measure.Count
    }
}

function Get-TargetStats {
    $profileDir = Join-Path $TargetDir $Profile
    return [ordered]@{
        target = Get-DirectoryStats $TargetDir
        profile = Get-DirectoryStats $profileDir
        incremental = Get-DirectoryStats (Join-Path $profileDir "incremental")
        deps = Get-DirectoryStats (Join-Path $profileDir "deps")
        build = Get-DirectoryStats (Join-Path $profileDir "build")
        fingerprint = Get-DirectoryStats (Join-Path $profileDir ".fingerprint")
    }
}

function Convert-ToUtcInstant {
    param($Value)

    if ($Value -is [DateTime]) {
        return [DateTimeOffset]::new($Value.ToUniversalTime())
    }

    return [DateTimeOffset]::Parse(
        [string]$Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    )
}

function Get-FileEvidence {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }
    $item = Get-Item $Path
    return [ordered]@{
        path = $item.FullName
        bytes = [long]$item.Length
        sha256 = (Get-FileHash $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-CargoSummary {
    param([string]$Path)

    $rebuiltPackages = [Collections.Generic.HashSet[string]]::new()
    $workspacePackages = [Collections.Generic.HashSet[string]]::new()
    $executables = [Collections.Generic.HashSet[string]]::new()
    $rebuiltTargets = 0
    $parseErrors = 0
    $buildFinished = $null

    Get-Content $Path | ForEach-Object {
        try {
            $event = $_ | ConvertFrom-Json
        } catch {
            $parseErrors++
            return
        }

        if ($event.reason -eq "compiler-artifact" -and -not $event.fresh) {
            $rebuiltTargets++
            if ($event.package_id) {
                [void]$rebuiltPackages.Add([string]$event.package_id)
                if ([string]$event.package_id -like "path+file:///C:/efforts/codexu/*") {
                    [void]$workspacePackages.Add([string]$event.package_id)
                }
            }
            if ($event.executable) {
                [void]$executables.Add([string]$event.executable)
            }
        } elseif ($event.reason -eq "build-finished") {
            $buildFinished = $event
        }
    }

    return [ordered]@{
        parseErrors = $parseErrors
        rebuiltPackageCount = $rebuiltPackages.Count
        rebuiltWorkspacePackages = @($workspacePackages | Sort-Object)
        rebuiltTargetCount = $rebuiltTargets
        rebuiltExecutables = @($executables | Sort-Object)
        buildFinished = $buildFinished
    }
}

function Get-BinaryEvidence {
    $profileDir = Join-Path $TargetDir $Profile
    $launcher = Join-Path $profileDir "codex.exe"
    $core = Join-Path $profileDir "codex-core.exe"

    return [ordered]@{
        profileDir = $profileDir
        launcher = Get-FileEvidence $launcher
        core = Get-FileEvidence $core
    }
}

function Invoke-CargoBuild {
    param([string]$Phase)

    $stdoutPath = Join-Path $rawRunDir "$Phase.cargo.jsonl"
    $stderrPath = Join-Path $rawRunDir "$Phase.cargo.stderr.log"
    $timingsDestination = Join-Path $rawRunDir "$Phase.cargo-timing.html"
    $arguments = @("build", "--locked")
    if ($Verbosity -eq "very-verbose") {
        $arguments += "-vv"
    }
    $arguments += @(
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
    if (Test-Path $timingsSource) {
        Copy-Item $timingsSource $timingsDestination -Force
    }

    return [ordered]@{
        phase = $Phase
        startedAt = $startedAt.ToString("o")
        finishedAt = $finishedAt.ToString("o")
        wallSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        exitCode = $process.ExitCode
        cwd = $workspace
        argv = @("cargo") + $arguments
        cargo = Get-CargoSummary $stdoutPath
        rawArtifacts = [ordered]@{
            stdout = Get-FileEvidence $stdoutPath
            stderr = Get-FileEvidence $stderrPath
            timings = Get-FileEvidence $timingsDestination
        }
    }
}

function Invoke-BuiltArtifactSmoke {
    $smokeScript = Join-Path $evidenceDir "smoke-candidate.ps1"
    & $smokeScript `
        -Profile $Profile `
        -TargetDir $TargetDir `
        -OutputDir $smokeDir `
        -OutputPrefix $RunId `
        -Mode "minimal" `
        -Authenticated
    return Join-Path $smokeDir "$RunId-results.json"
}

Remove-EnvironmentFamily $clearedEnvironmentPatterns

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

New-Item -ItemType Directory -Force -Path $resultsDir, $smokeDir, $rawRunDir, $TargetDir | Out-Null

$controlledEnvironment = [ordered]@{
    PATHPrefix = "C:\Program Files\LLVM\bin"
    RUSTUP_TOOLCHAIN = $env:RUSTUP_TOOLCHAIN
    CC = $env:CC
    CXX = $env:CXX
    AR = $env:AR
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER
    CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR
    CARGO_INCREMENTAL = $env:CARGO_INCREMENTAL
    CARGO_BUILD_JOBS = $env:CARGO_BUILD_JOBS
    RUSTY_V8_ARCHIVE = $env:RUSTY_V8_ARCHIVE
    LIB = $env:LIB
    INCLUDE = $env:INCLUDE
    RUSTC_WRAPPER = if ($UseSccache) { $env:RUSTC_WRAPPER } else { $null }
    SCCACHE_DIR = if ($UseSccache) { $env:SCCACHE_DIR } else { $null }
    SCCACHE_CACHE_SIZE = if ($UseSccache) { $env:SCCACHE_CACHE_SIZE } else { $null }
}

$beforeStatus = (& git -C $workspace status --porcelain) -join "`n"
$beforeTarget = Get-TargetStats
$probe = $null
$measured = $null
$reconciliation = $null
$measuredExit = 1
$reconciliationExit = 0
$measuredBinaries = $null
$smokePath = $null

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
        $measured = Invoke-CargoBuild "measured"
        $measuredExit = $measured.exitCode
        $measuredBinaries = Get-BinaryEvidence
        if ($SmokeBuiltArtifact -and $measuredExit -eq 0) {
            $smokePath = Invoke-BuiltArtifactSmoke
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
        $reconciliation = Invoke-CargoBuild "reconcile"
        $reconciliationExit = $reconciliation.exitCode
    } finally {
        (Get-Item $probePath).LastWriteTimeUtc = $originalMtime
    }
} else {
    $measured = Invoke-CargoBuild "measured"
    $measuredExit = $measured.exitCode
    $measuredBinaries = Get-BinaryEvidence
    if ($SmokeBuiltArtifact -and $measuredExit -eq 0) {
        $smokePath = Invoke-BuiltArtifactSmoke
    }
}

$afterStatus = (& git -C $workspace status --porcelain) -join "`n"
$afterTarget = Get-TargetStats
$finalBinaries = Get-BinaryEvidence
$smoke = if ($smokePath) {
    Get-Content $smokePath -Raw | ConvertFrom-Json
} else {
    $null
}

$endToEnd = $null
if ($smoke) {
    $versionRun = $smoke.runs | Where-Object name -eq "version"
    $authRun = $smoke.runs | Where-Object name -eq "authenticated-exec"
    $toolRun = $smoke.runs | Where-Object name -eq "authenticated-tool-exec"
    $buildStart = Convert-ToUtcInstant $measured.startedAt
    $endToEnd = [ordered]@{
        buildThroughVersionSeconds = [Math]::Round(
            ((Convert-ToUtcInstant $versionRun.startedAt).AddSeconds([double]$versionRun.wallSeconds) - $buildStart).TotalSeconds,
            3
        )
        buildThroughAuthenticatedTurnSeconds = [Math]::Round(
            ((Convert-ToUtcInstant $authRun.startedAt).AddSeconds([double]$authRun.wallSeconds) - $buildStart).TotalSeconds,
            3
        )
        buildThroughShellToolTurnSeconds = [Math]::Round(
            ((Convert-ToUtcInstant $toolRun.startedAt).AddSeconds([double]$toolRun.wallSeconds) - $buildStart).TotalSeconds,
            3
        )
    }
}

$result = [ordered]@{
    schemaVersion = 2
    artifactType = "measurement-run-manifest"
    runId = $RunId
    script = [ordered]@{
        path = $scriptPath
        sha256 = $scriptSha256
    }
    invocation = [ordered]@{
        driver = $powerShellProvenance
        profile = $Profile
        targetDir = $TargetDir
        incremental = $Incremental
        verbosity = $Verbosity
        rawEvidenceRoot = $RawEvidenceRoot
        useSccache = [bool]$UseSccache
        sccacheDir = if ($UseSccache) { $SccacheDir } else { $null }
        probeCore = [bool]$ProbeCore
        probeHighFanout = [bool]$ProbeHighFanout
        smokeBuiltArtifact = [bool]$SmokeBuiltArtifact
    }
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
        lto = "off (dev profile default)"
        jobs = 8
        packageBins = @(
            "codex-cli/codex-core",
            "codex-copilot-launcher/codex"
        )
    }
    environment = [ordered]@{
        powerShell = $powerShellProvenance
        clearedPatterns = $clearedEnvironmentPatterns
        controlled = $controlledEnvironment
        cargo = (& cargo -V).Trim()
        rustc = (& rustc -V).Trim()
        clangCl = (& clang-cl --version | Select-Object -First 1).Trim()
        linker = "lld-link"
    }
    target = [ordered]@{
        before = $beforeTarget
        after = $afterTarget
    }
    probe = $probe
    measured = $measured
    smoke = if ($smokePath) {
        [ordered]@{
            resultPath = $smokePath
            resultSha256 = (Get-FileHash $smokePath -Algorithm SHA256).Hash.ToLowerInvariant()
            binaries = $smoke.binaries
            runs = $smoke.runs
        }
    } else {
        $null
    }
    endToEnd = $endToEnd
    reconciliation = $reconciliation
    binaries = [ordered]@{
        measured = $measuredBinaries
        final = $finalBinaries
    }
    rawEvidence = [ordered]@{
        root = $rawRunDir
        retention = "Retain until the implementation plan is accepted or 2026-08-15, whichever is later. Verify committed SHA-256 values before deletion."
    }
}

$jsonPath = Join-Path $resultsDir "$RunId.json"
[IO.File]::WriteAllText(
    $jsonPath,
    ($result | ConvertTo-Json -Depth 30) + "`n",
    [Text.UTF8Encoding]::new($false)
)

if ($beforeStatus -ne $afterStatus) {
    throw "Nested repository status changed during measurement."
}
if ($measuredExit -ne 0) {
    exit $measuredExit
}
if ($reconciliationExit -ne 0) {
    exit $reconciliationExit
}
