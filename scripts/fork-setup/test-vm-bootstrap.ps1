$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scripts = @(
    (Join-Path $PSScriptRoot "bootstrap-vm.ps1"),
    (Join-Path $PSScriptRoot "invoke-codex-build.ps1"),
    (Join-Path $PSScriptRoot "restore-vm-workspace.ps1"),
    (Join-Path $PSScriptRoot "setup-services.ps1"),
    $PSCommandPath
)

foreach ($script in $scripts) {
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        throw "PowerShell parse errors in $script`: $($errors | ForEach-Object Message | Out-String)"
    }
    $bytes = [IO.File]::ReadAllBytes($script)
    if (@($bytes | Where-Object { $_ -gt 127 }).Count -gt 0) {
        throw "$script is not ASCII-only."
    }
}

$config = Get-Content (Join-Path $PSScriptRoot "vm-bootstrap-config.json") -Raw | ConvertFrom-Json
if ($config.schemaVersion -ne 1) {
    throw "Unexpected bootstrap config schema."
}
foreach ($pin in @($config.portable.jdk, $config.portable.cloudflared)) {
    if ($pin.sha256 -notmatch "^[0-9a-f]{64}$") {
        throw "Portable download is missing a pinned SHA256."
    }
}
if ($config.portable.cloudflared.version -ne "2026.7.2" -or
    $config.portable.cloudflared.sha256 -ne "cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9") {
    throw "Cloudflared release pin is stale."
}
if ($config.portable.cloudflared.namedTunnel.name -ne "happy" -or
    $config.portable.cloudflared.namedTunnel.id -ne "ebd51c79-c883-4850-a9bd-403c1513ed36") {
    throw "Cloudflare named tunnel identity is stale."
}
if ($config.android.commandLineTools.checksum -notmatch "^[0-9a-f]{40}$") {
    throw "Android command-line tools are missing the official SHA1 pin."
}
if ($config.android.additionalPackages -notcontains "extras;google;usb_driver") {
    throw "Android Google USB driver package is missing."
}
if ($config.android.cmakeApp -ne "cmake;3.22.1" -or $config.android.cmake -ne "cmake;3.30.5") {
    throw "Android dual-CMake pins are stale."
}
if ($config.plugins.enabledAllowlist -contains "crews@ai-developer-toolkit") {
    throw "Crews must not be enabled by bootstrap."
}
if (@($config.plugins.enabledAllowlist | Where-Object { $_ -match "ralph-orchestration|^ralph@" }).Count -gt 0) {
    throw "Ralph Orchestration must not be enabled by bootstrap."
}
foreach ($pluginName in @("stop-copilot-shell-polling", "ralph-overview", "edge-browser", "subagent-model-routing")) {
    if (-not $config.plugins.expectedVersions.$pluginName) {
        throw "Plugin version pin is missing for $pluginName."
    }
}

$bootstrapText = Get-Content (Join-Path $PSScriptRoot "bootstrap-vm.ps1") -Raw
foreach ($forbidden in @("happy auth status", "install-local.cjs", "pnpm prebuild", "git push", "git tag")) {
    if ($bootstrapText -match [regex]::Escape($forbidden)) {
        throw "Bootstrap contains forbidden operation: $forbidden"
    }
    foreach ($requiredNodeSafetyText in @(
        "[IO.File]::Replace",
        "node:hook-shadow",
        "Never delete/rename the live shim"
    )) {
        if ($bootstrapText -notmatch [regex]::Escape($requiredNodeSafetyText)) {
            throw "Node hook-shim safety invariant is missing: $requiredNodeSafetyText"
        }
    }
}
foreach ($required in @('"happy-wire", "build"', '"happy-server", "build"', '"happy", "build"', '"npm" @("link")')) {
    if ($bootstrapText -notmatch [regex]::Escape($required)) {
        throw "Happy source build/link sequence is incomplete: $required"
    }

    $rootUrlIndex = $bootstrapText.IndexOf('Set-SubmoduleUrlBeforeUpdate $Root "codex"')
    $rootUpdateIndex = $bootstrapText.IndexOf('"submodule", "update", "--init", "--", "codex"')
    $regressionCases = @(
        @{
            Name = "URLs precede recursive updates"
            Pass = $rootUrlIndex -ge 0 -and $rootUpdateIndex -ge 0 -and $rootUrlIndex -lt $rootUpdateIndex
        },
        @{
            Name = "Branches never force-reset"
            Pass = $bootstrapText -notmatch '"switch",\s*"-C"' -and
                $bootstrapText -match "Refusing to move resumed work"
        },
        @{
            Name = "Topology validates snapshot, gitlinks, dirtiness, and recursive submodules"
            Pass = @(@("topology:root-snapshot", "topology:prd-b-gitlink", "submodule status --recursive", "Nested PRD B checkout is missing") |
                Where-Object { $bootstrapText -notmatch [regex]::Escape($_) }).Count -eq 0
        },
        @{
            Name = "Short clone validates identity and exact snapshot"
            Pass = $bootstrapText -match "Normalize-GitUrl" -and
                $bootstrapText -match '& git -C \$ShortClonePath rev-parse --git-dir' -and
                $bootstrapText -notmatch 'Invoke-Git \$ShortClonePath @\("rev-parse", "--is-inside-work-tree"\)' -and
                $bootstrapText -match "restoreVerification\.snapshot" -and
                $bootstrapText -match "Short clone is dirty or has missing/mismatched recursive submodules"
        },
        @{
            Name = "Secret ACLs reject broad read and write without reading content"
            Pass = $bootstrapText -match "ReadAndExecute" -and
                $bootstrapText -match "BUILTIN\\Administrators" -and
                $bootstrapText -notmatch 'Get-Content \$Path'
        },
        @{
            Name = "Publication inputs are cryptographically and referentially exact"
            Pass = @(@("CodexPackageSha256", "CodexPackageExpectedVersion", "Resolve-ExactGitRef", "required binary layout", "expectedVersions") |
                Where-Object { $bootstrapText -notmatch [regex]::Escape($_) }).Count -eq 0
        },
        @{
            Name = "Codex builds pin Rust without changing global default"
            Pass = $bootstrapText -notmatch '"rustup"\s+@\("default"' -and
                (Get-Content (Join-Path $PSScriptRoot "invoke-codex-build.ps1") -Raw) -match
                    "RUSTUP_TOOLCHAIN=1\.95\.0-x86_64-pc-windows-msvc"
        },
        @{
            Name = "rusty_v8 PASS requires SHA256"
            Pass = $config.codex.rustyV8Sha256 -eq "8597caf00d62b27c98b3e3c6ca36e7b9e279e49f4fede2a84f7d6bd340c3a067" -and
                $bootstrapText -match "rusty_v8 archive library SHA256"
        }
    )
    foreach ($case in $regressionCases) {
        if (-not [bool]$case.Pass) {
            throw "Regression case failed: $($case.Name)"
        }
    }
}

$manifest = Get-Content (Join-Path $root "docs\vm-migration-manifest.json") -Raw | ConvertFrom-Json
if ($manifest.repositories.codexPatched.activeCommit -ne "6d73e16c44d65ac243834a942d7fab2c3b279221") {
    throw "PRD B nested source pin changed."
}
if ($manifest.activeTask.publicationPerformed -ne $false) {
    throw "PRD B publication state changed."
}
if ($manifest.restoreVerification.snapshot -ne "fa48a50a54fdf35c72e7f63ceba5d9cfab7655b5") {
    throw "Published migration snapshot contract is stale."
}
if ($manifest.repositories.mcporter.url -ne "https://github.com/evmitran_microsoft/mcporter.git" -or
    $manifest.repositories.mcporter.activeCommit -ne "94e1329f5fe37ce8bbf68e2b3ea3d5b5374d4f33") {
    throw "mcporter migration mirror contract is stale."
}

$restoreStart = $bootstrapText.IndexOf("function Restore-MigrationTopology")
$restoreBody = if ($restoreStart -ge 0) { $bootstrapText.Substring($restoreStart) } else { "" }
$secondReviewCases = @(
    @{
        Name = "Fresh and resumed nested restore paths are non-destructive"
        Pass = $bootstrapText -match '"clone", "--no-checkout"' -and
            $bootstrapText -match '"submodule", "absorbgitdirs"' -and
            $bootstrapText -match "Active nested work .* Refusing recursive update"
    },
    @{
        Name = "mcporter mirror precedes every toolkit nested restore"
        Pass = $bootstrapText -match 'external/repos/mcporter' -and
            $bootstrapText -match 'repositories\.mcporter\.url' -and
            $bootstrapText -notmatch 'Evyatar108/mcporter'
    },
    @{
        Name = "Wrong root fails before mutation"
        Pass = $restoreBody.IndexOf("Assert-RootRestorePreflight") -ge 0 -and
            $restoreBody.IndexOf("Assert-RootRestorePreflight") -lt $restoreBody.IndexOf("Set-SubmoduleUrlBeforeUpdate")
    },
    @{
        Name = "Secret owner is independently restricted"
        Pass = $bootstrapText -match '\$ownerAllowed = \$allowed -contains' -and
            $bootstrapText -notmatch '\$allowed = @\(\s*\$operator,\s*\[string\]\$acl\.Owner'
    },
    @{
        Name = "Codex install verifies exact package provenance"
        Pass = $bootstrapText -match "Install-ValidatedCodexPackage" -and
            $bootstrapText -match "Test-InstalledCodexProvenance" -and
            $bootstrapText -match "Installed Codex exactly matches selected package"
    },
    @{
        Name = "Local toolkit sources stay local"
        Pass = $bootstrapText -match "ToolkitSourcePath" -and
            $bootstrapText -match "Validated exact local toolkit source without remote fetch" -and
            $bootstrapText -match "git ls-remote"
    },
    @{
        Name = "Missing rustup is gated"
        Pass = $bootstrapText -match "Get-Command rustup -ErrorAction SilentlyContinue" -and
            $bootstrapText -match "rustup is missing; install it before Codex builds"
    }
)
foreach ($case in $secondReviewCases) {
    if (-not [bool]$case.Pass) {
        throw "Second-review regression case failed: $($case.Name)"
    }
}

$finalReviewCases = @(
    @{
        Name = "Tooling checkout is independent from target root"
        Pass = $bootstrapText -match '\[string\]\$Root' -and
            $bootstrapText -match '\[string\]\$ManifestPath' -and
            $bootstrapText -notmatch 'Join-Path \$Root "scripts\\fork-setup\\bootstrap-vm\.ps1"'
    },
    @{
        Name = "Codex ref build uses exact detached worktree and commit provenance"
        Pass = $bootstrapText -match "New-CodexRefWorktree" -and
            $bootstrapText -match 'invoke-codex-build\.ps1' -and
            $bootstrapText -match '-CodexRoot \$worktree' -and
            $bootstrapText -match 'sourceCommit = \$CodexExpectedCommit' -and
            $bootstrapText -match "Preserved clean-room worktree for diagnosis"
    }
)
foreach ($case in $finalReviewCases) {
    if (-not [bool]$case.Pass) {
        throw "Final-review regression case failed: $($case.Name)"
    }

    $cleanupReviewCases = @(
        @{
            Name = "Exact-ref cleanup validates then force-removes without deinit"
            Pass = $bootstrapText -match "Remove-CleanCodexRefWorktree" -and
                $bootstrapText -match '"worktree", "remove", "--force"' -and
                $bootstrapText -notmatch '"submodule", "deinit", "--force"' -and
                $bootstrapText -match "Nested source is dirty or mismatched; preserving"
        },
        @{
            Name = "Legacy wrapper forwards target, manifest, and config"
            Pass = (Get-Content (Join-Path $PSScriptRoot "restore-vm-workspace.ps1") -Raw) -match
                '"-ManifestPath", \$ManifestPath' -and
                (Get-Content (Join-Path $PSScriptRoot "restore-vm-workspace.ps1") -Raw) -match
                '"-ConfigPath", \$ConfigPath'
        }
    )
    foreach ($case in $cleanupReviewCases) {
        if (-not [bool]$case.Pass) {
            throw "Cleanup-review regression case failed: $($case.Name)"
        }
    }
}

$bootstrapPath = Join-Path $PSScriptRoot "bootstrap-vm.ps1"
& {
    . $bootstrapPath -LibraryOnly
    $fixtureRepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
    $fixtureBase = Join-Path $fixtureRepositoryRoot (".vm-bootstrap-fixtures-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $fixtureBase | Out-Null
    try {
        $nestedSource = Join-Path $fixtureBase "nested-source"
        New-Item -ItemType Directory -Force -Path $nestedSource | Out-Null
        & git -C $nestedSource init --quiet
        & git -C $nestedSource config user.email "fixture@example.invalid"
        & git -C $nestedSource config user.name "Fixture"
        [IO.File]::WriteAllText((Join-Path $nestedSource "seed.txt"), "seed`n", [Text.Encoding]::ASCII)
        & git -C $nestedSource add seed.txt
        & git -C $nestedSource commit --quiet -m seed
        $nestedCommit = (& git -C $nestedSource rev-parse HEAD).Trim()

        $mcporterSource = Join-Path $fixtureBase "mcporter-source"
        New-Item -ItemType Directory -Force -Path $mcporterSource | Out-Null
        & git -C $mcporterSource init --quiet
        & git -C $mcporterSource config user.email "fixture@example.invalid"
        & git -C $mcporterSource config user.name "Fixture"
        New-Item -ItemType Directory -Force -Path (Join-Path $mcporterSource "dist-bun") | Out-Null
        [IO.File]::WriteAllText((Join-Path $mcporterSource "seed.txt"), "seed`n", [Text.Encoding]::ASCII)
        [IO.File]::WriteAllBytes(
            (Join-Path $mcporterSource "dist-bun\mcporter-macos-arm64-v0.6.2.tar.gz"),
            [byte[]](0x1f, 0x8b, 0x0d, 0x0a, 0x00)
        )
        & git -C $mcporterSource add seed.txt dist-bun/mcporter-macos-arm64-v0.6.2.tar.gz
        & git -C $mcporterSource commit --quiet -m seed
        [IO.File]::WriteAllText(
            (Join-Path $mcporterSource ".gitattributes"),
            "dist-bun/mcporter-macos-arm64-v0.6.2.tar.gz text eol=lf`n",
            [Text.Encoding]::ASCII
        )
        & git -C $mcporterSource add .gitattributes
        & git -C $mcporterSource commit --quiet -m attributes
        $mcporterCommit = (& git -C $mcporterSource rev-parse HEAD).Trim()

        $wrapper = Join-Path $fixtureBase "wrapper"
        New-Item -ItemType Directory -Force -Path $wrapper | Out-Null
        & git -C $wrapper init --quiet
        & git -C $wrapper config user.email "fixture@example.invalid"
        & git -C $wrapper config user.name "Fixture"
        $modules = @"
[submodule "external/repos/mcporter"]
	path = external/repos/mcporter
	url = https://legacy.invalid/dependency.git
"@
        [IO.File]::WriteAllText((Join-Path $wrapper ".gitmodules"), $modules, [Text.Encoding]::ASCII)
        & git -C $wrapper add .gitmodules
        & git -C $wrapper update-index --add --cacheinfo "160000,$mcporterCommit,external/repos/mcporter"
        & git -C $wrapper commit --quiet -m wrapper
        $Root = $wrapper
        Prepare-NestedSubmodule $wrapper "external/repos/mcporter" $mcporterSource $mcporterCommit "active"
        $nestedCheckout = Join-Path $wrapper "external\repos\mcporter"
        if ((& git -C $nestedCheckout branch --show-current).Trim() -ne "active" -or
            (& git -C $nestedCheckout rev-parse HEAD).Trim() -ne $mcporterCommit -or
            @(& git -C $nestedCheckout status --porcelain).Count -ne 0) {
            throw "Fresh-uninitialized nested fixture failed."
        }
        [IO.File]::WriteAllText((Join-Path $nestedCheckout "resumed.txt"), "resumed`n", [Text.Encoding]::ASCII)
        & git -C $nestedCheckout add resumed.txt
        & git -C $nestedCheckout commit --quiet -m resumed
        $resumedCommit = (& git -C $nestedCheckout rev-parse HEAD).Trim()
        $blocked = $false
        try {
            Prepare-NestedSubmodule $wrapper "external/repos/mcporter" $mcporterSource $mcporterCommit "active"
        } catch {
            $blocked = $true
        }
        if (-not $blocked -or (& git -C $nestedCheckout rev-parse HEAD).Trim() -ne $resumedCommit) {
            throw "Resumed-active nested fixture was moved or not rejected."
        }

        $wrongRoot = Join-Path $fixtureBase "wrong-root"
        New-Item -ItemType Directory -Force -Path $wrongRoot | Out-Null
        & git -C $wrongRoot init --quiet
        & git -C $wrongRoot config user.email "fixture@example.invalid"
        & git -C $wrongRoot config user.name "Fixture"
        [IO.File]::WriteAllText((Join-Path $wrongRoot "root.txt"), "root`n", [Text.Encoding]::ASCII)
        & git -C $wrongRoot add root.txt
        & git -C $wrongRoot commit --quiet -m root
        & git -C $wrongRoot branch -M wrong
        $wrongHead = (& git -C $wrongRoot rev-parse HEAD).Trim()
        $Root = $wrongRoot
        $AllowNewerRootSnapshot = $false
        $wrongManifest = [pscustomobject]@{
            snapshotBranch = "expected"
            restoreVerification = [pscustomobject]@{ snapshot = $wrongHead }
        }
        $beforeConfig = (& git -C $wrongRoot config --list | Out-String)
        $blocked = $false
        try {
            Assert-RootRestorePreflight $wrongManifest
        } catch {
            $blocked = $true
        }
        $afterConfig = (& git -C $wrongRoot config --list | Out-String)
        if (-not $blocked -or $beforeConfig -ne $afterConfig -or (& git -C $wrongRoot rev-parse HEAD).Trim() -ne $wrongHead) {
            throw "Wrong-root preflight fixture mutated repository state."
        }

        $targetRoot = Join-Path $fixtureBase "exact-target"
        New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
        & git -C $targetRoot init --quiet
        & git -C $targetRoot config user.email "fixture@example.invalid"
        & git -C $targetRoot config user.name "Fixture"
        [IO.File]::WriteAllText((Join-Path $targetRoot "target.txt"), "target`n", [Text.Encoding]::ASCII)
        & git -C $targetRoot add target.txt
        & git -C $targetRoot commit --quiet -m target
        & git -C $targetRoot branch -M migration/vm-2026-07-14
        $targetHead = (& git -C $targetRoot rev-parse HEAD).Trim()
        $Root = $targetRoot
        $exactManifest = [pscustomobject]@{
            snapshotBranch = "migration/vm-2026-07-14"
            restoreVerification = [pscustomobject]@{ snapshot = $targetHead }
        }
        Assert-RootRestorePreflight $exactManifest
        if ($bootstrapPath.StartsWith($targetRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Tooling/target separation fixture used target-local tooling."
        }
        $wrapperStub = Join-Path $fixtureBase "wrapper-stub.ps1"
        $wrapperCapture = Join-Path $fixtureBase "wrapper-capture.json"
        $stubText = @'
param(
    [string]$Root,
    [string]$ManifestPath,
    [string]$ConfigPath,
    [switch]$AllowNewerRootSnapshot,
    [switch]$ValidateOnly,
    [switch]$RestoreWorkspace
)
[IO.File]::WriteAllText($env:VM_BOOTSTRAP_WRAPPER_CAPTURE, (@{
    Root = $Root
    ManifestPath = $ManifestPath
    ConfigPath = $ConfigPath
    AllowNewerRootSnapshot = [bool]$AllowNewerRootSnapshot
    ValidateOnly = [bool]$ValidateOnly
    RestoreWorkspace = [bool]$RestoreWorkspace
} | ConvertTo-Json), [Text.Encoding]::ASCII)
'@
        [IO.File]::WriteAllText($wrapperStub, $stubText, [Text.Encoding]::ASCII)
        $wrapperManifest = Join-Path $fixtureBase "tooling-manifest.json"
        $wrapperConfig = Join-Path $fixtureBase "tooling-config.json"
        [IO.File]::WriteAllText($wrapperManifest, "{}", [Text.Encoding]::ASCII)
        [IO.File]::WriteAllText($wrapperConfig, "{}", [Text.Encoding]::ASCII)
        $env:VM_BOOTSTRAP_WRAPPER_CAPTURE = $wrapperCapture
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "restore-vm-workspace.ps1") `
            -Root $targetRoot -ManifestPath $wrapperManifest -ConfigPath $wrapperConfig `
            -BootstrapPath $wrapperStub -ValidateOnly
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $wrapperCapture)) {
            throw "Separated-target wrapper fixture did not execute."
        }
        $captured = Get-Content $wrapperCapture -Raw | ConvertFrom-Json
        if ($captured.Root -ne $targetRoot -or $captured.ManifestPath -ne $wrapperManifest -or
            $captured.ConfigPath -ne $wrapperConfig -or $captured.AllowNewerRootSnapshot -or
            -not $captured.ValidateOnly -or $captured.RestoreWorkspace) {
            throw "Separated-target wrapper fixture did not forward the tooling/target contract."
        }
        Remove-Item Env:VM_BOOTSTRAP_WRAPPER_CAPTURE -ErrorAction SilentlyContinue

        $sameCheckout = Join-Path $fixtureBase "same-checkout"
        $sameScripts = Join-Path $sameCheckout "scripts\fork-setup"
        $sameDocs = Join-Path $sameCheckout "docs"
        New-Item -ItemType Directory -Force -Path $sameScripts | Out-Null
        New-Item -ItemType Directory -Force -Path $sameDocs | Out-Null
        Copy-Item (Join-Path $PSScriptRoot "restore-vm-workspace.ps1") (Join-Path $sameScripts "restore-vm-workspace.ps1")
        [IO.File]::WriteAllText((Join-Path $sameScripts "vm-bootstrap-config.json"), "{}", [Text.Encoding]::ASCII)
        [IO.File]::WriteAllText((Join-Path $sameDocs "vm-migration-manifest.json"), "{}", [Text.Encoding]::ASCII)
        $sameCapture = Join-Path $fixtureBase "same-wrapper-capture.json"
        $env:VM_BOOTSTRAP_WRAPPER_CAPTURE = $sameCapture
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sameScripts "restore-vm-workspace.ps1") `
            -BootstrapPath $wrapperStub -AllowNewerRootSnapshot
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $sameCapture)) {
            throw "Same-checkout wrapper fixture did not execute."
        }
        $sameCaptured = Get-Content $sameCapture -Raw | ConvertFrom-Json
        if ($sameCaptured.Root -ne $sameCheckout -or
            $sameCaptured.ManifestPath -ne (Join-Path $sameDocs "vm-migration-manifest.json") -or
            $sameCaptured.ConfigPath -ne (Join-Path $sameScripts "vm-bootstrap-config.json") -or
            -not $sameCaptured.AllowNewerRootSnapshot -or $sameCaptured.ValidateOnly -or
            -not $sameCaptured.RestoreWorkspace) {
            throw "Same-checkout wrapper fixture did not preserve compatible defaults/switch forwarding."
        }
        Remove-Item Env:VM_BOOTSTRAP_WRAPPER_CAPTURE -ErrorAction SilentlyContinue

        $broadRead = [pscustomobject]@{
            AccessControlType = "Allow"
            IdentityReference = "BUILTIN\Users"
            FileSystemRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
        }
        if ((Test-AclPolicyData "CONTOSO\OtherOwner" @($broadRead) "CONTOSO\Operator").Safe) {
            throw "ACL-owner fixture accepted an arbitrary owner/broad reader."
        }

        $toolkitFixture = Join-Path $fixtureBase "toolkit-local"
        New-Item -ItemType Directory -Force -Path $toolkitFixture | Out-Null
        & git -C $toolkitFixture init --quiet
        & git -C $toolkitFixture config user.email "fixture@example.invalid"
        & git -C $toolkitFixture config user.name "Fixture"
        [IO.File]::WriteAllText((Join-Path $toolkitFixture "plugin.txt"), "plugin`n", [Text.Encoding]::ASCII)
        & git -C $toolkitFixture add plugin.txt
        & git -C $toolkitFixture commit --quiet -m plugin
        $ToolkitSourcePath = $toolkitFixture
        $ToolkitRef = "HEAD"
        $ToolkitExpectedCommit = (& git -C $toolkitFixture rev-parse HEAD).Trim()
        $script:Results = New-Object System.Collections.Generic.List[object]
        $fakeManifest = [pscustomobject]@{
            repositories = [pscustomobject]@{
                aiDeveloperToolkit = [pscustomobject]@{ url = "https://invalid.example/never-fetch.git" }
            }
        }
        if (-not (Resolve-ToolkitPublicationInput $fakeManifest) -or
            $script:ToolkitValidatedSourcePath -ne $toolkitFixture) {
            throw "Local toolkit source fixture failed."
        }

        $packageFixture = Join-Path $fixtureBase "package-fixture"
        $packageRoot = Join-Path $packageFixture "package"
        $vendor = Join-Path $packageRoot "vendor\x64\codex"
        New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "bin") | Out-Null
        New-Item -ItemType Directory -Force -Path $vendor | Out-Null
        [IO.File]::WriteAllText((Join-Path $packageRoot "package.json"), '{"name":"@gim-home/codex","version":"9.9.9"}', [Text.Encoding]::ASCII)
        foreach ($file in @("bin\codex.js", "vendor\x64\codex\codex.exe", "vendor\x64\codex\codex-core.exe",
            "vendor\x64\codex\codex-windows-sandbox-setup.exe", "vendor\x64\codex\codex-command-runner.exe")) {
            [IO.File]::WriteAllText((Join-Path $packageRoot $file), "fixture", [Text.Encoding]::ASCII)
        }
        $archive = Join-Path $packageFixture "codex.tgz"
        & tar.exe -czf $archive -C $packageFixture package
        $CodexPackagePath = $archive
        $CodexPackageSha256 = (Get-FileHash -Algorithm SHA256 $archive).Hash
        $CodexPackageExpectedVersion = "9.9.9"
        $script:Results = New-Object System.Collections.Generic.List[object]
        if (-not (Test-CodexPackageInput) -or -not $script:CodexPackageInputValid) {
            throw "Exact Codex package fixture failed."
        }

        $codexTargetRoot = Join-Path $fixtureBase "codex-ref-target"
        $codexRepository = Join-Path $codexTargetRoot "codex"
        New-Item -ItemType Directory -Force -Path $codexRepository | Out-Null
        & git -C $codexRepository init --quiet
        & git -C $codexRepository config user.email "fixture@example.invalid"
        & git -C $codexRepository config user.name "Fixture"
        $codexModules = @"
[submodule "external/repos/codex-patched"]
	path = external/repos/codex-patched
	url = https://legacy.invalid/codex-patched.git
"@
        [IO.File]::WriteAllText((Join-Path $codexRepository ".gitmodules"), $codexModules, [Text.Encoding]::ASCII)
        & git -C $codexRepository add .gitmodules
        & git -C $codexRepository update-index --add --cacheinfo "160000,$nestedCommit,external/repos/codex-patched"
        & git -C $codexRepository commit --quiet -m codex-wrapper
        $CodexExpectedCommit = (& git -C $codexRepository rev-parse HEAD).Trim()
        $privateMirror = $nestedSource
        & git -C $codexRepository config submodule.external/repos/codex-patched.url $privateMirror
        $script:CodexRefInputValid = $true
        $CodexRefWorktreeRoot = Join-Path $fixtureBase "cwb"
        $Root = $codexTargetRoot
        $codexManifest = [pscustomobject]@{
            repositories = [pscustomobject]@{
                codexPatched = [pscustomobject]@{ url = $nestedSource }
            }
        }
        $refWorktree = New-CodexRefWorktree $codexManifest
        if ((& git -C $refWorktree rev-parse HEAD).Trim() -ne $CodexExpectedCommit -or
            (& git -C $refWorktree branch --show-current | Out-String).Trim()) {
            throw "Exact Codex ref worktree fixture selected stale source."
        }
        $refNested = Join-Path $refWorktree "external\repos\codex-patched"
        if ((& git -C $refNested rev-parse HEAD).Trim() -ne $nestedCommit) {
            throw "Exact Codex ref worktree fixture used stale nested source."
        }
        $fixtureArtifact = Join-Path $fixtureBase "ref-artifact.tgz"
        [IO.File]::WriteAllText($fixtureArtifact, "artifact", [Text.Encoding]::ASCII)
        $fixtureArtifactHash = (Get-FileHash -Algorithm SHA256 $fixtureArtifact).Hash.ToLowerInvariant()
        $fixtureProvenance = Join-Path $fixtureBase "ref-provenance.json"
        $fixtureProvenanceValue = [ordered]@{
            sourceCommit = $CodexExpectedCommit
            artifactPath = $fixtureArtifact
            artifactSha256 = $fixtureArtifactHash
            version = "fixture"
        } | ConvertTo-Json
        [IO.File]::WriteAllText($fixtureProvenance, $fixtureProvenanceValue, [Text.Encoding]::UTF8)
        Remove-CleanCodexRefWorktree $codexRepository $refWorktree $CodexExpectedCommit `
            $fixtureArtifact $fixtureArtifactHash $fixtureProvenance
        if (Test-Path $refWorktree) {
            throw "Production cleanup fixture left the exact-ref worktree behind."
        }
        if ((& git -C $codexRepository config submodule.external/repos/codex-patched.url) -ne $privateMirror) {
            throw "Exact-ref cleanup fixture mutated shared private-mirror config."
        }
        $dirtyRefWorktree = New-CodexRefWorktree $codexManifest
        $dirtyNested = Join-Path $dirtyRefWorktree "external\repos\codex-patched"
        [IO.File]::WriteAllText((Join-Path $dirtyNested "unexpected.txt"), "dirty", [Text.Encoding]::ASCII)
        $blocked = $false
        try {
            Remove-CleanCodexRefWorktree $codexRepository $dirtyRefWorktree $CodexExpectedCommit `
                $fixtureArtifact $fixtureArtifactHash $fixtureProvenance
        } catch {
            $blocked = $true
        }
        if (-not $blocked -or -not (Test-Path $dirtyRefWorktree)) {
            throw "Dirty exact-ref cleanup fixture was not preserved."
        }
        Remove-Item (Join-Path $dirtyNested "unexpected.txt") -Force
        & git -C $codexRepository worktree remove --force $dirtyRefWorktree

        $oldPath = $env:Path
        try {
            $env:Path = ""
            $script:Results = New-Object System.Collections.Generic.List[object]
            Test-ExactRustToolchain "1.95.0-x86_64-pc-windows-msvc"
            $rustResult = $script:Results | Where-Object Name -eq "codex:rust-toolchain" | Select-Object -Last 1
            if ($rustResult.Status -ne "GATED") {
                throw "Missing-rustup fixture did not return GATED."
            }
        } finally {
            $env:Path = $oldPath
        }
    } finally {
        Remove-Item $fixtureBase -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "PASS: scripts parse, are ASCII-only, and all 19 static plus 11 fixture regressions pass."
