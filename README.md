# Food System Local

Food System Local is a restaurant management system designed to bring everyday operations together in one application. It supports menus and products, table service, QR code ordering, kitchen workflows, cashier operations, inventory, deliveries, and operational records. The system is intended for local use, with restaurant data managed by the installation.

## How it is built

The application uses a web frontend built with HTML, CSS, and JavaScript, a Node.js backend, and a SQLite database. A Tauri desktop shell packages the application for desktop use. The current interface runs in Brazilian Portuguese; English translation resources remain in the repository, but language selection is not currently enabled.

## Development setup

Use Node.js 24 and npm, then install dependencies from the repository root:

```sh
npm ci
npm ci --prefix backend
npm run dev --prefix backend
```

The backend uses a local SQLite database. Set `FOOD_SYSTEM_DATA_DIR` to a separate directory when working with disposable data; preserve the existing database and encryption key. The integration tests require a running test API and should use an isolated database. See [backend/README.md](backend/README.md) for configuration and commands. Windows installer builds prepare the runtime with the PowerShell script; Linux builds use the Node.js preparation script and the platform-specific Tauri configuration.

The Tauri development launcher supports Linux, macOS, and Windows; run `npm run desktop:dev` with the platform's Tauri prerequisites installed. It uses the application's data directory unless `FOOD_SYSTEM_DATA_DIR` is set. The Windows installer configuration targets MSI and NSIS; the Linux configuration targets DEB, RPM, and AppImage. Installer builds and packaged runtime behavior have not yet been validated on either platform, and macOS installer targets are not configured.

## Current scope and production readiness

The current product is a single-computer, local restaurant operations app. Its operational areas include catalog and menu, table and QR orders, kitchen, cashier, inventory and recipes, deliveries, reports, team roster, and encrypted local backups. The frontend and local SQLite workflows have automated coverage, but that does not mean every workflow has been accepted in a customer environment.

The team screen is a roster, not employee identity or access control. Separate installations do not synchronize data. Provider integrations are not production connectors, and fiscal documents are drafts only; do not use them as issued tax documents. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the current evidence and open release gates.

For a small single-location business, the app may be evaluated as a supervised local pilot after a backup/restore drill and validation on the target computer and peripherals. Do not rely on it for unattended operations until those checks pass. For a multi-location business or a large company, it is not ready: employee permissions, cross-location synchronization, provider-specific integrations, fiscal issuance, and target-platform release validation are still required.
