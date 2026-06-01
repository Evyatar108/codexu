<#
.SYNOPSIS
    Run a single cold-cache (or warm-cache) jobs-sweep scenario.

.DESCRIPTION
    Wipes target/ + sccache cache dir (for cold) or leaves them (for warm),
    then sources iteration-env.sh inside Git Bash with CARGO_BUILD_JOBS=$Jobs,
    and invokes scripts/measure-build.ps1 inside that bash session so cargo
    inherits the LLVM/xwin/sccache env. Captures sccache stats before/after
    and the full stdout to <JobDir>/<Scenario>.log.

.PARAMETER Scenario
    Label written into the CSV row + log filenames. e.g. "A-jobs4-cold".

.PARAMETER Jobs
    CARGO_BUILD_JOBS value to test.

.PARAMETER Cold
    Switch. If set, wipes target/release and D:\codex-sccache before the run.

.PARAMETER JobDir
    Destination directory for per-scenario artifacts. Defaults to script dir.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][int]$Jobs,
    [switch]$Cold,
    [string]$JobDir
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $JobDir) { $JobDir = $ScriptDir }

$CodexRoot   = 'D:/harness-efforts/codexu/codex'
$CodexRsDir  = "$CodexRoot/external/repos/codex-patched/codex-rs"
$BashExe     = 'C:\Program Files\Git\bin\bash.exe'
$RunId       = "bench-$Scenario-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$LogPath     = Join-Path $JobDir "$Scenario.log"
$StatsBefore = Join-Path $JobDir "$Scenario-sccache-stats-before.txt"
$StatsAfter  = Join-Path $JobDir "$Scenario-sccache-stats-after.txt"
$CsvDst      = Join-Path $JobDir "$Scenario.csv"

function Log([string]$Msg) {
    $line = "[$([DateTime]::Now.ToString('HH:mm:ss'))] $Msg"
    Write-Host $line
    Add-Content -Path $LogPath -Value $line
}

# Fresh log file.
Set-Content -Path $LogPath -Value "=== $Scenario (jobs=$Jobs, cold=$Cold) runId=$RunId ===`n"
Log "Scenario: $Scenario  Jobs: $Jobs  Cold: $Cold"
Log "Disk D free GB: $([math]::Round((Get-PSDrive D).Free / 1GB, 1))"

# Make absolutely sure no stale codex/cargo/rustc is holding files.
$stragglers = Get-Process | Where-Object { $_.ProcessName -match '^(codex|cargo|rustc|lld-link|clang-cl|link)$' }
if ($stragglers) {
    Log "WARNING: killing stragglers: $($stragglers | ForEach-Object { "$($_.Name)($($_.Id))" } | Join-String -Separator ', ')"
    $stragglers | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

if ($Cold) {
    Log "Cold cache: stopping sccache server, wiping D:\codex-sccache, wiping target/release..."
    & sccache --stop-server 2>&1 | Tee-Object -FilePath $LogPath -Append | Out-Null
    Start-Sleep -Seconds 2
    if (Test-Path 'D:\codex-sccache') {
        Remove-Item -Recurse -Force 'D:\codex-sccache' -ErrorAction SilentlyContinue
    }
    # cargo clean is faster than rm -rf for the target dir (knows what to keep).
    # But target/release alone is what we care about for the binary build.
    $targetRelease = Join-Path $CodexRsDir 'target/release'
    if (Test-Path $targetRelease) {
        Log "Removing $targetRelease ..."
        Remove-Item -Recurse -Force $targetRelease -ErrorAction SilentlyContinue
    }
    # Also wipe target/debug if it grew; saves disk.
    $targetDebug = Join-Path $CodexRsDir 'target/debug'
    if (Test-Path $targetDebug) {
        Remove-Item -Recurse -Force $targetDebug -ErrorAction SilentlyContinue
    }
    Log "Cold-cache wipe complete."
}

Log "Disk D free GB after wipe: $([math]::Round((Get-PSDrive D).Free / 1GB, 1))"

# Build the bash command. Use SINGLE-quoted here-string so bash $VAR refs
# survive untouched, then -replace tokens for the PS-side values.
$bashCmdTemplate = @'
set -e
export CARGO_BUILD_JOBS=__JOBS__
cd /d/harness-efforts/codexu/codex
source scripts/iteration-env.sh
echo '---ENV AFTER SOURCE---'
echo "CARGO_BUILD_JOBS=$CARGO_BUILD_JOBS"
echo "RUSTC_WRAPPER=$RUSTC_WRAPPER"
echo "SCCACHE_DIR=$SCCACHE_DIR"
echo "CARGO_PROFILE_RELEASE_LTO=$CARGO_PROFILE_RELEASE_LTO"
echo "CARGO_PROFILE_RELEASE_CODEGEN_UNITS=$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"
echo "PATH-first-3:"; echo "$PATH" | tr ':' '\n' | head -3
sccache --zero-stats
sccache --show-stats > '__STATSBEFORE__'
echo '---STARTING MEASURE-BUILD---'
set +e
pwsh -NoProfile -File scripts/measure-build.ps1 -Scenario '__SCENARIO__' -RunId '__RUNID__'
MB_EXIT=$?
set -e
echo "---AFTER MEASURE-BUILD (exit $MB_EXIT)---"
sccache --show-stats > '__STATSAFTER__'
sccache --show-stats
exit $MB_EXIT
'@

$bashCmd = $bashCmdTemplate `
    -replace '__JOBS__', $Jobs `
    -replace '__SCENARIO__', $Scenario `
    -replace '__RUNID__', $RunId `
    -replace '__STATSBEFORE__', ($StatsBefore -replace '\\','/') `
    -replace '__STATSAFTER__',  ($StatsAfter  -replace '\\','/')

Log "Invoking bash to run iteration-env + measure-build..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& $BashExe -c $bashCmd 2>&1 | Tee-Object -FilePath $LogPath -Append
$bashExit = $LASTEXITCODE
$sw.Stop()
Log "bash exit: $bashExit  wall-time-this-script: $([math]::Round($sw.Elapsed.TotalMinutes,2)) min"

# Copy measure-build's CSV to job dir under scenario-named file.
$mbCsv = Join-Path $CodexRoot "docs/implementation/build-perf-artifacts/$RunId.csv"
if (Test-Path $mbCsv) {
    Copy-Item -Path $mbCsv -Destination $CsvDst -Force
    Log "CSV copied: $CsvDst"
    Get-Content $CsvDst | ForEach-Object { Log "  CSV: $_" }
} else {
    Log "WARNING: expected CSV not found at $mbCsv"
}

Log "=== $Scenario DONE (exit=$bashExit) ==="
exit $bashExit
