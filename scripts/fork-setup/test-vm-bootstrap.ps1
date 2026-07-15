$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$scripts = @(
    (Join-Path $PSScriptRoot "bootstrap-vm.ps1"),
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
    if ($config.portable.cloudflared.version -ne "2026.7.2" -or
        $config.portable.cloudflared.sha256 -ne "cdb5d4432f6ae1595654a692a51308b69d2bf7af961f5578d9391837cf072df9") {
        throw "Cloudflared release pin is stale."
    }
    if ($config.portable.cloudflared.namedTunnel.name -ne "happy" -or
        $config.portable.cloudflared.namedTunnel.id -ne "ebd51c79-c883-4850-a9bd-403c1513ed36") {
        throw "Cloudflare named tunnel identity is stale."
    }
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
}

$manifest = Get-Content (Join-Path $root "docs\vm-migration-manifest.json") -Raw | ConvertFrom-Json
if ($manifest.repositories.codexPatched.activeCommit -ne "6d73e16c44d65ac243834a942d7fab2c3b279221") {
    throw "PRD B nested source pin changed."
}
if ($manifest.activeTask.publicationPerformed -ne $false) {
    throw "PRD B publication state changed."
}

Write-Host "PASS: scripts parse, are ASCII-only, enforce plugin policy, avoid forbidden operations, and preserve PRD B pins."
