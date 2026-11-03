# Food System Local

Food System Local is a restaurant management application for menus, table service, QR ordering, kitchen workflows, cashier operations, inventory, delivery, and operational records. The desktop app contains the Food System interface and a local Node.js API. Its application data lives in one SQLite database file in the user's application-data folder; installing or updating the application does not replace that folder.

## Local database

SQLite is built into the bundled Node.js 24 runtime, so a normal installation does not need MariaDB, a database service, administrator setup, or a network connection. The first launch creates `food-system.sqlite` and its schema. On POSIX systems, the data directory is restricted to the current user and the database file is created with owner-only permissions. SQLite foreign keys, WAL journaling, full synchronous writes, and integrity checks are enabled.

When an existing installation has the prior MariaDB settings in its `config.env`, the first SQLite startup reads the legacy MariaDB database and imports matching Food System tables into a private staged file. The app checks SQLite integrity and foreign-key consistency before publishing that file. It does not alter or delete the MariaDB database. If the old database is unavailable or its schema cannot be imported safely, startup stops with an error instead of silently opening a blank database. Keep the existing config and MariaDB data until the SQLite copy has been checked and backed up.

The application creates encrypted SQLite snapshots for backups and validates a snapshot before restore. Restore also creates an encrypted safety backup, drains active API requests, and keeps recovery state if both restoration and automatic recovery fail.

## Development

Use Node.js 24 or newer. The backend's `mysql2` package remains only to read an existing MariaDB database during the one-time transition; application queries and normal operation use SQLite.

```sh
npm ci
npm ci --prefix backend
npm run desktop:dev
```

Backend commands:

```sh
npm --prefix backend test
npm --prefix backend run db:migrate
npm --prefix backend run db:seed
npm --prefix backend run db:backup
```

Set `FOOD_SYSTEM_DATA_DIR` to choose the application-data folder. `FOOD_SYSTEM_DB_PATH` can select a specific SQLite file for development and tests. `FOOD_SYSTEM_SECRET_KEY` protects encrypted backup files; packaged desktop startup creates and stores a local key in the user's application-data folder.

The interface is available in English and Portuguese. See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the latest validation state and open release checks.
