[CmdletBinding()]
param(
    [string]$Root,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$bootstrap = Join-Path $PSScriptRoot "bootstrap-vm.ps1"
$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $bootstrap, "-Root", $Root)
if ($ValidateOnly) {
    $arguments += "-ValidateOnly"
} else {
    $arguments += "-RestoreWorkspace"
}
& powershell.exe @arguments
exit $LASTEXITCODE
