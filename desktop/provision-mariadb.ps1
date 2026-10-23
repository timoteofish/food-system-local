[CmdletBinding()]
param(
  [string]$MariaRoot = "C:\Program Files\MariaDB 13.0",
  [string]$Database = "food_system",
  [string]$AppUser = "food_system",
  [Parameter(Mandatory = $true)][SecureString]$AppPassword,
  [Parameter(Mandatory = $true)][SecureString]$RootPassword,
  [string]$HostName = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$client = Join-Path $MariaRoot "bin\mariadb.exe"
if (-not (Test-Path -LiteralPath $client)) { throw "MariaDB client not found at $client" }

$appBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AppPassword)
$rootBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($RootPassword)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($appBstr)
  $rootPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rootBstr)
  if ($plainPassword.Length -lt 16) { throw "AppPassword must contain at least 16 characters" }
  $escapedPassword = $plainPassword.Replace("'", "''")
  $sql = "CREATE DATABASE IF NOT EXISTS ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '$AppUser'@'$HostName' IDENTIFIED BY '$escapedPassword'; ALTER USER '$AppUser'@'$HostName' IDENTIFIED BY '$escapedPassword'; GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES ON ``$Database``.* TO '$AppUser'@'$HostName'; FLUSH PRIVILEGES;"
  $env:MYSQL_PWD = $rootPassword
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
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
  $plainPassword = $null
  $rootPassword = $null
  $escapedPassword = $null
  if ($appBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($appBstr) }
  if ($rootBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rootBstr) }
}

Write-Output "Database '$Database' and restricted user '$AppUser@$HostName' are ready. Set MYSQL_USER and MYSQL_PASSWORD in backend/.env."
