# Food System Local

Food System Local is a restaurant management application designed to reduce operating costs and extend the useful life of the system, instead of recurring platform fees, customers use a locally installed application supported by ongoing maintenance and shared product improvements.

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

The same product is distributed to multiple customers. General improvements, bug fixes, security updates, and new features are developed once and delivered as shared releases, customer-specific changes remain isolated and can be handled as separate work.

## Product Goals

- Keep the system affordable for small and medium-sized food businesses.
- Work locally without requiring a recurring online subscription.
- Continue operating when the internet is unavailable.
- Preserve each customer's data and configuration during updates.
- Make remote maintenance and support practical.
- Provide a stable foundation for future features.

## Planned Architecture

```text
Tauri desktop application
        |
        v
Local Node.js API
        |
        v
Local MySQL database
```

- Tauri will provide the installable Windows application.
- The existing HTML, CSS, and JavaScript interface will be adapted and reused where appropriate.
- Node.js will provide the local API and business rules.
- MySQL will store the local operational data.
- The application may expose the menu and ordering flow over the restaurant's local network for QR code access.

## Distribution and Maintenance

Each customer receives the same application package with its own local database and business settings, the application is designed to support:

- Versioned releases
- Database migrations
- Backups before updates
- Rollback procedures
- Remote support through tools such as AnyDesk
- Shared improvements distributed to all installations

The application is intended primarily for Windows 10 and Windows 11, compatibility with older Windows versions will be evaluated through dedicated testing.

## Current Project Structure

```text
food-system-local/
├── frontend/       # Reusable user interface
└── backend/        # Local Node.js API and database integration
```

## Current Status

The project currently includes the initial Node.js backend foundation, MySQL configuration, database initialization, and the first business, category, and product API routes, the previous system remains available in the separate original repository as a migration reference.

## License

See [LICENSE](LICENSE)
