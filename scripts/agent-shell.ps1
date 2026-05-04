$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$argsLine = @(
  "run",
  "demo:cli-shell",
  "--"
) + $args

npm @argsLine
