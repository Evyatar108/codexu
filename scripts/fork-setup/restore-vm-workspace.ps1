[CmdletBinding()]
param(
    [string]$Root,
    [string]$ManifestPath,
    [string]$ConfigPath,
    [string]$BootstrapPath,
    [switch]$AllowNewerRootSnapshot,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$toolingRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $Root) {
    $Root = $toolingRoot
}
if (-not $ManifestPath) {
    $ManifestPath = Join-Path $toolingRoot "docs\vm-migration-manifest.json"
}
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $PSScriptRoot "vm-bootstrap-config.json"
}
if (-not $BootstrapPath) {
    $BootstrapPath = Join-Path $PSScriptRoot "bootstrap-vm.ps1"
}
$arguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", $BootstrapPath,
    "-Root", $Root,
    "-ManifestPath", $ManifestPath,
    "-ConfigPath", $ConfigPath
)
if ($ValidateOnly) {
    $arguments += "-ValidateOnly"
} else {
    $arguments += "-RestoreWorkspace"
}
if ($AllowNewerRootSnapshot) {
    $arguments += "-AllowNewerRootSnapshot"
}
& powershell.exe @arguments
exit $LASTEXITCODE
