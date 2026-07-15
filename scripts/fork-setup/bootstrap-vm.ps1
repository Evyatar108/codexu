[CmdletBinding()]
param(
    [string]$Root,
    [string]$ManifestPath,
    [string]$ConfigPath,
    [switch]$ValidateOnly,
    [switch]$RestoreWorkspace,
    [switch]$InstallToolchains,
    [switch]$RepairNodeHookShim,
    [switch]$InstallWorkspaceDependencies,
    [switch]$BuildAndLinkHappy,
    [switch]$ConfigurePlugins,
    [switch]$ConfigureAndroid,
    [switch]$AcceptAndroidLicenses,
    [switch]$CreateShortClone,
    [string]$ShortClonePath = "D:\h",
    [string]$CodexPackagePath,
    [string]$CodexRef,
    [string]$ToolkitRef
)

$ErrorActionPreference = "Stop"
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = "1"
$script:Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param(
        [ValidateSet("PASS", "GATED", "FAIL")]
        [string]$Status,
        [string]$Name,
        [string]$Detail,
        [bool]$Required = $true
    )
    $script:Results.Add([pscustomobject]@{
        Status = $Status
        Name = $Name
        Detail = $Detail
        Required = $Required
    })
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $Root,
        [switch]$AllowFailure
    )
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $exitCode"
    }
    return $exitCode
}

function Invoke-Git {
    param([string]$Repository, [string[]]$Arguments, [switch]$AllowFailure)
    return Invoke-Native "git" (@("-C", $Repository) + $Arguments) $Root -AllowFailure:$AllowFailure
}

function Get-CommandText {
    param([string]$Command, [string[]]$Arguments = @("--version"))
    $resolved = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $resolved) {
        return $null
    }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $resolved.Source @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    if ($exitCode -ne 0) {
        return $null
    }
    return (($output | Out-String).Trim())
}

function Test-Version {
    param([string]$Name, [pscustomobject]$Spec, [string[]]$Arguments = @("--version"))
    if ($Spec.packageName) {
        $resolved = Get-Command $Spec.command -ErrorAction SilentlyContinue
        if ($resolved) {
            $packagePath = Join-Path (Split-Path $resolved.Source) "node_modules\$($Spec.packageName)\package.json"
            if (Test-Path $packagePath) {
                $package = Get-Content $packagePath -Raw | ConvertFrom-Json
                if ($package.version -eq $Spec.version) {
                    Add-Result "PASS" "tool:$Name" "$($Spec.packageName) package reports $($Spec.version)."
                } else {
                    Add-Result "GATED" "tool:$Name" "Expected $($Spec.version); package reports $($package.version)."
                }
                return
            }
        }
    }
    $text = Get-CommandText $Spec.command $Arguments
    if (-not $text) {
        Add-Result "GATED" "tool:$Name" "$($Spec.command) is missing; use -InstallToolchains."
        return
    }
    $pattern = if ($Spec.versionPattern) { [string]$Spec.versionPattern } else { [regex]::Escape([string]$Spec.version) }
    if ($text -match $pattern) {
        Add-Result "PASS" "tool:$Name" "$($Spec.command) reports $($Spec.version)."
    } else {
        Add-Result "GATED" "tool:$Name" "Expected $($Spec.version); found $(($text -split "`r?`n")[0])."
    }
}

function Set-UserEnvironmentValue {
    param([string]$Name, [string]$Value)
    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
    Set-Item -Path "Env:$Name" -Value $Value
}

function Add-UserPathEntry {
    param([string]$Path, [switch]$Prepend)
    $current = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($current -split ";" | Where-Object { $_ -and $_ -ne $Path })
    $updated = if ($Prepend) { @($Path) + $entries } else { $entries + @($Path) }
    [Environment]::SetEnvironmentVariable("Path", ($updated -join ";"), "User")
    $processEntries = @($env:Path -split ";" | Where-Object { $_ -and $_ -ne $Path })
    $env:Path = (@($Path) + $processEntries) -join ";"
}

function Refresh-ProcessPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$user;$machine"
}

function Get-NvmSymlink {
    $value = $env:NVM_SYMLINK
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "User")
    }
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "Machine")
    }
    return $value
}

function Repair-NodeHookShim {
    param([pscustomobject]$NodeConfig)
    $nvmSymlink = Get-NvmSymlink
    if (-not $nvmSymlink) {
        throw "NVM_SYMLINK is not configured. Install/select the pinned NVM Node before repairing the hook shim."
    }
    $source = Join-Path $nvmSymlink "node.exe"
    $destination = [string]$NodeConfig.hookShim
    if (-not (Test-Path $source)) {
        throw "Selected NVM Node is missing at $source."
    }
    $sourceVersion = (& $source --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $sourceVersion -notmatch [regex]::Escape([string]$NodeConfig.version)) {
        throw "Selected NVM Node must be version $($NodeConfig.version); found $sourceVersion."
    }
    $sourceHash = (Get-FileHash -Algorithm SHA256 $source).Hash
    $destinationDirectory = Split-Path $destination
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    $staged = Join-Path $destinationDirectory ("node.atomic-{0}-{1}.exe" -f $PID, [Guid]::NewGuid().ToString("N"))
    try {
        Copy-Item $source $staged
        if ((Get-FileHash -Algorithm SHA256 $staged).Hash -ne $sourceHash) {
            throw "Staged Node copy hash mismatch."
        }
        if (Test-Path $destination) {
            [IO.File]::Replace($staged, $destination, $null)
        } else {
            [IO.File]::Move($staged, $destination)
        }
        $destinationHash = (Get-FileHash -Algorithm SHA256 $destination).Hash
        $destinationVersion = (& $destination --version 2>&1 | Out-String).Trim()
        if ($destinationHash -ne $sourceHash -or
            $destinationVersion -notmatch [regex]::Escape([string]$NodeConfig.version)) {
            throw "Atomic Node hook shim verification failed after replacement."
        }
    } catch {
        throw "Atomic Node hook shim replacement failed without deleting the existing executable. Run elevated or reorder Machine PATH so NVM_SYMLINK precedes C:\.tools\.npm-global. $($_.Exception.Message)"
    } finally {
        if (Test-Path $staged) {
            Remove-Item $staged -Force
        }
    }
}

function Test-NodeHookShim {
    param([pscustomobject]$NodeConfig, [bool]$ApplyRepair)
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $machineEntries = @($machinePath -split ";" | Where-Object { $_ })
    $shadowDirectory = Split-Path ([string]$NodeConfig.hookShim)
    $nvmSymlink = Get-NvmSymlink
    $shadowIndex = -1
    $nvmIndex = -1
    for ($index = 0; $index -lt $machineEntries.Count; $index++) {
        $entry = $machineEntries[$index].Trim().TrimEnd("\")
        if ($entry -ieq $shadowDirectory.TrimEnd("\")) {
            $shadowIndex = $index
        }
        if ($entry -ieq "%NVM_SYMLINK%" -or ($nvmSymlink -and $entry -ieq $nvmSymlink.TrimEnd("\"))) {
            $nvmIndex = $index
        }
    }
    $isShadowing = $shadowIndex -ge 0 -and ($nvmIndex -lt 0 -or $shadowIndex -lt $nvmIndex)
    if (-not $nvmSymlink) {
        Add-Result "GATED" "node:hook-shadow" "NVM_SYMLINK is missing. Configure NVM or perform elevated Machine PATH remediation."
        return
    }
    $selectedNode = Join-Path $nvmSymlink "node.exe"
    if (-not (Test-Path $selectedNode)) {
        Add-Result "FAIL" "node:hook-shadow" "Selected NVM Node is not runnable at $selectedNode."
        return
    }
    $shim = [string]$NodeConfig.hookShim
    $matches = $false
    if (Test-Path $shim) {
        $selectedHash = (Get-FileHash -Algorithm SHA256 $selectedNode).Hash
        $shimHash = (Get-FileHash -Algorithm SHA256 $shim).Hash
        $selectedVersion = (& $selectedNode --version 2>&1 | Out-String).Trim()
        $shimVersion = (& $shim --version 2>&1 | Out-String).Trim()
        $matches = $selectedHash -eq $shimHash -and
            $selectedVersion -match [regex]::Escape([string]$NodeConfig.version) -and
            $shimVersion -match [regex]::Escape([string]$NodeConfig.version)
    }
    if ($matches) {
        $order = if ($isShadowing) { "Machine PATH shadow is active" } else { "Machine PATH does not shadow NVM" }
        Add-Result "PASS" "node:hook-shadow" "$order; hook node.exe hash/version match selected NVM Node."
        return
    }
    if ($ApplyRepair) {
        Repair-NodeHookShim $NodeConfig
        Add-Result "PASS" "node:hook-shadow" "Atomically replaced and verified the hook Node shim with no missing-target window."
    } elseif ($isShadowing) {
        Add-Result "GATED" "node:hook-shadow" "C:\.tools\.npm-global precedes NVM_SYMLINK but node.exe differs or is missing. Use -RepairNodeHookShim elevated, or reorder Machine PATH. Never delete/rename the live shim."
    } else {
        Add-Result "GATED" "node:hook-shadow" "Hook node.exe differs or is missing. Use -RepairNodeHookShim; replacement is staged and atomic."
    }
}

function Install-WingetExact {
    param([string]$Name, [pscustomobject]$Spec)
    if (-not $Spec.wingetId) {
        throw "No wingetId configured for $Name."
    }
    $arguments = @(
        "install", "--exact", "--id", [string]$Spec.wingetId,
        "--version", [string]$Spec.version,
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity"
    )
    $scope = if ($Spec.scope) { [string]$Spec.scope } else { "user" }
    $arguments += @("--scope", $scope)
    Invoke-Native "winget" $arguments | Out-Null
}

function Install-VerifiedPortable {
    param([string]$Name, [pscustomobject]$Spec, [string]$Destination)
    $downloadRoot = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\downloads"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $download = Join-Path $downloadRoot $Spec.archiveName
    Invoke-WebRequest -UseBasicParsing -Uri $Spec.url -OutFile $download
    $actual = (Get-FileHash -Algorithm SHA256 $download).Hash.ToLowerInvariant()
    if ($actual -ne $Spec.sha256.ToLowerInvariant()) {
        throw "$Name SHA256 mismatch. Expected $($Spec.sha256), found $actual."
    }
    if ($download.EndsWith(".zip", [StringComparison]::OrdinalIgnoreCase)) {
        $staging = "$Destination.staging"
        Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Expand-Archive -Path $download -DestinationPath $staging -Force
        $children = @(Get-ChildItem $staging -Directory)
        if ($children.Count -ne 1) {
            throw "$Name archive must contain exactly one root directory."
        }
        Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue
        Move-Item $children[0].FullName $Destination
        Remove-Item $staging -Recurse -Force
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
        Copy-Item $download $Destination -Force
    }
}

function Ensure-DriveLayout {
    param([pscustomobject]$Config, [bool]$Apply)
    $substLines = @(& subst.exe)
    $expected = "$($Config.drive.letter)\: => $($Config.drive.target)"
    if (@($substLines | Where-Object { $_ -ieq $expected }).Count -eq 1) {
        Add-Result "PASS" "drive:subst" $expected
    } elseif (-not $Apply) {
        Add-Result "GATED" "drive:subst" "Expected persistent mapping $expected."
    } else {
        New-Item -ItemType Directory -Force -Path $Config.drive.target | Out-Null
        & subst.exe $Config.drive.letter $Config.drive.target
        if ($LASTEXITCODE -ne 0) {
            throw "subst failed for $expected"
        }
        $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        New-Item -Path $runKey -Force | Out-Null
        Set-ItemProperty -Path $runKey -Name "CodexuDevDrive" -Value "subst.exe $($Config.drive.letter) `"$($Config.drive.target)`""
        Add-Result "PASS" "drive:subst" "Created $expected and user logon persistence."
    }
    foreach ($directory in $Config.drive.directories) {
        if (Test-Path $directory) {
            Add-Result "PASS" "directory:$directory" "Directory exists."
        } elseif (-not $Apply) {
            Add-Result "GATED" "directory:$directory" "Directory will be created by bootstrap."
        } else {
            New-Item -ItemType Directory -Force -Path $directory | Out-Null
            Add-Result "PASS" "directory:$directory" "Directory created."
        }
    }
}

function Install-AllToolchains {
    param([pscustomobject]$Config)
    foreach ($name in @("node", "llvm", "cmake", "ninja", "just", "python", "perl", "sccache", "jq")) {
        $spec = $Config.toolchains.$name
        $text = Get-CommandText $spec.command
        if (-not $text -or $text -notmatch [regex]::Escape([string]$spec.version)) {
            Install-WingetExact $name $spec
        }
    }
    Refresh-ProcessPath
    Invoke-Native "npm" @("install", "--global", "npm@$($Config.toolchains.npm.version)") | Out-Null
    Invoke-Native "npm" @("install", "--global", "pnpm@$($Config.toolchains.pnpm.version)") | Out-Null
    Invoke-Native "npm" @("install", "--global", "firebase-tools@$($Config.toolchains.firebase.version)") | Out-Null
    if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
        throw "rustup is required. Install rustup user-scoped, then rerun."
    }
    Invoke-Native "rustup" @("toolchain", "install", $Config.toolchains.rust.version, "--profile", "minimal") | Out-Null
    Invoke-Native "rustup" @("default", $Config.toolchains.rust.version) | Out-Null
    Invoke-Native "cargo" @("install", "xwin", "--version", $Config.toolchains.xwin.version, "--locked") | Out-Null
    $jdkRoot = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\jdk-$($Config.portable.jdk.version.Replace('+', '_'))"
    Install-VerifiedPortable "jdk" $Config.portable.jdk $jdkRoot
    $cloudflared = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\bin\cloudflared.exe"
    Install-VerifiedPortable "cloudflared" $Config.portable.cloudflared $cloudflared
    Set-UserEnvironmentValue "JAVA_HOME" $jdkRoot
    Set-UserEnvironmentValue "ANDROID_HOME" "D:\Android\Sdk"
    Add-UserPathEntry (Join-Path $env:LOCALAPPDATA "codexu-bootstrap\bin") -Prepend
    Add-UserPathEntry (Join-Path $jdkRoot "bin") -Prepend
}

function Ensure-NarrowWrappers {
    param([bool]$Apply)
    $bin = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\bin"
    if ($Apply) {
        New-Item -ItemType Directory -Force -Path $bin | Out-Null
        $wrappers = @{
            "bash.cmd" = "@echo off`r`n`"$env:ProgramFiles\Git\bin\bash.exe`" %*`r`n"
            "python.cmd" = "@echo off`r`npython.exe %*`r`n"
            "cmake.cmd" = "@echo off`r`ncmake.exe %*`r`n"
            "perl.cmd" = "@echo off`r`nperl.exe %*`r`n"
            "rm.cmd" = "@echo off`r`n`"$env:ProgramFiles\Git\usr\bin\rm.exe`" %*`r`n"
            "cp.cmd" = "@echo off`r`n`"$env:ProgramFiles\Git\usr\bin\cp.exe`" %*`r`n"
        }
        foreach ($entry in $wrappers.GetEnumerator()) {
            [IO.File]::WriteAllText((Join-Path $bin $entry.Key), $entry.Value, [Text.Encoding]::ASCII)
        }
        Add-UserPathEntry $bin -Prepend
    }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -match "(?i)Git\\usr\\bin") {
        Add-Result "FAIL" "path:git-usr-bin" "Git usr\bin is globally present and can shadow lld-link."
    } else {
        Add-Result "PASS" "path:git-usr-bin" "Git usr\bin is not globally added."
    }
}

function Ensure-WorktreeAtCommit {
    param(
        [string]$Repository,
        [string]$Path,
        [string]$Branch,
        [string]$Commit,
        [string]$Remote,
        [string]$RemoteUrl
    )
    $remoteNames = @(& git -C $Repository remote 2>$null)
    if ($remoteNames -contains $Remote) {
        Invoke-Git $Repository @("remote", "set-url", $Remote, $RemoteUrl) | Out-Null
    } else {
        Invoke-Git $Repository @("remote", "add", $Remote, $RemoteUrl) | Out-Null
    }
    Invoke-Git $Repository @("fetch", $Remote, "--prune") | Out-Null
    Invoke-Git $Repository @("cat-file", "-e", "$Commit^{commit}") | Out-Null
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
        Invoke-Git $Repository @("worktree", "add", "--detach", $Path, $Commit) | Out-Null
        Invoke-Git $Path @("switch", "-C", $Branch, $Commit) | Out-Null
    }
    $head = (& git -C $Path rev-parse HEAD).Trim()
    $actualBranch = (& git -C $Path branch --show-current).Trim()
    if ($head -ne $Commit -or $actualBranch -ne $Branch) {
        throw "Worktree $Path expected $Branch at $Commit; found $actualBranch at $head."
    }
    Invoke-Git $Path @("-c", "core.autocrlf=false", "submodule", "sync", "--recursive") | Out-Null
    Invoke-Git $Path @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
}

function Restore-MigrationTopology {
    param([pscustomobject]$Manifest)
    $codex = Join-Path $Root "codex"
    $toolkit = Join-Path $Root "ai-developer-toolkit"
    Invoke-Git $Root @("-c", "core.autocrlf=false", "submodule", "sync", "--recursive") | Out-Null
    Invoke-Git $Root @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
    Ensure-WorktreeAtCommit $codex (Join-Path $codex ".worktrees\codex-v2-copilot-encrypted-subagent-handoff") `
        $Manifest.repositories.codex.activeBranch $Manifest.repositories.codex.activeCommit "vm-mirror" $Manifest.repositories.codex.url
    Ensure-WorktreeAtCommit $codex (Join-Path $codex ".worktrees\codex-rs-core-change-incremental-build-over-30m") `
        $Manifest.repositories.codex.buildTierBranch $Manifest.repositories.codex.buildTierCommit "vm-mirror" $Manifest.repositories.codex.url
    Ensure-WorktreeAtCommit $toolkit (Join-Path $toolkit ".worktrees\publish-ralph-564") `
        $Manifest.repositories.aiDeveloperToolkit.releaseBranch $Manifest.repositories.aiDeveloperToolkit.releaseCommit "origin" $Manifest.repositories.aiDeveloperToolkit.url
    Ensure-WorktreeAtCommit $toolkit (Join-Path $toolkit ".worktrees\ralph-v2-encrypted-role-wait-terminal-hardening") `
        $Manifest.repositories.aiDeveloperToolkit.hardeningBranch $Manifest.repositories.aiDeveloperToolkit.hardeningCommit "origin" $Manifest.repositories.aiDeveloperToolkit.url
    Ensure-WorktreeAtCommit $toolkit (Join-Path $toolkit ".worktrees\ralph-model-routing-v564-hybrid") `
        $Manifest.repositories.aiDeveloperToolkit.routingBranch $Manifest.repositories.aiDeveloperToolkit.routingCommit "origin" $Manifest.repositories.aiDeveloperToolkit.url
    $wrapper = Join-Path $codex ".worktrees\codex-v2-copilot-encrypted-subagent-handoff"
    $nested = Join-Path $wrapper "external\repos\codex-patched"
    Invoke-Git $wrapper @("config", "submodule.external/repos/codex-patched.url", $Manifest.repositories.codexPatched.url) | Out-Null
    Invoke-Git $wrapper @("-c", "core.autocrlf=false", "submodule", "sync", "--recursive") | Out-Null
    Invoke-Git $wrapper @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
    $nestedRemotes = @(& git -C $nested remote)
    if ($nestedRemotes -contains "vm-mirror") {
        Invoke-Git $nested @("remote", "set-url", "vm-mirror", $Manifest.repositories.codexPatched.url) | Out-Null
    } else {
        Invoke-Git $nested @("remote", "add", "vm-mirror", $Manifest.repositories.codexPatched.url) | Out-Null
    }
    Invoke-Git $nested @("fetch", "vm-mirror", "--prune") | Out-Null
    Invoke-Git $nested @("switch", "-C", $Manifest.repositories.codexPatched.activeBranch, $Manifest.repositories.codexPatched.activeCommit) | Out-Null
    Invoke-Git $nested @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
}

function Test-MigrationTopology {
    param([pscustomobject]$Manifest)
    if ((Invoke-Git $Root @("cat-file", "-e", "$($Manifest.repositories.codexu.mainCommit)^{commit}") -AllowFailure) -eq 0) {
        Add-Result "PASS" "topology:root-manifest-commit" "Root manifest commit is available locally."
    } else {
        Add-Result "GATED" "topology:root-manifest-commit" "Root manifest commit requires a fetch or fresh migration clone."
    }
    $checks = @(
        @("codex-prd-b", (Join-Path $Root "codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff"), $Manifest.repositories.codex.activeBranch, $Manifest.repositories.codex.activeCommit),
        @("codex-build-tier", (Join-Path $Root "codex\.worktrees\codex-rs-core-change-incremental-build-over-30m"), $Manifest.repositories.codex.buildTierBranch, $Manifest.repositories.codex.buildTierCommit),
        @("toolkit-release", (Join-Path $Root "ai-developer-toolkit\.worktrees\publish-ralph-564"), $Manifest.repositories.aiDeveloperToolkit.releaseBranch, $Manifest.repositories.aiDeveloperToolkit.releaseCommit),
        @("toolkit-hardening", (Join-Path $Root "ai-developer-toolkit\.worktrees\ralph-v2-encrypted-role-wait-terminal-hardening"), $Manifest.repositories.aiDeveloperToolkit.hardeningBranch, $Manifest.repositories.aiDeveloperToolkit.hardeningCommit),
        @("toolkit-routing", (Join-Path $Root "ai-developer-toolkit\.worktrees\ralph-model-routing-v564-hybrid"), $Manifest.repositories.aiDeveloperToolkit.routingBranch, $Manifest.repositories.aiDeveloperToolkit.routingCommit)
    )
    foreach ($check in $checks) {
        if (-not (Test-Path $check[1])) {
            Add-Result "GATED" "topology:$($check[0])" "Worktree is absent; use -RestoreWorkspace."
            continue
        }
        $branch = (& git -C $check[1] branch --show-current 2>$null).Trim()
        $head = (& git -C $check[1] rev-parse HEAD 2>$null).Trim()
        if ($branch -eq $check[2] -and $head -eq $check[3]) {
            Add-Result "PASS" "topology:$($check[0])" "$branch at $head"
        } else {
            Add-Result "FAIL" "topology:$($check[0])" "Expected $($check[2]) at $($check[3]); found $branch at $head."
        }
    }
    $nested = Join-Path $Root "codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff\external\repos\codex-patched"
    if (Test-Path $nested) {
        $head = (& git -C $nested rev-parse HEAD 2>$null).Trim()
        if ($head -eq $Manifest.repositories.codexPatched.activeCommit) {
            Add-Result "PASS" "topology:prd-b-nested" "Nested source remains at $head."
        } else {
            Add-Result "FAIL" "topology:prd-b-nested" "Expected $($Manifest.repositories.codexPatched.activeCommit); found $head."
        }
    }
}

function Configure-AndroidSdk {
    param([pscustomobject]$Config)
    $sdk = "D:\Android\Sdk"
    $sdkManager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
    if (-not (Test-Path $sdkManager)) {
        $spec = $Config.android.commandLineTools
        $downloadRoot = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\downloads"
        New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
        $download = Join-Path $downloadRoot $spec.archiveName
        Invoke-WebRequest -UseBasicParsing -Uri $spec.url -OutFile $download
        $actual = (Get-FileHash -Algorithm $spec.checksumAlgorithm $download).Hash.ToLowerInvariant()
        if ($actual -ne $spec.checksum.ToLowerInvariant()) {
            throw "Android command-line tools checksum mismatch. Expected $($spec.checksum), found $actual."
        }
        $staging = Join-Path $downloadRoot "android-command-line-tools-staging"
        Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $download -DestinationPath $staging -Force
        $source = Join-Path $staging "cmdline-tools"
        if (-not (Test-Path (Join-Path $source "bin\sdkmanager.bat"))) {
            throw "Android command-line tools archive has an unexpected layout."
        }
        $latest = Join-Path $sdk "cmdline-tools\latest"
        Remove-Item $latest -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path (Split-Path $latest) | Out-Null
        Move-Item $source $latest
        Remove-Item $staging -Recurse -Force
    }
    $packages = @($Config.android.platform, $Config.android.buildTools, $Config.android.ndk, $Config.android.cmake) +
        @($Config.android.additionalPackages)
    if ($AcceptAndroidLicenses) {
        1..100 | ForEach-Object { "y" } | & $sdkManager "--licenses"
        if ($LASTEXITCODE -ne 0) {
            throw "Android license acceptance failed."
        }
    }
    Invoke-Native $sdkManager $packages | Out-Null
    $localProperties = Join-Path $Root "packages\happy-app\android\local.properties"
    [IO.File]::WriteAllText($localProperties, "sdk.dir=D:/Android/Sdk`r`n", [Text.Encoding]::ASCII)
    Set-UserEnvironmentValue "ANDROID_HOME" $sdk
    New-Item -ItemType Directory -Force -Path "D:\cxb" | Out-Null
}

function Test-AndroidSdk {
    param([pscustomobject]$Config)
    $paths = @{
        $Config.android.platform = "D:\Android\Sdk\platforms\android-36"
        $Config.android.buildTools = "D:\Android\Sdk\build-tools\36.0.0"
        $Config.android.ndk = "D:\Android\Sdk\ndk\27.1.12297006"
        $Config.android.cmake = "D:\Android\Sdk\cmake\3.30.5"
        "platform-tools" = "D:\Android\Sdk\platform-tools"
        "emulator" = "D:\Android\Sdk\emulator"
        "extras;google;usb_driver" = "D:\Android\Sdk\extras\google\usb_driver"
    }
    foreach ($entry in $paths.GetEnumerator()) {
        if (Test-Path $entry.Value) {
            Add-Result "PASS" "android:$($entry.Key)" $entry.Value
        } else {
            Add-Result "GATED" "android:$($entry.Key)" "Missing $($entry.Value); use -ConfigureAndroid."
        }
    }
    $sourceProperties = "D:\Android\Sdk\cmdline-tools\latest\source.properties"
    if ((Test-Path $sourceProperties) -and
        ((Get-Content $sourceProperties) -contains "Pkg.Revision=$($Config.android.commandLineTools.version)")) {
        Add-Result "PASS" "android:command-line-tools" "Version $($Config.android.commandLineTools.version) is installed."
    } else {
        Add-Result "GATED" "android:command-line-tools" "Use -ConfigureAndroid to install the verified archive."
    }
    $localProperties = Join-Path $Root "packages\happy-app\android\local.properties"
    if ((Test-Path $localProperties) -and ((Get-Content $localProperties) -contains "sdk.dir=D:/Android/Sdk")) {
        Add-Result "PASS" "android:local-properties" "sdk.dir is pinned to D:/Android/Sdk."
    } else {
        Add-Result "GATED" "android:local-properties" "Expected sdk.dir=D:/Android/Sdk."
    }
}

function Build-HappySource {
    Invoke-Native "pnpm" @("--filter", "happy-wire", "build") | Out-Null
    Invoke-Native "pnpm" @("--filter", "happy-server", "build") | Out-Null
    Invoke-Native "pnpm" @("--filter", "happy", "build") | Out-Null
    Invoke-Native "npm" @("link") (Join-Path $Root "packages\happy-cli") | Out-Null
}

function Configure-CopilotPlugins {
    param([pscustomobject]$Config)
    $marketplaces = (& copilot plugin marketplace list 2>$null | Out-String)
    if ($marketplaces -notmatch [regex]::Escape($Config.plugins.marketplaceName)) {
        Invoke-Native "copilot" @("plugin", "marketplace", "add", $Config.plugins.marketplace) | Out-Null
    }
    $installed = (& copilot plugin list 2>$null | Out-String)
    foreach ($plugin in $Config.plugins.enabledAllowlist) {
        if ($installed -notmatch [regex]::Escape($plugin)) {
            Invoke-Native "copilot" @("plugin", "install", $plugin) | Out-Null
        }
    }
    $settingsPath = Join-Path $env:USERPROFILE ".copilot\settings.json"
    $settings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $settings.enabledPlugins) {
        $settings | Add-Member NoteProperty enabledPlugins ([pscustomobject]@{})
    }
    foreach ($property in @($settings.enabledPlugins.PSObject.Properties)) {
        $property.Value = $false
    }
    foreach ($plugin in $Config.plugins.enabledAllowlist) {
        if ($settings.enabledPlugins.PSObject.Properties.Name -contains $plugin) {
            $settings.enabledPlugins.$plugin = $true
        } else {
            $settings.enabledPlugins | Add-Member NoteProperty $plugin $true
        }
    }
    [IO.File]::WriteAllText($settingsPath, (($settings | ConvertTo-Json -Depth 20) + "`r`n"), [Text.Encoding]::UTF8)
}

function Test-CopilotPlugins {
    param([pscustomobject]$Config)
    $settingsPath = Join-Path $env:USERPROFILE ".copilot\settings.json"
    if (-not (Test-Path $settingsPath)) {
        Add-Result "GATED" "plugins:settings" "Copilot settings are absent; use -ConfigurePlugins."
        return
    }
    try {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
    } catch {
        Add-Result "FAIL" "plugins:settings" "Copilot settings JSON is invalid."
        return
    }
    $enabled = @()
    if ($settings.enabledPlugins) {
        $enabled = @($settings.enabledPlugins.PSObject.Properties | Where-Object { $_.Value -eq $true } | ForEach-Object { $_.Name })
    }
    foreach ($plugin in $Config.plugins.enabledAllowlist) {
        if ($enabled -contains $plugin) {
            Add-Result "PASS" "plugin:$plugin" "Enabled."
        } else {
            Add-Result "GATED" "plugin:$plugin" "Required allowlisted plugin is not enabled."
        }
    }
    foreach ($plugin in $Config.plugins.mustBeDisabled) {
        if ($enabled -contains $plugin) {
            Add-Result "FAIL" "plugin:$plugin" "Must remain disabled."
        } else {
            Add-Result "PASS" "plugin:$plugin" "Not enabled."
        }
    }
    $unexpected = @($enabled | Where-Object { $Config.plugins.enabledAllowlist -notcontains $_ })
    if ($unexpected.Count -gt 0) {
        Add-Result "FAIL" "plugins:allowlist" "Unexpected enabled plugins: $($unexpected -join ', ')"
    } else {
        Add-Result "PASS" "plugins:allowlist" "Enabled plugin set matches the allowlist."
    }
}

function Test-CodexBuildPrerequisites {
    param([pscustomobject]$Config)
    $checks = @{
        "llvm:clang-cl" = "C:\Program Files\LLVM\bin\clang-cl.exe"
        "llvm:lld-link" = "C:\Program Files\LLVM\bin\lld-link.exe"
        "xwin:crt" = (Join-Path $env:USERPROFILE ".xwin\crt")
        "xwin:sdk" = (Join-Path $env:USERPROFILE ".xwin\sdk")
        "codex:sccache" = "D:\codex-sccache"
        "codex:iteration-env" = (Join-Path $Root "codex\scripts\iteration-env.sh")
        "codex:rusty-v8" = (Join-Path $env:USERPROFILE ".cargo\.rusty_v8\rusty_v8_release_x86_64-pc-windows-msvc_v$($Config.codex.rustyV8Version).lib")
    }
    foreach ($entry in $checks.GetEnumerator()) {
        if (Test-Path $entry.Value) {
            Add-Result "PASS" $entry.Key $entry.Value
        } else {
            Add-Result "GATED" $entry.Key "Missing $($entry.Value)."
        }
    }
    if ($env:RUSTC_WRAPPER) {
        Add-Result "FAIL" "codex:global-rustc-wrapper" "RUSTC_WRAPPER must not be globally forced."
    } else {
        Add-Result "PASS" "codex:global-rustc-wrapper" "Source codex/scripts/iteration-env.sh per iteration shell."
    }
    if ($CodexPackagePath) {
        if (Test-Path $CodexPackagePath) {
            Add-Result "PASS" "codex:package-input" "Operator-supplied local package exists."
        } else {
            Add-Result "FAIL" "codex:package-input" "Operator-supplied package is missing."
        }
    } elseif ($CodexRef) {
        Add-Result "PASS" "codex:ref-input" "Operator supplied a Codex source ref."
    } else {
        Add-Result "GATED" "codex:publication" "Publish commit $($Config.codex.packageFixPublicationCommit) or supply -CodexPackagePath/-CodexRef; it is not a remote restore ref."
    }
    if ($ToolkitRef) {
        Add-Result "PASS" "plugins:source-input" "Operator supplied a toolkit source ref."
    } else {
        Add-Result "GATED" "plugins:publication" "Publish local-only plugin fixes or supply -ToolkitRef; never patch installed caches."
    }
}

function Test-ReleaseAndRuntimeGates {
    $requiredFiles = @{
        "codex:static-audit" = (Join-Path $Root "codex\scripts\audit_network_calls.sh")
        "codex:runtime-audit" = (Join-Path $Root "codex\scripts\runtime_audit.ps1")
        "codex:publish-profile" = (Join-Path $Root "codex\.claude\commands\publish-sandbox-patch.md")
        "happy:android-release" = (Join-Path $Root "packages\happy-app\release-android.cjs")
        "happy:app-package" = (Join-Path $Root "packages\happy-app\package.json")
    }
    foreach ($entry in $requiredFiles.GetEnumerator()) {
        if (Test-Path $entry.Value) {
            Add-Result "PASS" $entry.Key $entry.Value
        } else {
            Add-Result "FAIL" $entry.Key "Required gate source is missing: $($entry.Value)"
        }
    }
    $releaseScript = Join-Path $Root "packages\happy-app\release-android.cjs"
    if (Test-Path $releaseScript) {
        $releaseText = Get-Content $releaseScript -Raw
        if ($releaseText -match "com\.evyatar109\.happy") {
            Add-Result "PASS" "happy:package-id" "Release script pins com.evyatar109.happy."
        } else {
            Add-Result "FAIL" "happy:package-id" "Release script package id is stale."
        }
    }
    $appPackagePath = Join-Path $Root "packages\happy-app\package.json"
    if (Test-Path $appPackagePath) {
        $appPackage = Get-Content $appPackagePath -Raw | ConvertFrom-Json
        if ($appPackage.scripts.prebuild -match "blocked:" -and
            $appPackage.scripts."release:android" -eq "node release-android.cjs") {
            Add-Result "PASS" "happy:release-entrypoints" "Expo prebuild is blocked and the Android release entry point is current."
        } else {
            Add-Result "FAIL" "happy:release-entrypoints" "Expo prebuild or Android release entry points are stale."
        }
    }
    $gradlePath = Join-Path $Root "packages\happy-app\android\app\build.gradle"
    if ((Test-Path $gradlePath) -and (Get-Content $gradlePath -Raw) -match "D:/cxb") {
        Add-Result "PASS" "happy:cmake-short-root" "Gradle redirects native staging to D:/cxb."
    } else {
        Add-Result "FAIL" "happy:cmake-short-root" "Gradle is missing the D:/cxb staging pin."
    }
    Add-Result "GATED" "codex:build-validation" "After source publication/restore, source iteration-env.sh and run targeted cargo check/build gates." $false
    Add-Result "GATED" "codex:runtime-validation" "Runtime audit requires an elevated operator-run Codex session." $false
    Add-Result "GATED" "happy:release-validation" "Signing, Firebase upload, release, and distribution remain operator-run gates." $false
}

function Test-SecretAclGate {
    param([string]$Name, [string]$Path, [string]$Description)
    if (-not (Test-Path $Path)) {
        Add-Result "GATED" "gate:$Name" "$Description requires operator interaction." $false
        return
    }
    try {
        $acl = Get-Acl $Path
        $unsafe = @($acl.Access | Where-Object {
            $_.AccessControlType -eq "Allow" -and
            $_.IdentityReference -match "Everyone|Users|Authenticated Users" -and
            $_.FileSystemRights.ToString() -match "Write|FullControl|Modify"
        })
        if ($unsafe.Count -gt 0) {
            Add-Result "FAIL" "gate:$Name" "$Description exists but has broad write ACLs."
        } else {
            Add-Result "PASS" "gate:$Name" "$Description exists; contents were not read."
        }
    } catch {
        Add-Result "GATED" "gate:$Name" "$Description exists, but ACL inspection failed." $false
    }
}

function Test-JsonSecretGate {
    param(
        [string]$Name,
        [string]$Path,
        [string]$Description,
        [string[]]$RequiredProperties = @()
    )
    if (-not (Test-Path $Path)) {
        Add-Result "GATED" "gate:$Name" "$Description requires operator interaction." $false
        return
    }
    try {
        $value = Get-Content $Path -Raw | ConvertFrom-Json
        if (-not $value -or $value.PSObject.Properties.Count -eq 0) {
            Add-Result "FAIL" "gate:$Name" "$Description is not a nonempty JSON object."
            return
        }
        foreach ($property in $RequiredProperties) {
            if ($value.PSObject.Properties.Name -notcontains $property) {
                Add-Result "FAIL" "gate:$Name" "$Description is missing required schema property '$property'."
                return
            }
        }
        $acl = Get-Acl $Path
        $unsafe = @($acl.Access | Where-Object {
            $_.AccessControlType -eq "Allow" -and
            $_.IdentityReference -match "Everyone|Users|Authenticated Users" -and
            $_.FileSystemRights.ToString() -match "Write|FullControl|Modify"
        })
        if ($unsafe.Count -gt 0) {
            Add-Result "FAIL" "gate:$Name" "$Description has broad write ACLs."
        } else {
            Add-Result "PASS" "gate:$Name" "$Description JSON shape and ACLs are valid; values were not printed."
        }
    } catch {
        Add-Result "FAIL" "gate:$Name" "$Description is not valid JSON or its ACL cannot be read."
    }
}

function Test-PropertiesSecretGate {
    param([string]$Name, [string]$Path, [string]$Description, [string[]]$RequiredKeys)
    if (-not (Test-Path $Path)) {
        Add-Result "GATED" "gate:$Name" "$Description requires operator interaction." $false
        return
    }
    try {
        $keys = @(Get-Content $Path | Where-Object { $_ -match "^[A-Za-z0-9_.-]+\s*=" } |
            ForEach-Object { ($_ -split "=", 2)[0].Trim() })
        $missing = @($RequiredKeys | Where-Object { $keys -notcontains $_ })
        if ($missing.Count -gt 0) {
            Add-Result "FAIL" "gate:$Name" "$Description is missing required keys: $($missing -join ', ')."
            return
        }
        $acl = Get-Acl $Path
        $unsafe = @($acl.Access | Where-Object {
            $_.AccessControlType -eq "Allow" -and
            $_.IdentityReference -match "Everyone|Users|Authenticated Users" -and
            $_.FileSystemRights.ToString() -match "Write|FullControl|Modify"
        })
        if ($unsafe.Count -gt 0) {
            Add-Result "FAIL" "gate:$Name" "$Description has broad write ACLs."
        } else {
            Add-Result "PASS" "gate:$Name" "$Description key shape and ACLs are valid; values were not printed."
        }
    } catch {
        Add-Result "FAIL" "gate:$Name" "$Description could not be validated."
    }
}

function Test-CloudflareTunnelIdentity {
    param([pscustomobject]$CloudflaredConfig)
    $expectedName = [string]$CloudflaredConfig.namedTunnel.name
    $expectedId = [string]$CloudflaredConfig.namedTunnel.id
    $credentials = Join-Path $env:USERPROFILE ".cloudflared\$expectedId.json"
    if (Test-Path $credentials) {
        try {
            $acl = Get-Acl $credentials
            $unsafe = @($acl.Access | Where-Object {
                $_.AccessControlType -eq "Allow" -and
                $_.IdentityReference -match "Everyone|Users|Authenticated Users" -and
                $_.FileSystemRights.ToString() -match "Write|FullControl|Modify"
            })
            if ($unsafe.Count -gt 0) {
                Add-Result "FAIL" "cloudflare:tunnel-credentials" "Credential file $expectedId.json has broad write ACLs."
            } else {
                Add-Result "PASS" "cloudflare:tunnel-credentials" "Credential filename and ACL match tunnel id $expectedId; contents were not read."
            }
        } catch {
            Add-Result "GATED" "cloudflare:tunnel-credentials" "Credential filename matches $expectedId, but ACL inspection failed."
        }
    } else {
        Add-Result "GATED" "cloudflare:tunnel-credentials" "Expected credential file named $expectedId.json."
    }
    $command = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $command) {
        Add-Result "GATED" "cloudflare:tunnel-identity" "cloudflared is unavailable; expected tunnel $expectedName ($expectedId)."
        return
    }
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $raw = @(& $command.Source tunnel list --output json 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
    }
    if ($exitCode -ne 0) {
        Add-Result "GATED" "cloudflare:tunnel-identity" "Could not query tunnel names/ids; expected $expectedName ($expectedId)."
        return
    }
    try {
        $jsonStart = -1
        for ($index = 0; $index -lt $raw.Count; $index++) {
            if ([string]$raw[$index] -match "^\s*[\[\{]") {
                $jsonStart = $index
                break
            }
        }
        if ($jsonStart -lt 0) {
            throw "JSON payload not found."
        }
        $tunnels = (($raw[$jsonStart..($raw.Count - 1)] | Out-String).Trim() | ConvertFrom-Json)
        $match = @($tunnels | Where-Object { $_.name -eq $expectedName -and $_.id -eq $expectedId })
        if ($match.Count -eq 1) {
            Add-Result "PASS" "cloudflare:tunnel-identity" "Named tunnel is $expectedName with id $expectedId."
        } else {
            Add-Result "FAIL" "cloudflare:tunnel-identity" "Expected exactly one tunnel named $expectedName with id $expectedId."
        }
    } catch {
        Add-Result "GATED" "cloudflare:tunnel-identity" "Tunnel query returned no parseable names/ids."
    }
}

function Test-OperatorGates {
    Add-Result "GATED" "gate:github-secondary-saml" "Second GitHub account and SAML authorization require an operator check." $false
    Test-JsonSecretGate "codex-copilot-login" (Join-Path $env:USERPROFILE ".codex\auth.json") "Codex Copilot login"
    Test-PropertiesSecretGate "android-signing" (Join-Path $Root "packages\happy-app\android\keystore.properties") `
        "Android signing properties" @("RELEASE_STORE_FILE", "RELEASE_STORE_PASSWORD", "RELEASE_KEY_ALIAS", "RELEASE_KEY_PASSWORD")
    Test-JsonSecretGate "firebase-login" (Join-Path $env:APPDATA "configstore\firebase-tools.json") "Firebase login"
    Test-SecretAclGate "cloudflare-login" (Join-Path $env:USERPROFILE ".cloudflared\cert.pem") "Cloudflare login"
    Test-CloudflareTunnelIdentity $config.portable.cloudflared
    Test-JsonSecretGate "public-tunnel" (Join-Path $env:USERPROFILE ".happy\public-tunnel.json") `
        "Happy public tunnel configuration" @("hostname", "tunnelName", "cloudflareAccess")
    Add-Result "GATED" "gate:usb-authorization" "USB authorization requires the operator and a connected device." $false
    Add-Result "GATED" "gate:publication" "Pushes, tags, releases, and distribution are intentionally outside bootstrap." $false
}

function Test-WorkspaceBuildState {
    if (Test-Path (Join-Path $Root "node_modules")) {
        Add-Result "PASS" "workspace:dependencies" "node_modules exists."
    } else {
        Add-Result "GATED" "workspace:dependencies" "Use -InstallWorkspaceDependencies."
    }
    foreach ($path in @("packages\happy-wire\dist", "packages\happy-server\dist", "packages\happy-cli\dist")) {
        if (Test-Path (Join-Path $Root $path)) {
            Add-Result "PASS" "workspace:$path" "Build output exists."
        } else {
            Add-Result "GATED" "workspace:$path" "Use -BuildAndLinkHappy."
        }
    }
    if (Get-Command happy -ErrorAction SilentlyContinue) {
        Add-Result "PASS" "workspace:happy-global-command" "A global happy command is present; validation does not execute it."
    } else {
        Add-Result "GATED" "workspace:happy-global-command" "Use -BuildAndLinkHappy to create the source link."
    }
}

function Ensure-ShortClone {
    if (Test-Path $ShortClonePath) {
        if ((Invoke-Git $ShortClonePath @("rev-parse", "--is-inside-work-tree") -AllowFailure) -ne 0) {
            throw "$ShortClonePath exists but is not a git clone."
        }
        Add-Result "PASS" "android:short-clone" "$ShortClonePath already exists."
        return
    }
    $origin = (& git -C $Root remote get-url origin).Trim()
    Invoke-Native "git" @("clone", "--recurse-submodules", $origin, $ShortClonePath) | Out-Null
    Add-Result "PASS" "android:short-clone" "Created real short clone at $ShortClonePath."
}

function Write-Summary {
    Write-Host ""
    Write-Host "VM bootstrap acceptance"
    Write-Host "======================="
    foreach ($result in $script:Results) {
        Write-Host ("{0,-5} {1}: {2}" -f $result.Status, $result.Name, $result.Detail)
    }
    $pass = @($script:Results | Where-Object Status -eq "PASS").Count
    $gated = @($script:Results | Where-Object Status -eq "GATED").Count
    $fail = @($script:Results | Where-Object { $_.Status -eq "FAIL" -and $_.Required }).Count
    Write-Host ""
    Write-Host "Summary: PASS=$pass GATED=$gated FAIL=$fail"
    if ($fail -gt 0) {
        exit 1
    }
}

if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $PSScriptRoot "vm-bootstrap-config.json"
}
$Root = (Resolve-Path $Root).Path
if (-not $ManifestPath) {
    $ManifestPath = Join-Path $Root "docs\vm-migration-manifest.json"
}
if (-not (Test-Path $ConfigPath) -or -not (Test-Path $ManifestPath)) {
    throw "Bootstrap config or migration manifest is missing."
}
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($config.schemaVersion -ne 1 -or $manifest.schemaVersion -ne 1) {
    throw "Unsupported bootstrap or migration manifest schema."
}
if ($AcceptAndroidLicenses -and -not $ConfigureAndroid) {
    throw "-AcceptAndroidLicenses requires -ConfigureAndroid."
}
$mutatingSwitches = @(
    $RestoreWorkspace,
    $InstallToolchains,
    $RepairNodeHookShim,
    $InstallWorkspaceDependencies,
    $BuildAndLinkHappy,
    $ConfigurePlugins,
    $ConfigureAndroid,
    $AcceptAndroidLicenses,
    $CreateShortClone
)
if ($ValidateOnly -and @($mutatingSwitches | Where-Object { $_ }).Count -gt 0) {
    throw "-ValidateOnly cannot be combined with a mutating stage."
}

Ensure-DriveLayout $config ([bool]$InstallToolchains)
if ($InstallToolchains) {
    Install-AllToolchains $config
}
Ensure-NarrowWrappers ([bool]$InstallToolchains)
Test-NodeHookShim $config.toolchains.node ([bool]($InstallToolchains -or $RepairNodeHookShim))

Test-Version "node" $config.toolchains.node
Test-Version "npm" $config.toolchains.npm
Test-Version "pnpm" $config.toolchains.pnpm
Test-Version "rust" $config.toolchains.rust
Test-Version "llvm" $config.toolchains.llvm
Test-Version "cmake" $config.toolchains.cmake
Test-Version "ninja" $config.toolchains.ninja
Test-Version "just" $config.toolchains.just
Test-Version "python" $config.toolchains.python
Test-Version "perl" $config.toolchains.perl @("-v")
Test-Version "sccache" $config.toolchains.sccache
Test-Version "xwin" $config.toolchains.xwin
Test-Version "jq" $config.toolchains.jq
Test-Version "firebase" $config.toolchains.firebase

$cloudflaredText = Get-CommandText "cloudflared"
if ($cloudflaredText -and $cloudflaredText -match [regex]::Escape($config.portable.cloudflared.version)) {
    $cloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
    $cloudflaredHash = if ($cloudflaredCommand) { (Get-FileHash -Algorithm SHA256 $cloudflaredCommand.Source).Hash.ToLowerInvariant() } else { "" }
    if ($cloudflaredHash -eq $config.portable.cloudflared.sha256.ToLowerInvariant()) {
        Add-Result "PASS" "tool:cloudflared" "Version and pinned SHA256 match $($config.portable.cloudflared.version)."
    } else {
        Add-Result "FAIL" "tool:cloudflared" "Version matches, but the executable SHA256 does not match the pin."
    }
} else {
    Add-Result "GATED" "tool:cloudflared" "Expected verified portable cloudflared $($config.portable.cloudflared.version)."
}
$javaText = Get-CommandText "java" @("-version")
if ($javaText -and $javaText -match "17\.0\.19") {
    Add-Result "PASS" "tool:jdk" "JDK 17.0.19 is active."
} else {
    Add-Result "GATED" "tool:jdk" "Expected verified portable Temurin $($config.portable.jdk.version)."
}

if ($RestoreWorkspace) {
    Restore-MigrationTopology $manifest
}
Test-MigrationTopology $manifest

if ($InstallWorkspaceDependencies) {
    Invoke-Native "pnpm" @("install", "--frozen-lockfile") | Out-Null
}
if ($BuildAndLinkHappy) {
    Build-HappySource
}
Test-WorkspaceBuildState

if ($ConfigureAndroid) {
    Configure-AndroidSdk $config
}
Test-AndroidSdk $config
if ($CreateShortClone) {
    Ensure-ShortClone
} elseif (Test-Path $ShortClonePath) {
    Add-Result "PASS" "android:short-clone" "Real short clone exists at $ShortClonePath."
} else {
    Add-Result "GATED" "android:short-clone" "Optional real short clone is absent; use -CreateShortClone."
}

if ($ConfigurePlugins) {
    Configure-CopilotPlugins $config
}
Test-CopilotPlugins $config
Test-CodexBuildPrerequisites $config
Test-ReleaseAndRuntimeGates
$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
$codexPackagePath = if ($codexCommand) { Join-Path (Split-Path $codexCommand.Source) "node_modules\@gim-home\codex\package.json" } else { $null }
if ($codexPackagePath -and (Test-Path $codexPackagePath)) {
    $codexPackage = Get-Content $codexPackagePath -Raw | ConvertFrom-Json
    Add-Result "PASS" "codex:global-package" "Installed package version is $($codexPackage.version)."
} else {
    Add-Result "GATED" "codex:global-package" "Install an operator-supplied package or a published release."
}
Test-OperatorGates
Write-Summary
