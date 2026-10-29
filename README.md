# Food System Local

Food System Local is a restaurant management application designed to reduce operating costs and extend the useful life of the system. Instead of recurring platform fees, customers use a locally installed application supported by ongoing maintenance and shared product improvements.

## Overview

The application brings the essential daily operations of a restaurant into one place:

- Business and menu configuration
- Categories and products
- Tables and QR codes
- Public digital menu
- Customer orders
- Order status management
- Cash register movements
- Local payment methods
- Backups and data restoration

The same product is distributed to multiple customers. General improvements, bug fixes, security updates, and new features are developed once and delivered as shared releases. Customer-specific changes remain isolated and can be handled as separate work.

## Product Goals

- Keep the system affordable for small and medium-sized food businesses.
- Work locally without requiring a recurring online subscription.
- Keep core restaurant operations available on the local computer when internet service is unavailable, subject to MariaDB and the local application being available.
- Preserve each customer's data and configuration during updates.
- Make remote maintenance and support practical.
- Provide a stable foundation for future features.

## Architecture

```text
Tauri desktop application
        |
        v
Local Node.js API
        |
        v
Local MySQL database
```

- Tauri 2 is configured to provide Windows MSI and NSIS bundles.
- The HTML, CSS, and JavaScript interface is served by the local launcher and reused in the Tauri window.
- Node.js provides the local API and business rules.
- MySQL/MariaDB stores operational data.
- The application may expose the menu and ordering flow over the restaurant's local network for QR code access. This optional mode also exposes the courier PWA's delivery list, delivery status, and location update endpoints through the HTTPS listener; management API routes remain bound to loopback.

## Distribution and Maintenance

Each customer receives the same application package with its own local database and business settings. The application is designed to support:

- Versioned releases
- Database migrations
- Backups before updates
- Rollback procedures
- Remote support through tools such as AnyDesk
- Shared improvements distributed to all installations

The application is intended primarily for Windows 10 and Windows 11. Compatibility with older Windows versions will be evaluated through dedicated testing.

## Current Project Structure

```text
food-system-local/
├── frontend/       # Management UI, public menu, courier UI
├── backend/        # Node.js API, SQL migrations, database integration
├── desktop/        # Local launcher, runtime preparation, maintenance scripts
└── src-tauri/      # Tauri 2 Windows desktop shell and bundle configuration
```

## Current Status

The repository contains management flows for products, inventory, orders, kitchen, tables, cashier, delivery, reports, fiscal records, integration configuration, team, and backups. The provider integration area is scaffolding: its connection check only probes a configured public HTTPS endpoint, and its generic webhook currently accepts `order.received`; it does not implement provider APIs or provider-specific synchronization. The backend has 22 ordered SQL migrations and route modules for these areas. Tauri packaging is configured, but release readiness is not established: MariaDB must currently be installed and initialized separately, and Windows installer builds and runtime behavior must be verified. Core operations are local, while optional QR image generation through `api.qrserver.com`, online update downloads, and any configured external provider require internet access. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for current findings and remaining release gates. The previous system remains available in the separate original repository as a migration reference.

Restoring a database backup temporarily places the API in maintenance. Before applying the selected backup, the application creates a new encrypted safety backup of the current database.

### Build Windows desktop installers

On a Windows build machine, install Node.js 24 LTS, the Rust MSVC toolchain, and Visual Studio C++ Build Tools. From the repository root, install the locked Tauri CLI dependency and build the configured MSI and NSIS installers with:

```powershell
npm ci
npm run desktop:build
```

The Tauri build hook installs the backend's production dependencies and copies the Node.js runtime from `PATH` into `desktop\runtime\node.exe` before packaging. The resulting installers are written under `src-tauri\target\release\bundle`. A successful build does not provision MariaDB; complete the database setup below before running the application.

For local Tauri development, install the root dependencies with `npm ci`, then run `npm run desktop:dev`. This command installs the backend dependencies before launching Tauri. MariaDB must already be installed, hardened, and provisioned as described below.

### Windows database setup

Install MariaDB 11.8 LTS. Before provisioning accounts, open PowerShell as Administrator in the project folder and restrict the server to loopback:

```powershell
.\desktop\harden-mariadb.ps1 -RestartService
```

The script backs up `my.ini`, sets `bind-address=127.0.0.1` and `skip-name-resolve`, and restarts only a MariaDB/MySQL Windows service whose executable path is under the selected MariaDB installation. If MariaDB is running without a Windows service, run the script without `-RestartService` and restart that server manually before continuing. Confirm that `SELECT @@bind_address;` returns `127.0.0.1`.

Then open a normal PowerShell session in the project folder. Run the provisioning script with the MariaDB root password and a new application password (at least 16 characters; do not use quotes, backslashes, or line breaks):

```powershell
$appPassword = Read-Host "New Food System database password" -AsSecureString
$rootPassword = Read-Host "MariaDB root password" -AsSecureString
.\desktop\provision-mariadb.ps1 -AppPassword $appPassword -RootPassword $rootPassword
```

The script creates the `food_system` database, a loopback-only runtime user with data access, and a separate loopback-only maintenance user for migrations and backups. The maintenance user also receives the global MariaDB `SHUTDOWN` privilege so the desktop launcher can stop a server it started cleanly when the app closes; the runtime user does not receive this privilege. It updates only its `MYSQL_*` entries in `%APPDATA%\com.foodsystem.local\config.env`, preserving other settings, then atomically replaces the file with owner-only access. The Tauri launcher reads this file. Start Food System after provisioning so it can apply the database migrations. If MariaDB is installed elsewhere, pass `-MariaRoot` and set the Windows `MARIADB_ROOT` environment variable so the launcher and backup/restore tools can find it; for a different Tauri data directory, pass the matching `-ConfigPath`.

### Optional customer QR ordering over the local network

The desktop app and management API stay on the restaurant computer. To let customer phones open the menu, configure a customer-reachable HTTPS origin and a certificate trusted by the phones. For example, use a LAN DNS name such as `food.example.lan` with a certificate whose subject alternative name includes that exact name, then set these user environment variables in Windows. Start a new session or sign out and back in before launching the app so it inherits them:

```powershell
[Environment]::SetEnvironmentVariable("FRONTEND_HOST", "0.0.0.0", "User")
[Environment]::SetEnvironmentVariable("FRONTEND_PORT", "4173", "User")
[Environment]::SetEnvironmentVariable("FRONTEND_TLS_KEY", "C:\FoodSystem\certs\key.pem", "User")
[Environment]::SetEnvironmentVariable("FRONTEND_TLS_CERT", "C:\FoodSystem\certs\cert.pem", "User")
[Environment]::SetEnvironmentVariable("FOOD_SYSTEM_PUBLIC_MENU_URL", "https://food.example.lan:4173", "User")
```

Permit inbound access to that HTTPS port only on the trusted private network. The LAN listener's same-origin proxy exposes health, public menu lookup, order creation, and the courier PWA's delivery list, status update, and location update routes. It does not expose management API routes; the Node management API remains bound to `127.0.0.1`. Public reads are limited to 120 requests per source IP per minute, and writes (orders and courier updates) share a limit of 60 per minute. Order bodies are limited to 64 KB and courier update bodies to 16 KB; courier requests require the courier token, and table tokens are checked against the active table by the API. The menu QR image is currently generated by `api.qrserver.com`, which receives the shareable URL and requires internet access.

## License

See [LICENSE](LICENSE)
