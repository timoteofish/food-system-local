[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$MariaRoot = "C:\Program Files\MariaDB 13.0",
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
  $services = Get-Service | Where-Object { $_.Name -match 'MariaDB|MySQL' }
  if (-not $services) { throw "MariaDB service was not found" }
  foreach ($service in $services) {
    if ($PSCmdlet.ShouldProcess($service.Name, "Restart MariaDB service")) { Restart-Service -Name $service.Name -Force }
  }
}
