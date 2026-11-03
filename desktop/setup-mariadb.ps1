#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$MariaRoot = "C:\Program Files\MariaDB 11.8",
  [string]$ConfigPath = (Join-Path $env:APPDATA "com.foodsystem.local\config.env"),
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
if ((Get-CimInstance Win32_OperatingSystem).OSArchitecture -notmatch "64") {
  throw "The pinned MariaDB MSI is 64-bit and requires 64-bit Windows."
}
$MariaRoot = [System.IO.Path]::GetFullPath($MariaRoot)
if ($MariaRoot -match '["\r\n]') { throw "MariaRoot must not contain quotes or line breaks." }
$runningApp = @(Get-Process -Name "food-system-local", "Food System" -ErrorAction SilentlyContinue)
if ($runningApp.Count -gt 0) {
  throw "Food System is running. Close the app before setup so MariaDB can be hardened and restarted without interrupting active work. No database setup changes were made."
}
$expectedVersion = "11.8.9"
$expectedHash = "372822572baa7f429b9068d583336a9e46b109c12bb0b24eb66dbeb6ad0a563e"
$installerUrl = "https://dlm.mariadb.com/4802822/MariaDB/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.msi"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $MariaRoot "bin\mariadbd.exe"
$defaultsPath = Join-Path $MariaRoot "data\my.ini"
$downloadedInstaller = $false

try {
  $hasMariaServer = Test-Path -LiteralPath $serverPath -PathType Leaf
  $hasMariaConfig = Test-Path -LiteralPath $defaultsPath -PathType Leaf
  if ($hasMariaServer -xor $hasMariaConfig) {
    throw "A partial MariaDB installation was found under '$MariaRoot'. Resolve that installation or pass the complete MariaDB installation folder with -MariaRoot; the bootstrap will not install over a partial instance."
  }
  if (-not $hasMariaServer) {
    $otherServices = @(Get-CimInstance Win32_Service | Where-Object {
      $_.PathName -match '(?i)\\bin\\(?:mariadbd|mysqld)\.exe'
    })
    if ($otherServices.Count -gt 0) {
      $names = ($otherServices | ForEach-Object { "$($_.Name): $($_.PathName)" }) -join [Environment]::NewLine
      throw "A MariaDB/MySQL service already exists. To avoid creating or modifying a second database instance, use its installation folder with -MariaRoot. Detected:`n$names"
    }

    if (-not $InstallerPath) {
      $downloadId = [guid]::NewGuid().ToString("N")
      $InstallerPath = Join-Path ([System.IO.Path]::GetTempPath()) "mariadb-$expectedVersion-$downloadId-winx64.msi"
      $downloadedInstaller = $true
      Invoke-WebRequest -Uri $installerUrl -OutFile $InstallerPath -UseBasicParsing
    }
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "MariaDB MSI not found: $InstallerPath" }
    $actualHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
      throw "MariaDB MSI SHA-256 did not match the official $expectedVersion artifact. Expected $expectedHash, received $actualHash. The installer was not started."
    }

    Write-Output "Starting the verified MariaDB $expectedVersion installer. Complete its interactive setup and use this installation folder: $MariaRoot"
    $quotedInstaller = '"' + $InstallerPath.Replace('"', '""') + '"'
    $installDirectoryArgument = 'INSTALLDIR="' + $MariaRoot + '"'
    $install = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @('/i', $quotedInstaller, $installDirectoryArgument) -Wait -PassThru
    if ($install.ExitCode -eq 3010) { throw "Windows requires a restart to finish MariaDB installation. Restart Windows, then rerun this setup script to harden and provision the database." }
    if ($install.ExitCode -ne 0) { throw "MariaDB installer exited with code $($install.ExitCode). No provisioning was attempted." }
    if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf) -or -not (Test-Path -LiteralPath $defaultsPath -PathType Leaf)) {
      throw "MariaDB installation completed, but the expected server files were not found under '$MariaRoot'. Rerun with -MariaRoot set to the folder selected in the installer."
    }
  }

  & (Join-Path $scriptDirectory "harden-mariadb.ps1") -MariaRoot $MariaRoot -RestartService
  $rootPassword = Read-Host "Enter the MariaDB root password chosen during installation" -AsSecureString
  & (Join-Path $scriptDirectory "provision-mariadb.ps1") -MariaRoot $MariaRoot -RootPassword $rootPassword -ConfigPath $ConfigPath
  Write-Output "MariaDB is installed, restricted to loopback, and provisioned for Food System. Restart Food System to apply database migrations."
} finally {
  if ($rootPassword) { $rootPassword.Dispose() }
  if ($downloadedInstaller -and (Test-Path -LiteralPath $InstallerPath)) {
    Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
  }
}
