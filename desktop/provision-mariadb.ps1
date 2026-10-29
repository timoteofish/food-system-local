[CmdletBinding()]
param(
  [string]$MariaRoot = "C:\Program Files\MariaDB 11.8",
  [string]$Database = "food_system",
  [string]$AppUser = "food_system",
  [string]$MaintenanceUser = "food_system_maintenance",
  [Parameter(Mandatory = $true)][SecureString]$AppPassword,
  [Parameter(Mandatory = $true)][SecureString]$RootPassword,
  [ValidateSet("127.0.0.1")][string]$HostName = "127.0.0.1",
  [string]$ConfigPath = (Join-Path $env:APPDATA "com.foodsystem.local\config.env")
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]{1,64}$') { throw "Database must contain only letters, digits, and underscores (up to 64 characters)." }
if ($AppUser -notmatch '^[A-Za-z0-9_]{1,32}$') { throw "AppUser must contain only letters, digits, and underscores (up to 32 characters)." }
if ($MaintenanceUser -notmatch '^[A-Za-z0-9_]{1,32}$' -or $MaintenanceUser -eq $AppUser) { throw "MaintenanceUser must be a distinct SQL identifier (up to 32 characters)." }
$client = Join-Path $MariaRoot "bin\mariadb.exe"
if (-not (Test-Path -LiteralPath $client)) { throw "MariaDB client not found at $client" }

$appBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AppPassword)
$rootBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($RootPassword)
$plainPassword = $null
$maintenancePassword = $null
$maintenanceBytes = $null
$randomGenerator = $null
$rootPlainPassword = $null
$escapedPassword = $null
$sql = $null
$processInfo = $null
$process = $null
$acl = $null
$configTempPath = $null
$configLines = @()
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($appBstr)
  $rootPlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rootBstr)
  if ($plainPassword.Length -lt 16 -or $plainPassword -match '[\\"\r\n]') { throw "AppPassword must contain at least 16 characters and no quotes, backslashes, or line breaks" }
  $escapedPassword = $plainPassword.Replace("'", "''")
  $maintenanceBytes = New-Object byte[] 32
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $randomGenerator.GetBytes($maintenanceBytes)
  $maintenancePassword = [BitConverter]::ToString($maintenanceBytes).Replace("-", "").ToLowerInvariant()
  # Recreate both dedicated accounts so stale grants cannot survive provisioning.
  $sql = "CREATE DATABASE IF NOT EXISTS ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; DROP USER IF EXISTS '$AppUser'@'$HostName'; DROP USER IF EXISTS '$MaintenanceUser'@'$HostName'; CREATE USER '$AppUser'@'$HostName' IDENTIFIED BY '$escapedPassword'; CREATE USER '$MaintenanceUser'@'$HostName' IDENTIFIED BY '$maintenancePassword'; GRANT SELECT, INSERT, UPDATE, DELETE ON ``$Database``.* TO '$AppUser'@'$HostName'; GRANT ALL PRIVILEGES ON ``$Database``.* TO '$MaintenanceUser'@'$HostName'; GRANT SHUTDOWN ON *.* TO '$MaintenanceUser'@'$HostName'; FLUSH PRIVILEGES;"
  $env:MYSQL_PWD = $rootPlainPassword
  $processInfo = [Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $client
  $processInfo.Arguments = "--protocol=tcp --host=127.0.0.1 --user=root --batch --skip-column-names"
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardInput = $true
  $process = [Diagnostics.Process]::Start($processInfo)
  $process.StandardInput.WriteLine($sql)
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "MariaDB provisioning failed. Authenticate as root and rerun this script." }

  $parent = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $managedConfigKeys = @("MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_MAINTENANCE_USER", "MYSQL_MAINTENANCE_PASSWORD")
  if (Test-Path -LiteralPath $ConfigPath) {
    foreach ($line in [System.IO.File]::ReadAllLines($ConfigPath)) {
      $isManagedKey = $false
      foreach ($key in $managedConfigKeys) {
        if ($line -match "^\s*$([regex]::Escape($key))\s*=") { $isManagedKey = $true; break }
      }
      if (-not $isManagedKey) { $configLines += $line }
    }
  }
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($currentSid)
  $systemSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
  foreach ($sid in @($currentSid, $systemSid)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
    [void]$acl.AddAccessRule($rule)
  }
  if (Test-Path -LiteralPath $ConfigPath) { Set-Acl -LiteralPath $ConfigPath -AclObject $acl }
  $configLines += @(
    "MYSQL_HOST=$HostName",
    "MYSQL_PORT=3306",
    "MYSQL_DATABASE=$Database",
    "MYSQL_USER=$AppUser",
    "MYSQL_PASSWORD=`"$plainPassword`"",
    "MYSQL_MAINTENANCE_USER=$MaintenanceUser",
    "MYSQL_MAINTENANCE_PASSWORD=$maintenancePassword"
  )
  $configContent = $configLines -join [Environment]::NewLine
  $configTempPath = "$ConfigPath.$([guid]::NewGuid().ToString('N')).tmp"
  [System.IO.File]::WriteAllText($configTempPath, "", [System.Text.UTF8Encoding]::new($false))
  Set-Acl -LiteralPath $configTempPath -AclObject $acl
  [System.IO.File]::WriteAllText($configTempPath, $configContent, [System.Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $ConfigPath) {
    [System.IO.File]::Replace($configTempPath, $ConfigPath, $null)
  } else {
    [System.IO.File]::Move($configTempPath, $ConfigPath)
  }
  Set-Acl -LiteralPath $ConfigPath -AclObject $acl
} finally {
  if ($configTempPath -and (Test-Path -LiteralPath $configTempPath)) { Remove-Item -LiteralPath $configTempPath -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  $plainPassword = $null
  $maintenancePassword = $null
  if ($maintenanceBytes) { [Array]::Clear($maintenanceBytes, 0, $maintenanceBytes.Length) }
  if ($randomGenerator) { $randomGenerator.Dispose() }
  $rootPlainPassword = $null
  $escapedPassword = $null
  $sql = $null
  $configContent = $null
  $configLines = @()
  $processInfo = $null
  $process = $null
  $acl = $null
  if ($appBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appBstr) }
  if ($rootBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rootBstr) }
}

Write-Output "Database '$Database', restricted runtime user '$AppUser@$HostName', and separate maintenance user '$MaintenanceUser@$HostName' are ready. The maintenance user also has the global SHUTDOWN privilege required for clean local server shutdown. Tauri configuration written to '$ConfigPath'. Restart Food System to run migrations."
