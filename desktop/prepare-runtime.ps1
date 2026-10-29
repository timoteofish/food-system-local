param(
  [string]$Destination = (Join-Path $PSScriptRoot "runtime\node.exe")
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $node --version).Trim()
if ($nodeVersion -notmatch '^v(?<Major>\d+)\.' -or [int]$Matches.Major -ne 24) {
  throw "Node.js 24 LTS is required to bundle the backend runtime. Found '$nodeVersion'."
}
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$backend = Join-Path $PSScriptRoot "..\backend"
& $npm --prefix $backend ci --omit=dev
if ($LASTEXITCODE -ne 0) {
  throw "Could not install the backend production dependencies (npm exit code $LASTEXITCODE)."
}
$targetDirectory = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Copy-Item -LiteralPath $node -Destination $Destination -Force
Write-Output "Backend production dependencies and Node runtime are ready for bundling."
