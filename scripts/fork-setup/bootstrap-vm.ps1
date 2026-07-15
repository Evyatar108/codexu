[CmdletBinding()]
param(
    [string]$Root,
    [string]$ManifestPath,
    [string]$ConfigPath,
    [switch]$ValidateOnly,
    [switch]$RestoreWorkspace,
    [switch]$AllowNewerRootSnapshot,
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
    [string]$CodexPackageSha256,
    [string]$CodexPackageExpectedVersion,
    [switch]$InstallCodexPackage,
    [string]$CodexRef,
    [string]$CodexExpectedCommit,
    [string]$ToolkitRef,
    [string]$ToolkitExpectedCommit,
    [string]$ToolkitSourcePath,
    [switch]$LibraryOnly
)

$ErrorActionPreference = "Stop"
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = "1"
$script:Results = New-Object System.Collections.Generic.List[object]
$script:CodexPublicationInputValid = $false
$script:CodexPackageInputValid = $false
$script:CodexRefInputValid = $false
$script:ToolkitPublicationInputValid = $false
$script:ToolkitValidatedSourcePath = $null

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
    Invoke-Native "rustup" @("toolchain", "install", $Config.codex.rustToolchain, "--profile", "minimal") | Out-Null
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
        $branchExists = (Invoke-Git $Repository @("show-ref", "--verify", "--quiet", "refs/heads/$Branch") -AllowFailure) -eq 0
        if ($branchExists) {
            $branchCommit = (& git -C $Repository rev-parse "refs/heads/$Branch").Trim()
            if ($branchCommit -ne $Commit) {
                throw "Existing branch $Branch points to $branchCommit, expected $Commit. Refusing to move it."
            }
            Invoke-Git $Repository @("worktree", "add", $Path, $Branch) | Out-Null
        } else {
            Invoke-Git $Repository @("worktree", "add", "--detach", $Path, $Commit) | Out-Null
            Invoke-Git $Path @("switch", "--create", $Branch, $Commit) | Out-Null
        }
    }
    $head = (& git -C $Path rev-parse HEAD).Trim()
    $actualBranch = (& git -C $Path branch --show-current).Trim()
    if ($head -ne $Commit -or $actualBranch -ne $Branch) {
        throw "Worktree $Path expected $Branch at $Commit; found $actualBranch at $head."
    }
}

function Set-SubmoduleUrlBeforeUpdate {
    param([string]$Repository, [string]$SubmodulePath, [string]$Url)
    Invoke-Git $Repository @("submodule", "sync", "--", $SubmodulePath) | Out-Null
    Invoke-Git $Repository @("config", "submodule.$SubmodulePath.url", $Url) | Out-Null
}

function Ensure-ExistingBranchAtCommit {
    param([string]$Repository, [string]$Branch, [string]$Commit)
    $head = (& git -C $Repository rev-parse HEAD).Trim()
    $currentBranch = (& git -C $Repository branch --show-current | Out-String).Trim()
    $branchExists = (Invoke-Git $Repository @("show-ref", "--verify", "--quiet", "refs/heads/$Branch") -AllowFailure) -eq 0
    if ($branchExists) {
        $branchCommit = (& git -C $Repository rev-parse "refs/heads/$Branch").Trim()
        if ($branchCommit -ne $Commit) {
            throw "Existing branch $Branch points to $branchCommit, expected $Commit. Refusing to move resumed work."
        }
        if ($currentBranch -eq $Branch -and $head -eq $Commit) {
            return
        }
        if (-not $currentBranch -and $head -eq $Commit -and -not (& git -C $Repository status --porcelain)) {
            Invoke-Git $Repository @("switch", $Branch) | Out-Null
            return
        }
        throw "Repository $Repository is on '$currentBranch' at $head. Refusing to switch or discard resumed work."
    }
    if ($currentBranch -or $head -ne $Commit -or (& git -C $Repository status --porcelain)) {
        throw "Cannot create $Branch safely: expected clean detached HEAD at $Commit, found '$currentBranch' at $head."
    }
    Invoke-Git $Repository @("switch", "--create", $Branch, $Commit) | Out-Null
}

function Prepare-NestedSubmodule {
    param(
        [string]$Wrapper,
        [string]$SubmodulePath,
        [string]$Url,
        [string]$ExpectedCommit,
        [string]$ExpectedBranch
    )
    $nested = Join-Path $Wrapper ($SubmodulePath -replace "/", "\")
    $isInitialized = Test-Path (Join-Path $nested ".git")
    $freshClone = $false
    if ($isInitialized) {
        $head = (& git -C $nested rev-parse HEAD).Trim()
        $branch = (& git -C $nested branch --show-current | Out-String).Trim()
        $status = @(& git -C $nested status --porcelain)
        if ($branch) {
            if ($status.Count -gt 0 -or $head -ne $ExpectedCommit -or
                ($ExpectedBranch -and $branch -ne $ExpectedBranch)) {
                throw "Active nested work at $nested diverged. Refusing recursive update, detach, reset, or branch movement."
            }
            Set-SubmoduleUrlBeforeUpdate $Wrapper $SubmodulePath $Url
            Invoke-Git $nested @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
            return
        }
        if ($status.Count -gt 0) {
            throw "Detached nested checkout at $nested is dirty; refusing restore."
        }
    }
    Set-SubmoduleUrlBeforeUpdate $Wrapper $SubmodulePath $Url
    if (-not $isInitialized) {
        if (Test-Path $nested) {
            $children = @(Get-ChildItem $nested -Force)
            if ($children.Count -gt 0) {
                throw "Uninitialized nested path is not empty: $nested"
            }
            Remove-Item $nested -Force
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $nested) | Out-Null
        Invoke-Native "git" @("clone", "--no-checkout", $Url, $nested) | Out-Null
        Invoke-Git $Wrapper @("submodule", "absorbgitdirs", "--", $SubmodulePath) | Out-Null
        $freshClone = $true
    }
    $remotes = @(& git -C $nested remote)
    if ($remotes -contains "origin") {
        Invoke-Git $nested @("remote", "set-url", "origin", $Url) | Out-Null
    } else {
        Invoke-Git $nested @("remote", "add", "origin", $Url) | Out-Null
    }
    if ((Invoke-Git $nested @("cat-file", "-e", "$ExpectedCommit^{commit}") -AllowFailure) -ne 0) {
        Invoke-Git $nested @("fetch", "origin", $ExpectedCommit) | Out-Null
    }
    $head = (& git -C $nested rev-parse HEAD 2>$null | Out-String).Trim()
    if ($freshClone -or $head -ne $ExpectedCommit) {
        Invoke-Git $nested @("checkout", "--detach", $ExpectedCommit) | Out-Null
    }
    if ($ExpectedBranch) {
        Ensure-ExistingBranchAtCommit $nested $ExpectedBranch $ExpectedCommit
    }
    Invoke-Git $nested @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--recursive") | Out-Null
}

function Assert-RootRestorePreflight {
    param([pscustomobject]$Manifest)
    $head = (& git -C $Root rev-parse HEAD).Trim()
    $branch = (& git -C $Root branch --show-current).Trim()
    $expectedHead = [string]$Manifest.restoreVerification.snapshot
    $expectedBranch = [string]$Manifest.snapshotBranch
    $status = @(& git -C $Root status --porcelain)
    $exact = $branch -eq $expectedBranch -and $head -eq $expectedHead
    $newerAllowed = $false
    if ($AllowNewerRootSnapshot -and $branch -eq $expectedBranch -and $status.Count -eq 0) {
        $newerAllowed = (Invoke-Git $Root @("merge-base", "--is-ancestor", $expectedHead, $head) -AllowFailure) -eq 0
    }
    if ($status.Count -gt 0 -or (-not $exact -and -not $newerAllowed)) {
        throw "Root restore preflight failed before mutation. Expected clean $expectedBranch at $expectedHead" +
            $(if ($AllowNewerRootSnapshot) { " or a clean descendant on the same branch." } else { "." }) +
            " Found $branch at $head."
    }
}

function Restore-MigrationTopology {
    param([pscustomobject]$Manifest)
    Assert-RootRestorePreflight $Manifest
    $codex = Join-Path $Root "codex"
    $toolkit = Join-Path $Root "ai-developer-toolkit"
    Set-SubmoduleUrlBeforeUpdate $Root "codex" $Manifest.repositories.codex.url
    Set-SubmoduleUrlBeforeUpdate $Root "ai-developer-toolkit" $Manifest.repositories.aiDeveloperToolkit.url
    Invoke-Git $Root @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--", "codex", "ai-developer-toolkit") | Out-Null
    $codexRecorded = (& git -C $codex rev-parse "HEAD:external/repos/codex-patched").Trim()
    Prepare-NestedSubmodule $codex "external/repos/codex-patched" $Manifest.repositories.codexPatched.url $codexRecorded $null
    Prepare-NestedSubmodule $toolkit "external/repos/mcporter" $Manifest.repositories.mcporter.url $Manifest.repositories.mcporter.activeCommit $null
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
    Prepare-NestedSubmodule $wrapper "external/repos/codex-patched" $Manifest.repositories.codexPatched.url `
        $Manifest.repositories.codexPatched.activeCommit $Manifest.repositories.codexPatched.activeBranch
    $buildWrapper = Join-Path $codex ".worktrees\codex-rs-core-change-incremental-build-over-30m"
    $buildRecorded = (& git -C $buildWrapper rev-parse "HEAD:external/repos/codex-patched").Trim()
    Prepare-NestedSubmodule $buildWrapper "external/repos/codex-patched" $Manifest.repositories.codexPatched.url $buildRecorded $null
    foreach ($toolkitWorktree in @(
        (Join-Path $toolkit ".worktrees\publish-ralph-564"),
        (Join-Path $toolkit ".worktrees\ralph-v2-encrypted-role-wait-terminal-hardening"),
        (Join-Path $toolkit ".worktrees\ralph-model-routing-v564-hybrid")
    )) {
        Prepare-NestedSubmodule $toolkitWorktree "external/repos/mcporter" $Manifest.repositories.mcporter.url `
            $Manifest.repositories.mcporter.activeCommit $null
    }
    $nested = Join-Path $wrapper "external\repos\codex-patched"
    $nestedRemotes = @(& git -C $nested remote)
    if ($nestedRemotes -contains "vm-mirror") {
        Invoke-Git $nested @("remote", "set-url", "vm-mirror", $Manifest.repositories.codexPatched.url) | Out-Null
    } else {
        Invoke-Git $nested @("remote", "add", "vm-mirror", $Manifest.repositories.codexPatched.url) | Out-Null
    }
    Invoke-Git $nested @("fetch", "vm-mirror", "--prune") | Out-Null
}

function Test-MigrationTopology {
    param([pscustomobject]$Manifest)
    $rootHead = (& git -C $Root rev-parse HEAD 2>$null).Trim()
    $rootBranch = (& git -C $Root branch --show-current 2>$null).Trim()
    $expectedRootHead = [string]$Manifest.restoreVerification.snapshot
    $expectedRootBranch = [string]$Manifest.snapshotBranch
    $rootStatus = @(& git -C $Root status --porcelain)
    $exactRoot = $rootHead -eq $expectedRootHead -and $rootBranch -eq $expectedRootBranch
    $allowedNewerRoot = $false
    if ($AllowNewerRootSnapshot -and $rootBranch -eq $expectedRootBranch -and $rootStatus.Count -eq 0) {
        $allowedNewerRoot = (Invoke-Git $Root @("merge-base", "--is-ancestor", $expectedRootHead, $rootHead) -AllowFailure) -eq 0
    }
    if (($exactRoot -or $allowedNewerRoot) -and $rootStatus.Count -eq 0) {
        $mode = if ($exactRoot) { "exact" } else { "explicitly allowed newer descendant" }
        Add-Result "PASS" "topology:root-snapshot" "$rootBranch at $rootHead is the $mode clean snapshot."
    } else {
        Add-Result "FAIL" "topology:root-snapshot" "Expected clean $expectedRootBranch at $expectedRootHead; found $rootBranch at $rootHead."
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
            $status = @(& git -C $check[1] status --porcelain)
            $allowedStatus = @()
            if ($check[0] -eq "codex-prd-b") {
                $allowedStatus = @(" M external/repos/codex-patched")
            }
            $unexpected = @($status | Where-Object { $allowedStatus -notcontains $_ })
            if ($unexpected.Count -gt 0) {
                Add-Result "FAIL" "topology:$($check[0])" "Exact branch/HEAD, but unexpected worktree changes exist."
            } else {
                Add-Result "PASS" "topology:$($check[0])" "$branch at $head with permitted cleanliness."
            }
            $submoduleRows = @(& git -C $check[1] submodule status --recursive 2>$null)
            if ($LASTEXITCODE -ne 0 -or $submoduleRows.Count -eq 0) {
                Add-Result "FAIL" "topology:$($check[0])-submodules" "Recursive submodule status is unavailable or empty."
            } else {
                $badRows = @($submoduleRows | Where-Object {
                    $_ -match "^[-U]" -or
                    ($_ -match "^\+" -and -not ($check[0] -eq "codex-prd-b" -and $_ -match " external/repos/codex-patched "))
                })
                if ($badRows.Count -gt 0) {
                    Add-Result "FAIL" "topology:$($check[0])-submodules" "Recursive submodules are missing or at unexpected commits."
                } else {
                    Add-Result "PASS" "topology:$($check[0])-submodules" "Recursive submodules are initialized at permitted commits."
                }
            }
        } else {
            Add-Result "FAIL" "topology:$($check[0])" "Expected $($check[2]) at $($check[3]); found $branch at $head."
        }
    }
    $wrapperPath = Join-Path $Root "codex\.worktrees\codex-v2-copilot-encrypted-subagent-handoff"
    $nested = Join-Path $wrapperPath "external\repos\codex-patched"
    if (Test-Path (Join-Path $nested ".git")) {
        $head = (& git -C $nested rev-parse HEAD 2>$null).Trim()
        $branch = (& git -C $nested branch --show-current 2>$null).Trim()
        $status = @(& git -C $nested status --porcelain)
        if ($head -eq $Manifest.repositories.codexPatched.activeCommit -and
            $branch -eq $Manifest.repositories.codexPatched.activeBranch -and
            $status.Count -eq 0) {
            $recorded = (& git -C $wrapperPath rev-parse "HEAD:external/repos/codex-patched" 2>$null).Trim()
            $staged = @(& git -C $wrapperPath diff --cached --name-only -- "external/repos/codex-patched")
            if ($recorded -ne $head -and $staged.Count -eq 0) {
                Add-Result "PASS" "topology:prd-b-gitlink" "Wrapper gitlink is intentionally unstaged while nested source is exact."
            } elseif ($recorded -eq $head -and $staged.Count -eq 0) {
                Add-Result "PASS" "topology:prd-b-gitlink" "Wrapper gitlink and nested source are exact."
            } else {
                Add-Result "FAIL" "topology:prd-b-gitlink" "Wrapper gitlink is staged or inconsistent."
            }
            Add-Result "PASS" "topology:prd-b-nested" "$branch at $head with a clean nested worktree."
        } else {
            Add-Result "FAIL" "topology:prd-b-nested" "Expected exact branch/HEAD and clean nested source; found $branch at $head."
        }
    } else {
        Add-Result "GATED" "topology:prd-b-nested" "Nested PRD B checkout is missing; use -RestoreWorkspace."
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
    $packages = @(
        $Config.android.platform,
        $Config.android.buildTools,
        $Config.android.ndk,
        $Config.android.cmakeApp,
        $Config.android.cmake
    ) +
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
        $Config.android.cmakeApp = "D:\Android\Sdk\cmake\3.22.1"
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
    param([pscustomobject]$Config, [pscustomobject]$Manifest)
    if (-not $script:ToolkitPublicationInputValid) {
        throw "-ConfigurePlugins requires -ToolkitRef and -ToolkitExpectedCommit resolving exactly."
    }
    $source = $script:ToolkitValidatedSourcePath
    if (-not $source) {
        $source = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\toolkit-marketplace"
        if (-not (Test-Path (Join-Path $source ".git"))) {
            Invoke-Native "git" @("clone", "--no-checkout", $Manifest.repositories.aiDeveloperToolkit.url, $source) | Out-Null
        }
        $origin = (& git -C $source remote get-url origin).Trim()
        if ((Normalize-GitUrl $origin) -ne (Normalize-GitUrl $Manifest.repositories.aiDeveloperToolkit.url)) {
            throw "Toolkit marketplace cache has an unexpected origin."
        }
        Invoke-Git $source @("fetch", "origin", $ToolkitRef) | Out-Null
        $resolved = (& git -C $source rev-parse "FETCH_HEAD^{commit}").Trim()
        if ($resolved -ne $ToolkitExpectedCommit) {
            throw "Toolkit marketplace ref no longer matches the expected commit."
        }
        $sourceStatus = @(& git -C $source status --porcelain)
        if ($sourceStatus.Count -gt 0) {
            throw "Toolkit marketplace cache is dirty; refusing to replace installed plugins from it."
        }
        Invoke-Git $source @("switch", "--detach", $ToolkitExpectedCommit) | Out-Null
    }
    $marketplaces = (& copilot plugin marketplace list 2>$null | Out-String)
    if ($marketplaces -match [regex]::Escape($Config.plugins.marketplaceName)) {
        Invoke-Native "copilot" @("plugin", "marketplace", "remove", $Config.plugins.marketplaceName) | Out-Null
    }
    Invoke-Native "copilot" @("plugin", "marketplace", "add", $source) | Out-Null
    $installed = (& copilot plugin list 2>$null | Out-String)
    foreach ($plugin in $Config.plugins.enabledAllowlist) {
        if ($installed -notmatch [regex]::Escape($plugin)) {
            Invoke-Native "copilot" @("plugin", "install", $plugin) | Out-Null
        } else {
            Invoke-Native "copilot" @("plugin", "update", $plugin) | Out-Null
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
        $pluginName = ($plugin -split "@", 2)[0]
        if ($enabled -contains $plugin) {
            $pluginRoot = Join-Path $env:USERPROFILE ".copilot\installed-plugins\ai-developer-toolkit\$pluginName"
            $manifestCandidates = @(
                (Join-Path $pluginRoot ".github\plugin\plugin.json"),
                (Join-Path $pluginRoot ".claude-plugin\plugin.json"),
                (Join-Path $pluginRoot ".copilot-plugin\plugin.json")
            )
            $manifestPath = $manifestCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
            $expectedVersion = [string]$Config.plugins.expectedVersions.$pluginName
            if (-not $manifestPath) {
                Add-Result "FAIL" "plugin:$plugin" "Enabled plugin has no installed manifest."
            } else {
                $installedManifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
                if ($installedManifest.version -eq $expectedVersion) {
                    Add-Result "PASS" "plugin:$plugin" "Enabled at exact version $expectedVersion."
                } else {
                    Add-Result "FAIL" "plugin:$plugin" "Expected version $expectedVersion; found $($installedManifest.version)."
                }
            }
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

function Resolve-ExactGitRef {
    param(
        [string]$Name,
        [string]$Repository,
        [string]$Ref,
        [string]$ExpectedCommit
    )
    if (-not $Ref -and -not $ExpectedCommit) {
        Add-Result "GATED" $Name "Supply both ref and expected commit."
        return $false
    }
    if (-not $Ref -or $ExpectedCommit -notmatch "^[0-9a-fA-F]{40}$") {
        Add-Result "FAIL" $Name "Ref and a full 40-hex expected commit must be supplied together."
        return $false
    }
    if (-not (Test-Path (Join-Path $Repository ".git"))) {
        Add-Result "FAIL" $Name "Repository is unavailable at $Repository."
        return $false
    }
    $resolvedOutput = & git -C $Repository rev-parse "$Ref^{commit}" 2>$null
    $resolved = if ($LASTEXITCODE -eq 0) { ($resolvedOutput | Out-String).Trim() } else { "" }
    if (-not $resolved -or $resolved -ne $ExpectedCommit.ToLowerInvariant()) {
        Add-Result "FAIL" $Name "Ref does not resolve to the operator-supplied expected commit."
        return $false
    }
    Add-Result "PASS" $Name "Ref resolves exactly to $resolved."
    return $true
}

function Resolve-ToolkitPublicationInput {
    param([pscustomobject]$Manifest)
    if ($ToolkitSourcePath) {
        if (-not (Test-Path $ToolkitSourcePath)) {
            Add-Result "FAIL" "plugins:source-input" "Local toolkit source path does not exist."
            return $false
        }
        $source = (Resolve-Path $ToolkitSourcePath).Path
        if (-not (Resolve-ExactGitRef "plugins:source-input" $source $ToolkitRef $ToolkitExpectedCommit)) {
            return $false
        }
        $head = (& git -C $source rev-parse HEAD).Trim()
        $status = @(& git -C $source status --porcelain)
        if ($head -ne $ToolkitExpectedCommit -or $status.Count -gt 0) {
            Add-Result "FAIL" "plugins:local-source" "Local toolkit checkout must be clean and at the exact expected commit."
            return $false
        }
        $script:ToolkitValidatedSourcePath = $source
        Add-Result "PASS" "plugins:local-source" "Validated exact local toolkit source without remote fetch."
        return $true
    }
    if (-not $ToolkitRef -and -not $ToolkitExpectedCommit) {
        Add-Result "GATED" "plugins:source-input" "Supply a local source path or a remote ref with expected commit."
        return $false
    }
    if (-not $ToolkitRef -or $ToolkitExpectedCommit -notmatch "^[0-9a-fA-F]{40}$") {
        Add-Result "FAIL" "plugins:source-input" "Remote toolkit ref and full expected commit are required together."
        return $false
    }
    $remoteRows = @(& git ls-remote $Manifest.repositories.aiDeveloperToolkit.url $ToolkitRef 2>$null)
    $remoteMatch = @($remoteRows | Where-Object { ($_ -split "\s+")[0] -eq $ToolkitExpectedCommit })
    if ($LASTEXITCODE -ne 0 -or $remoteMatch.Count -ne 1) {
        Add-Result "FAIL" "plugins:source-input" "Toolkit remote ref is absent or does not equal the expected commit."
        return $false
    }
    Add-Result "PASS" "plugins:source-input" "Remote toolkit ref is published at the exact expected commit."
    return $true
}

function Test-CodexPackageInput {
    if (-not $CodexPackagePath) {
        Add-Result "GATED" "codex:package-input" "Supply package path, SHA256, and expected version for package-based restore."
        return $false
    }
    if (-not (Test-Path $CodexPackagePath) -or
        $CodexPackageSha256 -notmatch "^[0-9a-fA-F]{64}$" -or
        -not $CodexPackageExpectedVersion) {
        Add-Result "FAIL" "codex:package-input" "Package path, full SHA256, and expected version are required together."
        return $false
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 $CodexPackagePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $CodexPackageSha256.ToLowerInvariant()) {
        Add-Result "FAIL" "codex:package-input" "Package SHA256 does not match operator policy."
        return $false
    }
    if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
        Add-Result "FAIL" "codex:package-input" "Windows tar.exe is required to validate package layout."
        return $false
    }
    $entries = @(& tar.exe -tf $CodexPackagePath 2>$null)
    if ($LASTEXITCODE -ne 0) {
        Add-Result "FAIL" "codex:package-input" "Package is not a readable tar archive."
        return $false
    }
    $packageJsonText = (& tar.exe -xOf $CodexPackagePath "package/package.json" 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Add-Result "FAIL" "codex:package-input" "Package metadata is missing."
        return $false
    }
    try {
        $packageJson = $packageJsonText | ConvertFrom-Json
    } catch {
        Add-Result "FAIL" "codex:package-input" "Package metadata is invalid JSON."
        return $false
    }
    $requiredPatterns = @(
        "^package/bin/codex\.js$",
        "^package/vendor/.+/codex/codex\.exe$",
        "^package/vendor/.+/codex/codex-core\.exe$",
        "^package/vendor/.+/codex/codex-windows-sandbox-setup\.exe$",
        "^package/vendor/.+/codex/codex-command-runner\.exe$"
    )
    $missingLayout = @($requiredPatterns | Where-Object {
        $pattern = $_
        -not ($entries | Where-Object { $_ -match $pattern })
    })
    if ($packageJson.name -ne "@gim-home/codex" -or
        $packageJson.version -ne $CodexPackageExpectedVersion -or
        $missingLayout.Count -gt 0) {
        Add-Result "FAIL" "codex:package-input" "Package name, version, or required binary layout is invalid."
        return $false
    }
    Add-Result "PASS" "codex:package-input" "Package metadata, version, layout, and SHA256 policy are exact."
    $script:CodexPackageInputValid = $true
    return $true
}

function Install-ValidatedCodexPackage {
    if (-not $script:CodexPackageInputValid) {
        throw "-InstallCodexPackage requires a package that passed path, metadata, layout, version, and SHA256 validation."
    }
    Invoke-Native "npm" @("install", "--global", $CodexPackagePath) | Out-Null
    $provenancePath = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\codex-install-provenance.json"
    New-Item -ItemType Directory -Force -Path (Split-Path $provenancePath) | Out-Null
    $provenance = [ordered]@{
        packagePath = (Resolve-Path $CodexPackagePath).Path
        sha256 = $CodexPackageSha256.ToLowerInvariant()
        version = $CodexPackageExpectedVersion
        installedAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json
    $temporary = "$provenancePath.$PID.tmp"
    [IO.File]::WriteAllText($temporary, "$provenance`r`n", [Text.Encoding]::UTF8)
    if (Test-Path $provenancePath) {
        [IO.File]::Replace($temporary, $provenancePath, $null)
    } else {
        [IO.File]::Move($temporary, $provenancePath)
    }
}

function Test-InstalledCodexProvenance {
    $command = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $command) {
        Add-Result "GATED" "codex:global-package" "No installed Codex command."
        return
    }
    $packageRoot = Join-Path (Split-Path $command.Source) "node_modules\@gim-home\codex"
    $packageJsonPath = Join-Path $packageRoot "package.json"
    $provenancePath = Join-Path $env:LOCALAPPDATA "codexu-bootstrap\codex-install-provenance.json"
    if (-not (Test-Path $packageJsonPath)) {
        Add-Result "FAIL" "codex:global-package" "Installed command is not backed by @gim-home/codex metadata."
        return
    }
    $metadata = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    $requiredInstalled = @(
        (Join-Path $packageRoot "bin\codex.js"),
        [string](Get-ChildItem (Join-Path $packageRoot "vendor") -Recurse -Filter "codex.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
        [string](Get-ChildItem (Join-Path $packageRoot "vendor") -Recurse -Filter "codex-core.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
        [string](Get-ChildItem (Join-Path $packageRoot "vendor") -Recurse -Filter "codex-windows-sandbox-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
        [string](Get-ChildItem (Join-Path $packageRoot "vendor") -Recurse -Filter "codex-command-runner.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
    )
    if (@($requiredInstalled | Where-Object { -not $_ -or -not (Test-Path $_) }).Count -gt 0) {
        Add-Result "FAIL" "codex:global-package" "Installed Codex package binary layout is incomplete."
        return
    }
    if (-not $script:CodexPackageInputValid -or -not (Test-Path $provenancePath)) {
        Add-Result "GATED" "codex:global-package" "Installed version $($metadata.version) lacks exact validated package provenance."
        return
    }
    $provenance = Get-Content $provenancePath -Raw | ConvertFrom-Json
    $sourcePath = (Resolve-Path $CodexPackagePath).Path
    if ($metadata.name -ne "@gim-home/codex" -or
        $metadata.version -ne $CodexPackageExpectedVersion -or
        $provenance.version -ne $CodexPackageExpectedVersion -or
        $provenance.sha256 -ne $CodexPackageSha256.ToLowerInvariant() -or
        $provenance.packagePath -ne $sourcePath -or
        (Get-FileHash -Algorithm SHA256 $sourcePath).Hash.ToLowerInvariant() -ne $provenance.sha256) {
        Add-Result "FAIL" "codex:global-package" "Installed Codex metadata/layout/provenance do not match the selected package."
        return
    }
    Add-Result "PASS" "codex:global-package" "Installed Codex exactly matches selected package metadata, layout, and SHA256 provenance."
}

function Test-CodexBuildPrerequisites {
    param([pscustomobject]$Config, [pscustomobject]$Manifest)
    $checks = @{
        "llvm:clang-cl" = "C:\Program Files\LLVM\bin\clang-cl.exe"
        "llvm:lld-link" = "C:\Program Files\LLVM\bin\lld-link.exe"
        "xwin:crt" = (Join-Path $env:USERPROFILE ".xwin\crt")
        "xwin:sdk" = (Join-Path $env:USERPROFILE ".xwin\sdk")
        "codex:sccache" = "D:\codex-sccache"
        "codex:iteration-env" = (Join-Path $Root "codex\scripts\iteration-env.sh")
    }
    foreach ($entry in $checks.GetEnumerator()) {
        if (Test-Path $entry.Value) {
            Add-Result "PASS" $entry.Key $entry.Value
        } else {
            Add-Result "GATED" $entry.Key "Missing $($entry.Value)."
        }
    }
    $v8Path = Join-Path $env:USERPROFILE ".cargo\.rusty_v8\rusty_v8_release_x86_64-pc-windows-msvc_v$($Config.codex.rustyV8Version).lib"
    if (Test-Path $v8Path) {
        $v8Hash = (Get-FileHash -Algorithm SHA256 $v8Path).Hash.ToLowerInvariant()
        if ($v8Hash -eq $Config.codex.rustyV8Sha256) {
            Add-Result "PASS" "codex:rusty-v8" "rusty_v8 v$($Config.codex.rustyV8Version) SHA256 matches the release pin."
        } else {
            Add-Result "FAIL" "codex:rusty-v8" "rusty_v8 archive library SHA256 does not match the release pin."
        }
    } else {
        Add-Result "GATED" "codex:rusty-v8" "Pinned rusty_v8 archive library is missing."
    }
    Test-ExactRustToolchain $Config.codex.rustToolchain
    if ($env:RUSTC_WRAPPER) {
        Add-Result "FAIL" "codex:global-rustc-wrapper" "RUSTC_WRAPPER must not be globally forced."
    } else {
        Add-Result "PASS" "codex:global-rustc-wrapper" "Source codex/scripts/iteration-env.sh per iteration shell."
    }
    $packageValid = Test-CodexPackageInput
    $refValid = Resolve-ExactGitRef "codex:ref-input" (Join-Path $Root "codex") $CodexRef $CodexExpectedCommit
    if ($packageValid -or $refValid) {
        $script:CodexPublicationInputValid = $true
        $script:CodexRefInputValid = $refValid
    } else {
        Add-Result "GATED" "codex:publication" "Publish commit $($Config.codex.packageFixPublicationCommit) or supply -CodexPackagePath/-CodexRef; it is not a remote restore ref."
    }
    $script:ToolkitPublicationInputValid = Resolve-ToolkitPublicationInput $Manifest
    if (-not $script:ToolkitPublicationInputValid) {
        Add-Result "GATED" "plugins:publication" "Publish local-only plugin fixes or supply -ToolkitRef; never patch installed caches."
    }
}

function Test-ExactRustToolchain {
    param([string]$ExpectedToolchain)
    $rustup = Get-Command rustup -ErrorAction SilentlyContinue
    if (-not $rustup) {
        Add-Result "GATED" "codex:rust-toolchain" "rustup is missing; install it before Codex builds."
    } else {
        $toolchains = @(& $rustup.Source toolchain list 2>$null)
        if ($toolchains -match [regex]::Escape($ExpectedToolchain)) {
            Add-Result "PASS" "codex:rust-toolchain" "Exact toolchain $ExpectedToolchain is installed."
        } else {
            Add-Result "GATED" "codex:rust-toolchain" "Install exact toolchain $ExpectedToolchain."
        }
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

function Test-AclPolicyData {
    param([string]$Owner, [object[]]$Access, [string]$Operator)
    $allowed = @(
        $Operator,
        "NT AUTHORITY\SYSTEM",
        "BUILTIN\Administrators"
    ) | Select-Object -Unique
    $ownerAllowed = $allowed -contains $Owner
    $sensitiveMask = [Security.AccessControl.FileSystemRights]::ReadData -bor
        [Security.AccessControl.FileSystemRights]::ListDirectory -bor
        [Security.AccessControl.FileSystemRights]::ReadAttributes -bor
        [Security.AccessControl.FileSystemRights]::ReadExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::ReadPermissions -bor
        [Security.AccessControl.FileSystemRights]::Read -bor
        [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Modify -bor
        [Security.AccessControl.FileSystemRights]::FullControl
    $unsafe = @($Access | Where-Object {
        $_.AccessControlType -eq "Allow" -and
        $allowed -notcontains [string]$_.IdentityReference -and
        (([int64]$_.FileSystemRights -band [int64]$sensitiveMask) -ne 0)
    })
    return [pscustomobject]@{
        Safe = $ownerAllowed -and $unsafe.Count -eq 0
        Owner = $Owner
    }
}

function Test-RestrictedSecretAcl {
    param([string]$Path)
    $acl = Get-Acl $Path
    $operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    return Test-AclPolicyData ([string]$acl.Owner) @($acl.Access) $operator
}

function Test-SecretAclGate {
    param([string]$Name, [string]$Path, [string]$Description)
    if (-not (Test-Path $Path)) {
        Add-Result "GATED" "gate:$Name" "$Description requires operator interaction." $false
        return
    }
    try {
        $result = Test-RestrictedSecretAcl $Path
        if (-not $result.Safe) {
            Add-Result "FAIL" "gate:$Name" "$Description owner or allow ACEs extend beyond operator, SYSTEM, or Administrators."
        } else {
            Add-Result "PASS" "gate:$Name" "$Description ACL is restricted; contents were not read."
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
    Test-SecretAclGate $Name $Path $Description
}

function Test-PropertiesSecretGate {
    param([string]$Name, [string]$Path, [string]$Description, [string[]]$RequiredKeys)
    if (-not (Test-Path $Path)) {
        Add-Result "GATED" "gate:$Name" "$Description requires operator interaction." $false
        return
    }
    Test-SecretAclGate $Name $Path $Description
}

function Test-CloudflareTunnelIdentity {
    param([pscustomobject]$CloudflaredConfig)
    $expectedName = [string]$CloudflaredConfig.namedTunnel.name
    $expectedId = [string]$CloudflaredConfig.namedTunnel.id
    $credentials = Join-Path $env:USERPROFILE ".cloudflared\$expectedId.json"
    if (Test-Path $credentials) {
        try {
            $aclResult = Test-RestrictedSecretAcl $credentials
            if (-not $aclResult.Safe) {
                Add-Result "FAIL" "cloudflare:tunnel-credentials" "Credential file grants broad read or write access."
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

function Normalize-GitUrl {
    param([string]$Url)
    return (($Url.Trim().TrimEnd("/") -replace "\.git$", "").ToLowerInvariant())
}

function Test-ShortClone {
    param([pscustomobject]$Manifest)
    if (-not (Test-Path $ShortClonePath)) {
        Add-Result "GATED" "android:short-clone" "Optional real short clone is absent; use -CreateShortClone."
        return
    }
    if ((Invoke-Git $ShortClonePath @("rev-parse", "--is-inside-work-tree") -AllowFailure) -ne 0) {
        Add-Result "FAIL" "android:short-clone" "$ShortClonePath exists but is not a git repository."
        return
    }
    $origin = (& git -C $ShortClonePath remote get-url origin 2>$null).Trim()
    $head = (& git -C $ShortClonePath rev-parse HEAD 2>$null).Trim()
    $branch = (& git -C $ShortClonePath branch --show-current 2>$null).Trim()
    if ((Normalize-GitUrl $origin) -ne (Normalize-GitUrl $Manifest.repositories.codexu.url) -or
        $head -ne $Manifest.restoreVerification.snapshot -or
        $branch -ne $Manifest.snapshotBranch) {
        Add-Result "FAIL" "android:short-clone" "Repository identity, branch, or HEAD differs from the explicit migration snapshot."
        return
    }
    $status = @(& git -C $ShortClonePath status --porcelain)
    $submodules = @(& git -C $ShortClonePath submodule status --recursive 2>$null)
    $badSubmodules = @($submodules | Where-Object { $_ -match "^[+\-U]" })
    if ($status.Count -gt 0 -or $submodules.Count -eq 0 -or $badSubmodules.Count -gt 0) {
        Add-Result "FAIL" "android:short-clone" "Short clone is dirty or has missing/mismatched recursive submodules."
    } else {
        Add-Result "PASS" "android:short-clone" "$ShortClonePath matches origin, branch, HEAD, cleanliness, and recursive submodules."
    }
}

function Ensure-ShortClone {
    param([pscustomobject]$Manifest)
    if (Test-Path $ShortClonePath) {
        $before = $script:Results.Count
        Test-ShortClone $Manifest
        if ($script:Results[$before].Status -ne "PASS") {
            throw "Existing short clone failed identity/topology validation; refusing to move or replace it."
        }
        return
    }
    Invoke-Native "git" @("clone", "--no-checkout", $Manifest.repositories.codexu.url, $ShortClonePath) | Out-Null
    Invoke-Git $ShortClonePath @("fetch", "origin", $Manifest.snapshotBranch) | Out-Null
    Invoke-Git $ShortClonePath @("cat-file", "-e", "$($Manifest.restoreVerification.snapshot)^{commit}") | Out-Null
    Invoke-Git $ShortClonePath @("switch", "--create", $Manifest.snapshotBranch, $Manifest.restoreVerification.snapshot) | Out-Null
    Set-SubmoduleUrlBeforeUpdate $ShortClonePath "codex" $Manifest.repositories.codex.url
    Set-SubmoduleUrlBeforeUpdate $ShortClonePath "ai-developer-toolkit" $Manifest.repositories.aiDeveloperToolkit.url
    Invoke-Git $ShortClonePath @("-c", "core.autocrlf=false", "submodule", "update", "--init", "--", "codex", "ai-developer-toolkit") | Out-Null
    $shortCodex = Join-Path $ShortClonePath "codex"
    $shortCodexRecorded = (& git -C $shortCodex rev-parse "HEAD:external/repos/codex-patched").Trim()
    Prepare-NestedSubmodule $shortCodex "external/repos/codex-patched" $Manifest.repositories.codexPatched.url `
        $shortCodexRecorded $null
    Prepare-NestedSubmodule (Join-Path $ShortClonePath "ai-developer-toolkit") "external/repos/mcporter" `
        $Manifest.repositories.mcporter.url $Manifest.repositories.mcporter.activeCommit $null
    Test-ShortClone $Manifest
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

if ($LibraryOnly) {
    return
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
    $InstallCodexPackage,
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
    Ensure-ShortClone $manifest
} else {
    Test-ShortClone $manifest
}

Test-CodexBuildPrerequisites $config $manifest
if ($InstallCodexPackage) {
    Install-ValidatedCodexPackage
}
if ($ConfigurePlugins) {
    Configure-CopilotPlugins $config $manifest
}
Test-CopilotPlugins $config
Test-ReleaseAndRuntimeGates
Test-InstalledCodexProvenance
Test-OperatorGates
Write-Summary
