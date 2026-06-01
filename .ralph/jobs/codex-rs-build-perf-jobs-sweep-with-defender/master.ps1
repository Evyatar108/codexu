#!/usr/bin/env pwsh
<#
Master orchestrator for the jobs-sweep benchmark.

Runs scenarios sequentially. If any cold-cache scenario crosses the ≤45 min
target, optional D (jobs=12) is skipped to save wall-clock.

USAGE: pwsh -NoProfile -File master.ps1 [-Scenarios A,B,C,D,Warm]
#>
[CmdletBinding()]
param(
    [string[]]$Scenarios = @('A','B','C','D','Warm')
)
$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MasterLog = Join-Path $ScriptDir 'master.log'
function MLog([string]$Msg) {
    $line = "[master $([DateTime]::Now.ToString('HH:mm:ss'))] $Msg"
    Write-Host $line -ForegroundColor Cyan
    Add-Content -Path $MasterLog -Value $line
}

# Scenario definitions.
$defs = @{
    A    = @{ Name='A-jobs4-cold';  Jobs=4;  Cold=$true  }
    B    = @{ Name='B-jobs6-cold';  Jobs=6;  Cold=$true  }
    C    = @{ Name='C-jobs8-cold';  Jobs=8;  Cold=$true  }
    D    = @{ Name='D-jobs12-cold'; Jobs=12; Cold=$true  }
    Warm = @{ Name='warm-best';     Jobs=0;  Cold=$false }  # Jobs filled in dynamically
}

if (-not (Test-Path $MasterLog)) { New-Item -ItemType File -Path $MasterLog -Force | Out-Null }
MLog "Master start. Scenarios: $($Scenarios -join ', ')"

$winningJobs = $null
$winningWallSec = [int]::MaxValue
$results = @()

foreach ($key in $Scenarios) {
    $def = $defs[$key]
    if (-not $def) { MLog "Skip unknown scenario: $key"; continue }

    if ($key -eq 'Warm') {
        if (-not $winningJobs) { MLog "No winning jobs known; skipping Warm."; continue }
        $def = @{ Name="warm-jobs$winningJobs"; Jobs=$winningJobs; Cold=$false }
    }

    # OOM-headroom gate for D.
    if ($key -eq 'D') {
        # Look at peak RSS from C if available.
        $cCsv = Join-Path $ScriptDir 'C-jobs8-cold.csv'
        if (Test-Path $cCsv) {
            $cRow = Import-Csv $cCsv | Select -First 1
            $cPeakGB = [int]$cRow.peakRssMB / 1024.0
            MLog "Scenario C peak RSS: $([math]::Round($cPeakGB,1)) GB"
            if ($cPeakGB -gt 35) {
                MLog "C peak >35 GB → D (jobs=12) skipped to avoid OOM risk on 64 GB box."
                continue
            }
        }
    }

    MLog "===== Starting $($def.Name) (jobs=$($def.Jobs), cold=$($def.Cold)) ====="
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $coldArg = if ($def.Cold) { '-Cold' } else { '' }
    if ($def.Cold) {
        & pwsh -NoProfile -File (Join-Path $ScriptDir 'run-scenario.ps1') `
            -Scenario $def.Name -Jobs $def.Jobs -Cold -JobDir $ScriptDir
    } else {
        & pwsh -NoProfile -File (Join-Path $ScriptDir 'run-scenario.ps1') `
            -Scenario $def.Name -Jobs $def.Jobs -JobDir $ScriptDir
    }
    $exit = $LASTEXITCODE
    $sw.Stop()
    MLog "$($def.Name) exit=$exit elapsed=$([math]::Round($sw.Elapsed.TotalMinutes,2)) min"

    # Read CSV.
    $csv = Join-Path $ScriptDir "$($def.Name).csv"
    if (Test-Path $csv) {
        $row = Import-Csv $csv | Select -First 1
        $wall = [double]$row.wallSeconds
        $peakMB = [int]$row.peakRssMB
        $hits = [int]$row.sccacheHits
        $misses = [int]$row.sccacheMisses
        $stores = [int]$row.sccacheStores
        $jobs = $row.jobs
        MLog "  wall=$($wall)s  peakRSS=$($peakMB) MB  sccache hits/misses/stores=$hits/$misses/$stores  jobs=$jobs"
        $results += [pscustomobject]@{
            Scenario = $def.Name; Jobs = $jobs; WallSec = $wall;
            WallMin = [math]::Round($wall/60,2); PeakRssMB = $peakMB;
            PeakRssGB = [math]::Round($peakMB/1024.0,2);
            Hits = $hits; Misses = $misses; Stores = $stores; ExitCode = $exit
        }
        # Track winner across cold-cache runs only.
        if ($def.Cold -and $exit -eq 0 -and $wall -lt $winningWallSec) {
            $winningWallSec = $wall
            $winningJobs = [int]$def.Jobs
            MLog "  -> NEW WINNER: jobs=$winningJobs wallSec=$wall"
        }
    } else {
        MLog "  WARN: no CSV at $csv"
    }
}

# Write summary CSV.
$summary = Join-Path $ScriptDir 'summary.csv'
$results | Export-Csv -Path $summary -NoTypeInformation -Encoding UTF8
MLog "Summary CSV: $summary"
MLog "Winning cold-cache: jobs=$winningJobs wallSec=$winningWallSec ($([math]::Round($winningWallSec/60,2)) min)"
MLog "=== MASTER DONE ==="
