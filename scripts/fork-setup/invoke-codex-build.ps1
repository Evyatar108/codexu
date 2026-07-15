[CmdletBinding()]
param(
    [string]$Root,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CargoArguments = @("check", "--workspace")
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
$Root = (Resolve-Path $Root).Path
$bash = Join-Path $env:ProgramFiles "Git\bin\bash.exe"
if (-not (Test-Path $bash)) {
    throw "Git Bash is required at $bash."
}

function ConvertTo-BashLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

if ($Root -notmatch "^([A-Za-z]):\\(.*)$") {
    throw "Expected a Windows drive path for the repository root."
}
$bashRoot = "/" + $Matches[1].ToLowerInvariant() + "/" + $Matches[2].Replace("\", "/")
$rootLiteral = ConvertTo-BashLiteral $bashRoot
$argumentLiterals = @($CargoArguments | ForEach-Object { ConvertTo-BashLiteral $_ })
$command = @(
    "set -e",
    "cd $rootLiteral/codex",
    "source scripts/iteration-env.sh",
    "export RUSTUP_TOOLCHAIN=1.95.0-x86_64-pc-windows-msvc",
    "cd external/repos/codex-patched/codex-rs",
    ("cargo " + ($argumentLiterals -join " "))
) -join " && "

& $bash -lc $command
if ($LASTEXITCODE -ne 0) {
    throw "Codex cargo command failed with exit code $LASTEXITCODE."
}
