# Food System Backend

This directory contains the local HTTP API, SQLite persistence layer, database assets, operational command-line tasks, and backend tests for Food System Local. The backend is implemented in JavaScript (ES modules) on Node.js and uses Fastify for HTTP routing.

## Responsibilities and directory map

```text
backend/
├── sql/
│   └── migrations/       # Ordered legacy MariaDB schema/migration history
├── sqlite/
│   └── schema.sql        # Current SQLite schema used when creating a local database
├── src/
│   ├── routes/           # Fastify route plugins, grouped by product area
│   ├── server.js         # API composition, global hooks, health checks, shutdown
│   ├── db.js             # SQLite adapter, database lifecycle, backup/restore primitives
│   ├── config.js         # Environment loading and runtime configuration validation
│   ├── security.js       # Secret and backup encryption, sensitive-field redaction
│   ├── maintenance.js    # Request gate and drain coordination during restore
│   ├── audit.js          # Administrative audit writes
│   ├── backup.js         # Encrypted backup command
│   ├── restore.js        # Validated database restore command
│   ├── migrate.js        # Startup schema-baseline check
│   ├── init-db.js        # Database initialization entry point
│   ├── seed.js           # Development data command
│   ├── print-worker.js   # Optional queued kitchen-print job worker
│   └── *.js              # Shared domain and validation helpers
├── test/                 # Unit, integration, security, maintenance, and API contract tests
├── package.json          # Runtime scripts and production dependencies
└── .env.example          # Example local configuration
```

Route plugins currently cover authentication, business profiles and team, catalog, tables and public menus, orders, cash register, dining tabs, inventory and purchases, customer value, reports, integrations, fiscal documents, delivery/couriers, kitchen stations, and backups. `server.js` registers these plugins and applies cross-cutting behavior once for the API process.

## Runtime lifecycle

For desktop use, the Tauri launcher prepares the per-install data directory and local secrets, runs `src/migrate.js`, then starts `src/server.js` as a child process. The API binds to loopback (production configuration rejects a non-loopback host); the desktop launcher serves/proxies the local application. The packaged application includes the backend source, SQLite schema, production Node dependencies, and a Node runtime.

The server registers CORS and sensible HTTP helpers, enforces the configured request body limit, applies security/cache headers, and handles graceful shutdown by closing Fastify and the database. `/up` is a lightweight process endpoint; `/api/v1/health` runs SQLite's quick check and reports database availability.

### Request flow

Requests enter the restore-maintenance gate before route handling. Authentication and route-level authorization are implemented in `routes/auth.js`; business-scoped routes check the caller's business membership and role. The installed local application uses a local administrator token. Registration/login endpoints are available only outside production. Mutating authenticated requests are audited by a server response hook unless the route already wrote a more specific audit event.

The API is versioned under `/api/v1`. Order creation and status changes validate the request, apply business rules, and persist related records in SQLite transactions where needed. Order printing is represented as queued print jobs; the separate worker polls eligible jobs and retries failures up to three attempts. The worker is an explicit process (`npm run print:worker`), not automatically started by `server.js`.

## Persistence and schema

The active local database is SQLite and is opened through Node's built-in `node:sqlite`. `src/db.js` creates a new database from `sqlite/schema.sql`, enables foreign keys, WAL mode, a five-second busy timeout, and full synchronous writes. A single synchronous SQLite connection is exposed through an asynchronous compatibility adapter named `pool`; a mutex serializes access and keeps transactions on that connection. It is not a multi-connection database pool.

By default, the desktop launcher sets `FOOD_SYSTEM_DATA_DIR` to the application's user-data directory. Outside the launcher, the database defaults to `backend/state/food-system.sqlite`; `FOOD_SYSTEM_DB_PATH` can override the path. On POSIX systems, the database and its default data directory are restricted to the current user.

`sqlite/schema.sql` is the current schema source for newly created SQLite databases. Files in `sql/migrations/` are the ordered MariaDB-era schema/migration history and are retained for historical/import compatibility; the current `src/migrate.js` does not execute those SQL files. It verifies that the SQLite database exposes its schema-baseline record. Do not treat editing a historical SQL file as a migration of an installed SQLite database.

## Backups and restore behavior

The backup API is restricted to the local desktop administrator. It creates a consistent SQLite backup, encrypts it with AES-256-GCM using `FOOD_SYSTEM_SECRET_KEY`, and stores the encrypted file under the configured backup directory. Restore validates the backup name, decrypts to a temporary file, checks SQLite integrity and foreign keys, creates a safety backup, and then replaces the database. During replacement, the API stops admitting new requests and drains active requests. If restore/recovery fails, a recovery marker is retained and the launcher keeps the service in maintenance for operator review.

The standalone tasks are available through `npm run db:backup`, `npm run db:restore -- <sqlite-file>`, and `npm run db:update`. The latter runs a backup followed by the current schema-baseline check; it does not apply the historical MariaDB SQL files.

## Security and external requests

Configuration is loaded from the path in `FOOD_SYSTEM_ENV_FILE` when supplied, otherwise from the normal dotenv location. Production mode requires the API to bind to loopback and validates update metadata when an update URL is configured. Login and registration have in-memory per-process rate limits; authentication passwords are derived with Node's `scrypt`, session tokens are stored as hashes, and integration credentials/backups use authenticated encryption. Outbound HTTPS helpers validate public destinations to reduce server-side request forgery risk; printer HTTP is permitted only for loopback destinations.

The update-check route reports configured version metadata. Downloading an update is a separate desktop operation: `desktop/download-update.mjs` downloads over HTTPS and verifies the configured SHA-256 digest and public-key signature before saving the package. The backend endpoint itself does not install an update.

## Configuration

Start with `.env.example`; the desktop launcher supplies the local data paths and secrets in installed mode. Common variables include:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode; production enables stricter local-access and update configuration checks. |
| `HOST`, `PORT` | API bind address and port (`127.0.0.1:3000` by default). |
| `FOOD_SYSTEM_DATA_DIR` | Directory for the local database and related application data. |
| `FOOD_SYSTEM_DB_PATH` | Optional explicit SQLite database path. |
| `FOOD_SYSTEM_SECRET_KEY` | Key material for integration credentials and encrypted backups; must be at least 32 characters. |
| `FOOD_SYSTEM_LOCAL_ACCESS_TOKEN` | Token used by the installed local administrator flow. |
| `CORS_ORIGINS` | Comma-separated browser origins accepted by the API. |
| `UPDATE_URL`, `UPDATE_SHA256`, `UPDATE_SIGNATURE`, `UPDATE_PUBLIC_KEY`, `UPDATE_VERSION`, `UPDATE_NOTES` | Signed update metadata exposed to the desktop client. |
| `FISCAL_PROVIDER_URL` | HTTPS destination for fiscal-document integration. |

Never commit real secrets or production environment files.

## Development commands

Run these commands from the repository root or use `npm --prefix backend ...`:

```sh
npm ci --prefix backend
npm run dev --prefix backend
npm start --prefix backend
npm test --prefix backend
npm run test:contract --prefix backend
npm run test:integration --prefix backend
npm run db:init --prefix backend
npm run db:seed --prefix backend
npm run print:worker --prefix backend
```

`npm run dev` starts the API with Node's watch mode. Tests use Node's built-in test runner. Set `NODE_ENV=test` and provide an isolated data/database path when running tests that open SQLite.

## Operational notes

- Each installed establishment owns its local database and local API process; installations do not share a database through this backend.
- SQLite writes are serialized by the adapter. Validate expected concurrent terminal/order traffic with representative load before deployment; changing the HTTP runtime alone does not remove SQLite's single-writer behavior.
- Back up application data and preserve the encryption key together. Encrypted backups cannot be restored without the matching key.
- Roll out application/schema changes carefully and verify backup restoration on the target platform before broad deployment.
