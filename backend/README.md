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
│   ├── dev-server.js     # Source/development API entry point; loads local env and secret
│   ├── db.js             # SQLite adapter, database lifecycle, backup/restore primitives
│   ├── config.js         # Environment loading and runtime configuration validation
│   ├── security.js       # Secret and backup encryption, sensitive-field redaction
│   ├── maintenance.js    # Request gate and drain coordination during restore
│   ├── audit.js          # Administrative audit writes
│   ├── backup-local.js   # Standalone backup entry point; loads env and prepares local key
│   ├── backup.js         # Encrypted SQLite backup implementation
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

Route plugins currently cover authentication, business profiles and team, catalog, tables and public menus, orders, cash register, inventory and purchases, customer value, reports, integrations, fiscal documents, delivery/couriers, kitchen stations, and backups. Table QR codes create orders directly; the removed dining-tab workflow is not registered. `server.js` registers these plugins and applies cross-cutting behavior once for the API process.

The inventory API supports supplier purchase orders with partial receipts and reversible receipts, storage transfers with explicit ship/receive steps, per-location reorder thresholds, snapshot counts with independent approval, lot quarantine/recall, and production batches tied to versioned recipes. Production output becomes finished-product lot stock; order reservations draw from prepared stock first and reserve recipe ingredients only for the remaining demand. Inventory items are archived with an `active` flag rather than deleted. Balance and reorder endpoints report usable stock from active, unexpired lots in active locations; lot history retains physical on-hand quantities. Stock-count snapshots currently exclude expired lots as well as quarantined or recalled lots; a full physical count including those lots is not supported.

## Runtime lifecycle

For desktop use, the Tauri launcher prepares the per-install data directory and local secrets, runs `src/migrate.js`, then starts `src/server.js` as a child process. The API binds to loopback (production configuration rejects a non-loopback host); the desktop launcher serves/proxies the local application. The packaged application includes the backend source, SQLite schema, production Node dependencies, and a Node runtime.

The server registers CORS and sensible HTTP helpers, enforces the configured request body limit, applies security/cache headers, and handles graceful shutdown by closing Fastify and the database. `/up` is a lightweight process endpoint; `/api/v1/health` runs SQLite's quick check and reports database availability.

### Request flow

Requests enter the restore-maintenance gate before route handling. Authentication and route-level authorization are implemented in `routes/auth.js`; business-scoped routes check the caller's business membership and role. The installed local application uses a local administrator token. In development, loopback browser origins are also accepted so the frontend can run through tools such as VS Code Live Server; this path is disabled in production. Registration/login endpoints are available only outside production. Mutating authenticated requests are audited by a server response hook unless the route already wrote a more specific audit event.

The API is versioned under `/api/v1`. Order creation and status changes validate the request, apply business rules, and persist related records in SQLite transactions where needed. Order printing is represented as queued print jobs; the separate worker claims jobs before sending. Failed or interrupted requests require review because their print outcome can be uncertain. The worker is an explicit process (`npm run print:worker`), not automatically started by `server.js`.

## Persistence and schema

The active local database is SQLite and is opened through Node's built-in `node:sqlite`. `src/db.js` creates a new database from `sqlite/schema.sql`, enables foreign keys, WAL mode, a five-second busy timeout, and full synchronous writes. A single synchronous SQLite connection is exposed through an asynchronous compatibility adapter named `pool`; a mutex serializes access and keeps transactions on that connection. It is not a multi-connection database pool.

By default, the desktop launcher sets `FOOD_SYSTEM_DATA_DIR` to the application's user-data directory. Outside the launcher, the database defaults to `backend/state/food-system.sqlite`; `FOOD_SYSTEM_DB_PATH` can override the path. On POSIX systems, the database and its default data directory are restricted to the current user. The source `npm start` and `npm run dev` commands create and reuse a local `secret.key` in the data directory so encrypted backups and integration credentials work during development. Keep this key with the encrypted backups. If encrypted backups exist but the key is missing, startup stops instead of generating a key that cannot restore them.

`sqlite/schema.sql` creates the baseline schema. Numbered files in `sqlite/migrations/` are incremental SQLite migrations; `src/db.js` applies each unapplied file transactionally whenever the database opens, including after restore. Files in `sql/migrations/` are historical MariaDB migrations; the current application does not import a MariaDB database. `src/migrate.js` checks the SQLite baseline. Do not edit a historical MariaDB file to change an installed SQLite database.

## Backups and restore behavior

The backup API is restricted to the local desktop administrator. It creates a consistent SQLite backup, encrypts it with AES-256-GCM using `FOOD_SYSTEM_SECRET_KEY`, and stores the encrypted file under the configured backup directory. Restore validates the backup name, decrypts to a temporary file, checks SQLite integrity and foreign keys, creates a safety backup, and then replaces the database. During replacement, the API stops admitting new requests and drains active requests. It refuses restoration while a current print, standalone backup, initialization, migration, or seed process is registered against the same database and prevents those workers from starting during restoration; stop the print worker or wait for backup and maintenance commands to finish and retry. This does not coordinate older workers or arbitrary external database processes, which must also be stopped. If restore/recovery fails, a recovery marker is retained and the launcher keeps the service in maintenance for operator review.

The backup screen saves only on the current computer; it does not export files or the key. To prepare for loss of that computer, copy the encrypted `.sqlite.enc` files from the data directory's `backups` folder to another device, and separately preserve the original `secret.key` in a protected location. For the installed Windows application the data directory is normally `%APPDATA%\com.foodsystem.local`; for a source launcher it may instead be set by `FOOD_SYSTEM_DATA_DIR`. On a replacement installation, the original key and encrypted backups must be placed in the corresponding data directory before using the app's restore action. If `FOOD_SYSTEM_SECRET_KEY` was explicitly supplied instead of the generated file, preserve that exact value securely. Test recovery on an isolated installation before relying on these copies.

If the current database fails integrity or foreign-key checks, the application refuses to replace it because it cannot create a restorable safety backup. Preserve the existing database, encrypted backups and key for administrator-assisted recovery; do not delete or overwrite them while investigating.

The standalone tasks are available through `npm run db:backup`, `npm run db:restore -- <sqlite-file>`, and `npm run db:update`. Database initialization, migration, seeding, standalone restoration, and the print worker load the same `FOOD_SYSTEM_ENV_FILE` configuration as the source launcher; existing process environment variables take precedence. The standalone restore accepts a plaintext SQLite database, not an encrypted `.sqlite.enc` backup. Stop the desktop app, API, workers, and any other processes using the destination database before running it: current API and worker processes coordinate with restoration, but older versions and arbitrary external processes do not. It snapshots committed source WAL changes, validates the snapshot, and stages it on the destination filesystem. For encrypted backups, use the restore action in the app. Incremental SQLite migrations run at database open; `db:update` creates a backup and verifies the baseline, but does not apply the historical MariaDB SQL files.

## Security and external requests

Configuration is loaded from the path in `FOOD_SYSTEM_ENV_FILE` when supplied, otherwise from the normal dotenv location. Production mode requires the API to bind to loopback and validates update metadata when an update URL is configured. Login and registration have in-memory per-process rate limits; authentication passwords are derived with Node's `scrypt`, session tokens are stored as hashes, and integration credentials/backups use authenticated encryption. Outbound HTTPS helpers validate public destinations to reduce server-side request forgery risk; printer HTTP is permitted only for loopback destinations.

The update-check route reports configured version metadata. Downloading an update is a separate desktop operation: `desktop/download-update.mjs` downloads over HTTPS and verifies the configured SHA-256 digest and public-key signature before saving the package. The backend endpoint itself does not install an update.

## Configuration

Start with `.env.example`; the desktop launcher supplies the local data paths and secrets in installed mode. Common variables include:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode; production enables stricter local-access and update configuration checks. |
| `HOST`, `PORT` | Standalone API bind address and port (`127.0.0.1:3000` by default). The desktop launcher fixes the API at `127.0.0.1:3000` to match the packaged frontend and proxy. |
| `FOOD_SYSTEM_DATA_DIR` | Directory for the local database and related application data. |
| `FOOD_SYSTEM_DB_PATH` | Optional explicit SQLite database path. |
| `FOOD_SYSTEM_SECRET_KEY` | Key material for integration credentials and encrypted backups; must be at least 32 characters. |
| `FOOD_SYSTEM_LOCAL_ACCESS_TOKEN` | Token used by the installed local administrator flow. |
| `COURIER_TOKEN_DAYS` | Courier token lifetime in whole days, from 1 to 3650; defaults to 30. Invalid values prevent issuing a token without replacing the existing one. |
| `CORS_ORIGINS` | Comma-separated browser origins accepted by the API. |
| `UPDATE_URL`, `UPDATE_SHA256`, `UPDATE_SIGNATURE`, `UPDATE_PUBLIC_KEY`, `UPDATE_VERSION`, `UPDATE_NOTES` | Signed update metadata exposed to the desktop client. |
| `FISCAL_PROVIDER_URL` | HTTPS destination for fiscal-document integration. |

Never commit real secrets or production environment files.

For customer and courier access from another device, the desktop launcher must be started with `FRONTEND_HOST` set to the network interface (or `0.0.0.0`) and `FRONTEND_TLS_KEY` and `FRONTEND_TLS_CERT` set to the HTTPS private key and certificate paths. Set `FOOD_SYSTEM_PUBLIC_MENU_URL` to the externally reachable HTTPS origin, including the port when needed, before starting the desktop application. These launcher settings are process environment variables, not settings in the backend `config.env`. The phone must be able to reach that address and trust the certificate; configuring the address alone does not establish connectivity. The courier address is `/pages/courier/index.html`; share the separately issued access token privately.

## Development commands

Run these commands from the repository root or use `npm --prefix backend ...`:

Test commands use a temporary SQLite database when no data path is supplied. API integration tests are skipped unless `FOOD_SYSTEM_API_URL` and an explicit `FOOD_SYSTEM_DATA_DIR` or `FOOD_SYSTEM_DB_PATH` are set. Point both the test process and the test API at the same isolated database; do not use an operational database or API for integration tests.

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

- Each installed establishment owns its local database and local API process. Multiple storage and production locations inside that business share its local database; separate installations do not synchronize with one another through this backend.
- SQLite writes are serialized by the adapter. Validate expected concurrent terminal/order traffic with representative load before deployment; changing the HTTP runtime alone does not remove SQLite's single-writer behavior.
- Back up application data and preserve the encryption key together. Encrypted backups cannot be restored without the matching key.
- Roll out application/schema changes carefully and verify backup restoration on the target platform before broad deployment.
