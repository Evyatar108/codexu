param(
    [string]$Profile = "dev-small",

    [string]$TargetDir = "D:\codex-targets\frdbt-dev-small-inc",

    [string]$OutputPrefix = "smoke",

    [switch]$Authenticated
)

$ErrorActionPreference = "Stop"

$evidenceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $TargetDir $Profile
$launcher = Join-Path $profileDir "codex.exe"
$core = Join-Path $profileDir "codex-core.exe"

if (-not (Test-Path $launcher) -or -not (Test-Path $core)) {
    throw "Expected adjacent codex.exe and codex-core.exe under $profileDir."
}

Remove-Item Env:CODEX_CORE_PATH -ErrorAction SilentlyContinue

function Invoke-Smoke {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [int[]]$AcceptedExitCodes = @(0)
    )

    $stdoutPath = Join-Path $evidenceDir "$OutputPrefix-$Name.stdout.log"
    $stderrPath = Join-Path $evidenceDir "$OutputPrefix-$Name.stderr.log"
    $startedAt = [DateTime]::UtcNow
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process `
        -FilePath $launcher `
        -ArgumentList $Arguments `
        -WorkingDirectory $profileDir `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -NoNewWindow `
        -Wait `
        -PassThru
    $stopwatch.Stop()

    return [ordered]@{
        name = $Name
        argv = @($launcher) + $Arguments
        startedAt = $startedAt.ToString("o")
        wallSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        exitCode = $process.ExitCode
        accepted = $AcceptedExitCodes -contains $process.ExitCode
        acceptedExitCodes = $AcceptedExitCodes
        stdout = [IO.Path]::GetFileName($stdoutPath)
        stderr = [IO.Path]::GetFileName($stderrPath)
        stdoutBytes = (Get-Item $stdoutPath).Length
        stderrBytes = (Get-Item $stderrPath).Length
    }
}

$runs = @()
$runs += Invoke-Smoke "version" @("--version")
$runs += Invoke-Smoke "help" @("--help")
$runs += Invoke-Smoke "login-help" @("login", "--provider", "copilot", "--help")
$runs += Invoke-Smoke "bundled-models" @("debug", "models", "--bundled")
$runs += Invoke-Smoke "features-list" @("features", "list")
$runs += Invoke-Smoke "doctor-json" @("doctor", "--json") @(0, 1)

if ($Authenticated) {
    $runs += Invoke-Smoke "authenticated-exec" @(
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        '"Reply exactly FAST_RUNNABLE_OK. Do not use tools."'
    )
    $runs += Invoke-Smoke "authenticated-tool-exec" @(
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        '"Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK."'
    )
}

$imports = [ordered]@{}
foreach ($name in @("codex.exe", "codex-core.exe")) {
    $path = Join-Path $profileDir $name
    $imports[$name] = (& "C:\Program Files\LLVM\bin\llvm-readobj.exe" --coff-imports $path 2>&1) -join "`n"
}

$result = [ordered]@{
    schemaVersion = 1
    profileDir = $profileDir
    codexCorePathOverridePresent = Test-Path Env:CODEX_CORE_PATH
    binaries = [ordered]@{
        launcher = [ordered]@{
            path = $launcher
            bytes = (Get-Item $launcher).Length
            sha256 = (Get-FileHash $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        core = [ordered]@{
            path = $core
            bytes = (Get-Item $core).Length
            sha256 = (Get-FileHash $core -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    runs = $runs
    imports = $imports
}

$json = $result | ConvertTo-Json -Depth 12
$jsonPath = Join-Path $evidenceDir "$OutputPrefix-results.json"
[IO.File]::WriteAllText($jsonPath, $json + "`n", [Text.UTF8Encoding]::new($false))

$failed = @($runs | Where-Object { -not $_.accepted })
if ($failed.Count -gt 0) {
    throw "Smoke failures: $($failed.name -join ', ')"
}
