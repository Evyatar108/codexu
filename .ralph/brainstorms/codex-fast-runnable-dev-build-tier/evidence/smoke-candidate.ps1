param(
    [string]$Profile = "dev-small",

    [Parameter(Mandatory = $true)]
    [string]$TargetDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputPrefix,

    [ValidateSet("minimal", "full")]
    [string]$Mode = "minimal",

    [switch]$Authenticated,

    [ValidateRange(1, 3600)]
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

$scriptPath = $MyInvocation.MyCommand.Path
$scriptSha256 = (Get-FileHash $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
$profileDir = Join-Path $TargetDir $Profile
$launcher = Join-Path $profileDir "codex.exe"
$core = Join-Path $profileDir "codex-core.exe"

if (-not (Test-Path $launcher) -or -not (Test-Path $core)) {
    throw "Expected adjacent codex.exe and codex-core.exe under $profileDir."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Remove-Item Env:CODEX_CORE_PATH -ErrorAction SilentlyContinue

function Get-FileEvidence {
    param([string]$Path)

    $item = Get-Item $Path
    return [ordered]@{
        path = $item.FullName
        bytes = [long]$item.Length
        sha256 = (Get-FileHash $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-ExactProcessTreeIds {
    param(
        [int]$RootProcessId,
        [object[]]$Processes = @(Get-CimInstance Win32_Process)
    )

    $queue = [Collections.Generic.Queue[int]]::new()
    $order = [Collections.Generic.List[int]]::new()
    $seen = [Collections.Generic.HashSet[int]]::new()
    $queue.Enqueue($RootProcessId)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if (-not $seen.Add($current)) {
            continue
        }
        $order.Add($current)
        foreach ($child in $Processes | Where-Object { [int]$_.ParentProcessId -eq $current }) {
            $queue.Enqueue([int]$child.ProcessId)
        }
    }

    return $order.ToArray()
}

function Wait-ExactProcessTree {
    param(
        [int]$RootProcessId,
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $processes = @(Get-CimInstance Win32_Process)
        $alive = @(
            Get-ExactProcessTreeIds $RootProcessId $processes |
                Where-Object { $processes.ProcessId -contains $_ }
        )
        if ($alive.Count -eq 0) {
            return $true
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    return $false
}

function Stop-ExactProcessTree {
    param([int]$RootProcessId)

    $ids = Get-ExactProcessTreeIds $RootProcessId
    [Array]::Reverse($ids)
    foreach ($processId in $ids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Wait-FileUnlocked {
    param(
        [string]$Path,
        [int]$TimeoutSeconds = 10
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $stream = [IO.File]::Open(
                $Path,
                [IO.FileMode]::Open,
                [IO.FileAccess]::Read,
                [IO.FileShare]::None
            )
            $stream.Dispose()
            return
        } catch [IO.IOException] {
            Start-Sleep -Milliseconds 100
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for redirected output to close: $Path"
}

function Test-SmokeSemantics {
    param(
        [string]$Kind,
        [string]$StdoutPath
    )

    $text = Get-Content $StdoutPath -Raw -ErrorAction SilentlyContinue
    if ($Kind -eq "exit-only") {
        return [ordered]@{
            accepted = $true
            parseErrors = 0
            detail = "Exit code only."
        }
    }
    if ($Kind -eq "version") {
        return [ordered]@{
            accepted = $text.Trim() -match '^codex-cli\s+\S+$'
            parseErrors = 0
            detail = $text.Trim()
        }
    }

    $events = [Collections.Generic.List[object]]::new()
    $parseErrors = 0
    foreach ($line in Get-Content $StdoutPath) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        try {
            $events.Add(($line | ConvertFrom-Json))
        } catch {
            $parseErrors++
        }
    }

    $messages = @(
        $events |
            Where-Object {
                $_.type -eq "item.completed" -and
                $_.item.type -eq "agent_message"
            } |
            ForEach-Object { [string]$_.item.text }
    )
    $turnCompleted = @($events | Where-Object type -eq "turn.completed").Count -eq 1

    if ($Kind -eq "authenticated-response") {
        $eventShape = @(
            $events | ForEach-Object {
                if ($_.type -like "item.*") {
                    "$($_.type):$($_.item.type)"
                } else {
                    [string]$_.type
                }
            }
        )
        $expectedShape = @(
            "thread.started",
            "turn.started",
            "item.completed:agent_message",
            "turn.completed"
        )
        $shapeAccepted = (
            $eventShape.Count -eq $expectedShape.Count -and
            (Compare-Object $eventShape $expectedShape -SyncWindow 0).Count -eq 0
        )
        $accepted = (
            $parseErrors -eq 0 -and
            $turnCompleted -and
            $shapeAccepted -and
            $messages.Count -eq 1 -and
            $messages[0].Trim() -eq "FAST_RUNNABLE_OK"
        )
        return [ordered]@{
            accepted = $accepted
            parseErrors = $parseErrors
            turnCompleted = $turnCompleted
            eventShape = $eventShape
            expectedEventShape = $expectedShape
            eventShapeAccepted = $shapeAccepted
            agentMessages = $messages
        }
    }

    $eventShape = @(
        $events | ForEach-Object {
            if ($_.type -like "item.*") {
                "$($_.type):$($_.item.type)"
            } else {
                [string]$_.type
            }
        }
    )
    $expectedShape = @(
        "thread.started",
        "turn.started",
        "item.started:command_execution",
        "item.completed:command_execution",
        "item.completed:agent_message",
        "turn.completed"
    )
    $shapeAccepted = (
        $eventShape.Count -eq $expectedShape.Count -and
        (Compare-Object $eventShape $expectedShape -SyncWindow 0).Count -eq 0
    )
    $startedCommands = @(
        $events |
            Where-Object {
                $_.type -eq "item.started" -and
                $_.item.type -eq "command_execution"
            }
    )
    $completedCommands = @(
        $events |
            Where-Object {
                $_.type -eq "item.completed" -and
                $_.item.type -eq "command_execution"
            }
    )
    $normalizedStartedCommand = if ($startedCommands.Count -eq 1) {
        ([regex]::Replace([string]$startedCommands[0].item.command, '\s+', ' ').Trim()).Replace("\\", "\")
    } else {
        $null
    }
    $normalizedCompletedCommand = if ($completedCommands.Count -eq 1) {
        ([regex]::Replace([string]$completedCommands[0].item.command, '\s+', ' ').Trim()).Replace("\\", "\")
    } else {
        $null
    }
    $normalizedOutput = if ($completedCommands.Count -eq 1) {
        ([string]$completedCommands[0].item.aggregated_output).Replace("`r`n", "`n").TrimEnd("`n")
    } else {
        $null
    }
    $expectedCommandPattern = '^"C:\\Program Files\\PowerShell\\7\\pwsh\.exe" -Command ''Write-Output FAST_TOOL_OK''$'
    $commandAccepted = (
        $startedCommands.Count -eq 1 -and
        $completedCommands.Count -eq 1 -and
        $normalizedStartedCommand -eq $normalizedCompletedCommand -and
        $normalizedCompletedCommand -match $expectedCommandPattern -and
        $completedCommands[0].item.status -eq "completed" -and
        [int]$completedCommands[0].item.exit_code -eq 0 -and
        $normalizedOutput -eq "FAST_TOOL_OK"
    )
    $accepted = (
        $parseErrors -eq 0 -and
        $turnCompleted -and
        $shapeAccepted -and
        $commandAccepted -and
        $messages.Count -eq 1 -and
        $messages[0].Trim() -eq "FAST_TOOL_OK"
    )
    return [ordered]@{
        accepted = $accepted
        parseErrors = $parseErrors
        turnCompleted = $turnCompleted
        eventShape = $eventShape
        expectedEventShape = $expectedShape
        eventShapeAccepted = $shapeAccepted
        startedCommandCount = $startedCommands.Count
        completedCommandCount = $completedCommands.Count
        normalizedCommand = $normalizedCompletedCommand
        normalizedOutput = $normalizedOutput
        commandAccepted = $commandAccepted
        agentMessages = $messages
    }
}

function Invoke-Smoke {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [int[]]$AcceptedExitCodes = @(0),
        [ValidateSet("exit-only", "version", "authenticated-response", "authenticated-tool")]
        [string]$Semantic = "exit-only",
        [int]$TimeoutSeconds = 180
    )

    $stdoutPath = Join-Path $OutputDir "$OutputPrefix-$Name.stdout.log"
    $stderrPath = Join-Path $OutputDir "$OutputPrefix-$Name.stderr.log"
    $startedAt = [DateTime]::UtcNow
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process `
        -FilePath $launcher `
        -ArgumentList $Arguments `
        -WorkingDirectory $profileDir `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -NoNewWindow `
        -PassThru
    $processId = $process.Id
    $completed = Wait-ExactProcessTree $processId $TimeoutSeconds
    $timedOut = -not $completed
    $treeTerminationVerified = $completed
    if ($timedOut) {
        Stop-ExactProcessTree $processId
        $treeTerminationVerified = Wait-ExactProcessTree $processId 10
    }
    $rootHandleExited = $process.WaitForExit(10000)
    if (-not $rootHandleExited) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $rootHandleExited = $process.WaitForExit(10000)
    }
    $terminationVerified = $treeTerminationVerified -and $rootHandleExited
    $exitCode = if ($timedOut -or -not $rootHandleExited) { $null } else { $process.ExitCode }
    $process.Dispose()
    Wait-FileUnlocked $stdoutPath
    Wait-FileUnlocked $stderrPath
    $stopwatch.Stop()
    $semantics = if ($timedOut) {
        [ordered]@{
            accepted = $false
            detail = "Timed out before semantic validation."
        }
    } else {
        Test-SmokeSemantics $Semantic $stdoutPath
    }

    return [ordered]@{
        name = $Name
        argv = @($launcher) + $Arguments
        startedAt = $startedAt.ToString("o")
        wallSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        processId = $processId
        timeoutSeconds = $TimeoutSeconds
        timedOut = $timedOut
        treeTerminationVerified = $treeTerminationVerified
        rootHandleExited = $rootHandleExited
        terminationVerified = $terminationVerified
        exitCode = $exitCode
        semantic = $Semantic
        semanticResult = $semantics
        accepted = (
            -not $timedOut -and
            $terminationVerified -and
            $AcceptedExitCodes -contains $exitCode -and
            $semantics.accepted
        )
        acceptedExitCodes = $AcceptedExitCodes
        stdout = Get-FileEvidence $stdoutPath
        stderr = Get-FileEvidence $stderrPath
    }
}

function Get-ImportedDllNames {
    param([string]$Path)

    $output = & "C:\Program Files\LLVM\bin\llvm-readobj.exe" --coff-imports $Path 2>&1
    return @(
        $output |
            Select-String '^\s+Name:\s+(.+\.dll)$' |
            ForEach-Object { $_.Matches[0].Groups[1].Value } |
            Sort-Object -Unique
    )
}

$runs = @()
$runs += Invoke-Smoke "version" @("--version") @(0) "version" $TimeoutSeconds

if ($Mode -eq "full") {
    $runs += Invoke-Smoke "help" @("--help") @(0) "exit-only" $TimeoutSeconds
    $runs += Invoke-Smoke "login-help" @("login", "--provider", "copilot", "--help") @(0) "exit-only" $TimeoutSeconds
    $runs += Invoke-Smoke "features-list" @("features", "list") @(0) "exit-only" $TimeoutSeconds
    $runs += Invoke-Smoke "doctor-json" @("doctor", "--json") @(0, 1) "exit-only" $TimeoutSeconds
}

if ($Authenticated) {
    $runs += Invoke-Smoke "authenticated-exec" @(
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        '"Reply exactly FAST_RUNNABLE_OK. Do not use tools."'
    ) @(0) "authenticated-response" $TimeoutSeconds
    $runs += Invoke-Smoke "authenticated-tool-exec" @(
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--json",
        '"Use the shell tool to run PowerShell Write-Output FAST_TOOL_OK, then reply exactly FAST_TOOL_OK."'
    ) @(0) "authenticated-tool" $TimeoutSeconds
}

$result = [ordered]@{
    schemaVersion = 2
    script = [ordered]@{
        path = $scriptPath
        sha256 = $scriptSha256
    }
    mode = $Mode
    profileDir = $profileDir
    codexCorePathOverridePresent = Test-Path Env:CODEX_CORE_PATH
    binaries = [ordered]@{
        launcher = Get-FileEvidence $launcher
        core = Get-FileEvidence $core
    }
    runs = $runs
    importedDlls = [ordered]@{
        launcher = Get-ImportedDllNames $launcher
        core = Get-ImportedDllNames $core
    }
    adjacentDlls = @(
        Get-ChildItem $profileDir -Filter "*.dll" -File -ErrorAction SilentlyContinue |
            ForEach-Object { Get-FileEvidence $_.FullName }
    )
}

$jsonPath = Join-Path $OutputDir "$OutputPrefix-results.json"
[IO.File]::WriteAllText(
    $jsonPath,
    ($result | ConvertTo-Json -Depth 20) + "`n",
    [Text.UTF8Encoding]::new($false)
)

$failed = @($runs | Where-Object { -not $_.accepted })
if ($failed.Count -gt 0) {
    throw "Smoke failures: $($failed.name -join ', ')"
}
