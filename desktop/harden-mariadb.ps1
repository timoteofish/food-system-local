[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$MariaRoot = "C:\Program Files\MariaDB 11.8",
  [switch]$RestartService
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $MariaRoot "data\my.ini"
if (-not (Test-Path -LiteralPath $configPath)) { throw "MariaDB configuration not found at $configPath" }

$content = Get-Content -LiteralPath $configPath -Raw
if ($content -notmatch '(?im)^\[mysqld\]') { throw "The MariaDB configuration has no [mysqld] section" }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "$configPath.food-system-backup-$timestamp"
if ($PSCmdlet.ShouldProcess($configPath, "Create a backup at $backupPath and restrict MariaDB to loopback")) {
  Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
  $updated = $content
  if ($updated -match '(?im)^\s*bind-address\s*=') {
    $updated = [regex]::Replace($updated, '(?im)^\s*bind-address\s*=.*$', 'bind-address=127.0.0.1')
  } else {
    $updated = [regex]::Replace($updated, '(?im)^\[mysqld\]\s*$', "[mysqld]`r`nbind-address=127.0.0.1")
  }
  if ($updated -notmatch '(?im)^\s*skip-name-resolve\s*$') {
    $updated = [regex]::Replace($updated, '(?im)^\[mysqld\]\s*$', "[mysqld]`r`nskip-name-resolve")
  }
  [System.IO.File]::WriteAllText($configPath, $updated, [System.Text.UTF8Encoding]::new($false))
  Write-Output "MariaDB restricted to 127.0.0.1. Backup: $backupPath"
}

if ($RestartService) {
  $serviceRoot = [System.IO.Path]::GetFullPath($MariaRoot).TrimEnd('\')
  $serviceRootPattern = [regex]::Escape($serviceRoot)
  $services = Get-CimInstance Win32_Service | Where-Object {
    $_.Name -match 'MariaDB|MySQL' -and $_.PathName -match $serviceRootPattern
  }
  if (-not $services) { throw "No MariaDB/MySQL Windows service was found under '$serviceRoot'. Restart the server installed there manually." }
  foreach ($service in $services) {
    if ($PSCmdlet.ShouldProcess($service.Name, "Restart the MariaDB service installed under '$serviceRoot'")) { Restart-Service -Name $service.Name -Force }
  }
}
