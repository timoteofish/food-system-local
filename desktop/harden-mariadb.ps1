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
  $managedBlock = '(?im)^\s*# BEGIN FOOD SYSTEM LOOPBACK HARDENING\s*$[\s\S]*?^\s*# END FOOD SYSTEM LOOPBACK HARDENING\s*$(?:\r?\n)?'
  $updated = [regex]::Replace($content, $managedBlock, '')
  $updated = $updated.TrimEnd([char[]]@("`r", "`n"))
  $updated += "`r`n`r`n# BEGIN FOOD SYSTEM LOOPBACK HARDENING`r`n[mysqld]`r`nbind-address=127.0.0.1`r`nskip-name-resolve`r`n# END FOOD SYSTEM LOOPBACK HARDENING`r`n"
  $configAcl = Get-Acl -LiteralPath $configPath
  $configTempPath = "$configPath.food-system-$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllText($configTempPath, "", [System.Text.UTF8Encoding]::new($false))
    Set-Acl -LiteralPath $configTempPath -AclObject $configAcl
    [System.IO.File]::WriteAllText($configTempPath, $updated, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Replace($configTempPath, $configPath, $null)
  } finally {
    if (Test-Path -LiteralPath $configTempPath) { Remove-Item -LiteralPath $configTempPath -Force -ErrorAction SilentlyContinue }
  }
  Write-Output "MariaDB restricted to 127.0.0.1. Backup: $backupPath"
}

if ($RestartService) {
  $serviceRoot = [System.IO.Path]::GetFullPath($MariaRoot).TrimEnd('\')
  $serviceExecutablePattern = '^\s*"?' + [regex]::Escape($serviceRoot) + '[\\/]+bin[\\/]+(?:mariadbd|mysqld)\.exe"?(?:\s|$)'
  $services = Get-CimInstance Win32_Service | Where-Object {
    $_.Name -match 'MariaDB|MySQL' -and $_.PathName -match $serviceExecutablePattern
  }
  if (-not $services) { throw "No MariaDB/MySQL Windows service was found under '$serviceRoot'. Restart the server installed there manually." }
  foreach ($service in $services) {
    if ($PSCmdlet.ShouldProcess($service.Name, "Restart the MariaDB service installed under '$serviceRoot'")) { Restart-Service -Name $service.Name -Force }
  }
}
