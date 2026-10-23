param(
  [string]$Destination = (Join-Path $PSScriptRoot "runtime\node.exe")
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$targetDirectory = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Copy-Item -LiteralPath $node -Destination $Destination -Force
Write-Output "Bundled Node runtime: $Destination"
