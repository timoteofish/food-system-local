import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
const readFrontend = (file) => fs.readFile(new URL(`../../frontend/${file}`, import.meta.url), "utf8");
const readRoot = (file) => fs.readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("schema contains the operational tables", async () => {
  const sql = await read("sql/001_initial.sql");
  for (const table of ["users", "businesses", "categories", "products", "restaurant_tables", "orders", "order_items", "cash_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("legacy databases are backed up before their first tracked migration", async () => {
  const migrationRunner = await read("src/migrate.js");
  const detectExistingTables = migrationRunner.indexOf("table_name NOT IN ('schema_migrations', 'schema_migration_steps')");
  const createMigrationTable = migrationRunner.indexOf("CREATE TABLE IF NOT EXISTS schema_migrations");
  const requireBackupKey = migrationRunner.indexOf("A backup encryption key is required before applying database migrations");
  const createBackup = migrationRunner.indexOf('await execFile(process.execPath, ["src/backup.js"]');
  const createMigrationSteps = migrationRunner.indexOf("for (let index = 0; index < statements.length; index += 1)");
  assert.ok(detectExistingTables >= 0 && detectExistingTables < createMigrationTable);
  assert.ok(createMigrationTable < requireBackupKey && requireBackupKey < createBackup && createBackup < createMigrationSteps);
  assert.match(migrationRunner, /table_name NOT IN \('schema_migrations', 'schema_migration_steps'\)/);
  assert.match(migrationRunner, /const isExistingInstallation = before\.length > 0/);
  assert.match(migrationRunner, /if \(isExistingInstallation && pendingFiles\.length\)/);
  assert.match(migrationRunner, /A backup encryption key is required before applying database migrations/);
  assert.match(migrationRunner, /\["src\/backup\.js"\]/);
});

test("plaintext integration credentials are encrypted before their database column is dropped", async () => {
  const runner = await read("src/migrate.js");
  const helper = await read("src/migration-secrets.js");
  const migrateBeforeDrop = runner.indexOf("await migrateLegacyIntegrationCredentials(connection)");
  const dropColumn = runner.indexOf("await connection.query(statement)", migrateBeforeDrop);
  assert.ok(migrateBeforeDrop >= 0 && dropColumn > migrateBeforeDrop);
  assert.match(runner, /A backup encryption key is required to migrate legacy integration credentials/);
  assert.match(helper, /encrypt\(JSON\.stringify\(credentials\)\)/);
  assert.match(helper, /integration:\$\{row\.id\}/);
  assert.match(helper, /ON DUPLICATE KEY UPDATE encrypted_value/);
  assert.match(helper, /Legacy integration credentials are invalid; migration stopped without dropping the source column/);
});

test("schema contains the integration boundary tables", async () => {
  const sql = await read("sql/002_integrations.sql");
  for (const table of ["integration_connections", "external_orders", "integration_events", "delivery_assignments"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /uq_external_order_provider_id/);
});

test("public menu responses use an allowlisted flat shape", async () => {
  const menu = await read("src/public-menu.js");
  const platform = await read("src/routes/platform.js");
  const tables = await read("src/routes/tables.js");
  const qrPage = await readFrontend("pages/qr-code-final/app.js");
  const apiClient = await readFrontend("shared/api/client.js");
  assert.match(menu, /business_id: business\.id/);
  assert.match(menu, /products: categories\.flatMap/);
  assert.match(menu, /gradient_start:/);
  assert.match(menu, /selected_categories: selectedCategories/);
  assert.match(menu, /delivery_fee: deliveryFee\(settings\)/);
  assert.doesNotMatch(menu, /\.\.\.settings/);
  assert.match(platform, /return createPublicMenu\(businesses\[0\], menuCategories\)/);
  assert.match(tables, /return createPublicMenu\(/);
  assert.match(qrPage, /sourceCategories\.flatMap/);
  assert.match(qrPage, /sessionStorage\.setItem\(idempotencyStorageKey/);
  assert.match(apiClient, /idempotency_key: idempotencyKey/);
});

test("schema contains inventory and recipe tables", async () => {
  const sql = await read("sql/003_inventory.sql");
  for (const table of ["inventory_items", "product_ingredients", "inventory_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /uq_inventory_order_item/);
});

test("schema contains operational management tables", async () => {
  const sql = await read("sql/004_operations.sql");
  for (const table of ["cash_register_sessions", "customers", "suppliers", "discounts", "loyalty_accounts"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("frontend contains a kitchen display workflow", async () => {
  const page = await readFrontend("pages/app/kitchen/index.html");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(page, /Kitchen display/);
  assert.match(app, /update_status/);
  assert.match(app, /preparing/);
});

test("frontend contains customer and supplier management", async () => {
  const page = await readFrontend("pages/app/contacts/index.html");
  const app = await readFrontend("pages/app/contacts/app.js");
  assert.match(page, /Customers, suppliers and loyalty/);
  assert.match(app, /\/customers/);
  assert.match(app, /\/suppliers/);
  assert.match(page, /discountForm/);
  assert.match(page, /loyaltyForm/);
  assert.match(app, /loyalty\/\$\{action\}/);
});

test("product detail panel validates image URL schemes before rendering", async () => {
  const panel = await readFrontend("pages/app/products/id-product/index.js");
  const utils = await readFrontend("shared/utils/utils.js");
  assert.match(panel, /safeImageUrl\(product\.image\)/);
  assert.doesNotMatch(panel, /src="\$\{escapeHtml\(product\.image\)\}"/);
  assert.match(utils, /data:image\\\/(?:png|jpeg|webp|gif);base64/);
  assert.doesNotMatch(utils, /\["http:", "https:", "data:"\]/);
});

test("backend registers discount and loyalty routes", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/customer-value.js");
  assert.match(server, /register\(customerValueRoutes\)/);
  assert.match(routes, /discounts\/preview/);
  assert.match(routes, /loyalty\/redeem/);
});

test("profitability report aggregates revenue separately from recipe costs", async () => {
  const reports = await read("src/routes/reports.js");
  assert.match(reports, /SELECT \(SELECT COALESCE\(SUM\(total\), 0\) FROM orders WHERE business_id = \?/);
  assert.match(reports, /SELECT COALESCE\(SUM\(oi\.quantity \* pi\.quantity \* ii\.cost_per_unit\), 0\)/);
  assert.match(reports, /oi\.total \/ o\.subtotal \* o\.discount_amount/);
  assert.match(reports, /status = 'completed'/);
  assert.doesNotMatch(reports, /SUM\(o\.total\).*JOIN order_items/);
});

test("frontend contains a courier mobile workflow", async () => {
  const page = await readFrontend("pages/courier/index.html");
  const app = await readFrontend("pages/courier/app.js");
  assert.match(page, /Minhas entregas/);
  assert.match(app, /X-Courier-Token/);
  assert.match(app, /courier\/deliveries/);
  assert.match(page, /manifest\.webmanifest/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(app, /courier\/location/);
});

test("LAN proxy exposes only the courier endpoints required by the mobile workflow", async () => {
  const launcher = await readRoot("desktop/launcher.mjs");
  assert.match(launcher, /request\.method === "GET" && target\.pathname === "\/api\/v1\/courier\/deliveries"/);
  assert.ok(launcher.includes('request.method === "PATCH" && new RegExp(`^/api/v1/courier/deliveries/${publicBusinessIdPattern}$`, "i").test(target.pathname)'));
  assert.match(launcher, /request\.method === "POST" && target\.pathname === "\/api\/v1\/courier\/location"/);
  assert.match(launcher, /const maxBodySize = publicOrder \? 64 \* 1024 : 16 \* 1024/);
  assert.match(launcher, /\["picked_up", "delivered", "failed"\]/);
  assert.match(launcher, /headers\["X-Courier-Token"\] = courierToken/);
  assert.match(launcher, /const requestLimit = publicOrder \|\| courierWrite \? 60 : 120/);
  assert.match(launcher, /allowPublicRequest\(request, requestLimit\)/);
  assert.match(launcher, /upstream\.setTimeout\(30_000/);
  assert.match(launcher, /frontend\.headersTimeout = 15_000/);
  assert.match(launcher, /frontend\.requestTimeout = 30_000/);
  assert.ok(launcher.indexOf("allowPublicRequest(request, requestLimit)") < launcher.indexOf("for await (const chunk of request)"));
  assert.match(launcher, /Too many public reads from this address/);
});

test("courier service worker never caches authenticated or API responses and removes legacy caches", async () => {
  const serviceWorker = await readFrontend("pages/courier/sw.js");
  assert.match(serviceWorker, /food-system-courier-v2/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /request\.headers\.has\("X-Courier-Token"\)/);
  assert.match(serviceWorker, /request\.headers\.has\("Authorization"\)/);
  assert.match(serviceWorker, /name\.startsWith\("food-system-courier-"\).*caches\.delete\(name\)/);
});

test("Tauri navigation uses paths relative to frontendDist", async () => {
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  const entry = await readFrontend("entry/entry.js");
  const navigation = await readFrontend("shared/utils/navigation.js");
  assert.equal(config.build.frontendDist, "../frontend");
  assert.match(entry, /const DEFAULT_TARGET = "\/pages\/app\/dashboard\/index\.html"/);
  assert.match(navigation, /const LOADING_PAGE = "\/index\.html"/);
  assert.match(navigation, /replace\(\/\^frontend/);
});

test("Tauri grants only the main window close permission required by the UI", async () => {
  const capability = JSON.parse(await readRoot("src-tauri/capabilities/default.json"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.permissions, ["core:window:allow-close"]);
});

test("development local access is limited to the loopback frontend origin", async () => {
  const client = await readFrontend("shared/api/client.js");
  const config = await readRoot("src-tauri/tauri.conf.json");
  assert.match(client, /\["localhost", "127\.0\.0\.1"\]\.includes\(window\.location\.hostname\)/);
  assert.match(client, /window\.location\.port === "4173"/);
  assert.match(config, /"devUrl": "http:\/\/127\.0\.0\.1:4173"/);
});

test("public API requests do not attach saved or Tauri administrator credentials", async () => {
  const client = await readFrontend("shared/api/client.js");
  assert.match(client, /const needsAuthentication = auth !== false/);
  assert.match(client, /if \(needsAuthentication\) \{\s+try \{\s+localAccessToken = await window\.__TAURI__/);
  assert.match(client, /const developmentLocalMode = needsAuthentication &&/);
  assert.match(client, /if \(needsAuthentication\) \{\s+const storedSession = JSON\.parse\(localStorage\.getItem/);
  assert.match(client, /if \(storedSession\?\.token\) headers\.Authorization/);
  assert.match(client, /credentials: needsAuthentication \? "same-origin" : "omit"/);
});

test("Tauri development launcher is supervised and receives its parent PID", async () => {
  const launcher = await readRoot("desktop/start-local.mjs");
  const backendLauncher = await readRoot("desktop/launcher.mjs");
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  assert.equal(config.build.beforeDevCommand.cwd, "../");
  assert.equal(config.build.beforeDevCommand.script, "node desktop/start-local.mjs");
  assert.equal(config.build.beforeDevCommand.wait, false);
  assert.match(launcher, /FOOD_SYSTEM_PARENT_PID: String\(process\.pid\)/);
  assert.match(launcher, /process\.env\.APPDATA \|\| process\.env\.LOCALAPPDATA/);
  assert.match(launcher, /FoodSystemLocal.*development/);
  assert.match(launcher, /NODE_ENV: "development"/);
  assert.match(backendLauncher, /NODE_ENV: process\.env\.NODE_ENV \|\| "production"/);
  assert.match(backendLauncher, /const localAccessToken = nodeEnvironment === "development"\s+\? ""/);
  assert.match(backendLauncher, /FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: localAccessToken/);
  assert.match(launcher, /FOOD_SYSTEM_DATA_DIR: dataDir/);
  assert.match(launcher, /FOOD_SYSTEM_SECRET_KEY: secretKey/);
  assert.match(launcher, /flag: "wx"/);
  assert.match(launcher, /stdio: "inherit"/);
  assert.doesNotMatch(launcher, /detached: true|child\.unref\(\)/);
});

test("packaged backend runtime requires Node.js 24 LTS", async () => {
  const prepareRuntime = await readRoot("desktop/prepare-runtime.ps1");
  const bootstrap = await readRoot("src-tauri/src/lib.rs");
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  assert.match(prepareRuntime, /node\.exe/);
  assert.match(prepareRuntime, /Major.*-ne 24/);
  assert.match(prepareRuntime, /Node\.js 24 LTS is required/);
  assert.match(bootstrap, /if !bundled_node\.is_file\(\)/);
  assert.doesNotMatch(bootstrap, /PathBuf::from\("node\.exe"\)/);
  assert.equal(config.build.beforeBuildCommand.cwd, "../");
  assert.match(config.build.beforeBuildCommand.script, /desktop\/prepare-runtime\.ps1/);
  assert.ok(config.bundle.resources.includes("../desktop"));
  assert.match(prepareRuntime, /Join-Path \$PSScriptRoot "runtime\\node\.exe"/);
});

test("desktop startup stores the launcher child and creates a private encryption key", async () => {
  const bootstrap = await readRoot("src-tauri/src/lib.rs");
  const launcher = await readRoot("desktop/launcher.mjs");
  const server = await read("src/server.js");
  assert.match(bootstrap, /struct BackendProcess\(Mutex<Option<Child>>\)/);
  assert.match(bootstrap, /create_new\(true\)/);
  assert.match(bootstrap, /options\.mode\(0o600\)/);
  assert.match(bootstrap, /file\.sync_all\(\)/);
  assert.match(bootstrap, /WindowEvent::CloseRequested/);
  assert.match(bootstrap, /RunEvent::Exit/);
  assert.match(bootstrap, /Stdio::piped\(\)/);
  assert.match(bootstrap, /write_all\(b"\{\\"type\\":\\"shutdown\\"\}\\n"\)/);
  assert.match(bootstrap, /child\.wait\(\)/);
  assert.match(bootstrap, /fs::hard_link\(&temp_path, secret_path\)/);
  assert.match(bootstrap, /ErrorKind::AlreadyExists/);
  assert.match(launcher, /FOOD_SYSTEM_PARENT_PID/);
  assert.match(launcher, /local encryption key is missing or invalid/);
  assert.match(launcher, /MariaDB is unavailable/);
  assert.match(launcher, /MariaDB did not accept connections within 5 seconds/);
  assert.match(launcher, /console\.error\("Food System database migration failed:/);
  assert.match(launcher, /console\.error\("Food System could not start its API:/);
  assert.match(launcher, /console\.error\("Food System could not start its frontend:/);
  assert.match(launcher, /shutdown\(\);\s+process\.exitCode = 1;/);
  assert.match(launcher, /stdio: \["ignore", "inherit", "inherit", "ipc"\]/);
  assert.match(launcher, /FOOD_SYSTEM_TAURI_CONTROL/);
  assert.match(launcher, /process\.stdin\.on\("data"/);
  assert.match(launcher, /backend\.send\(\{ type: "shutdown" \}/);
  assert.match(launcher, /const stopStartedDatabaseGracefully = async/);
  assert.doesNotMatch(launcher, /migrationAbort/);
  assert.match(launcher, /backendRestoreInProgress/);
  assert.match(launcher, /message\?\.type === "restore-start"/);
  assert.match(launcher, /message\?\.type === "restore-end"/);
  assert.match(launcher, /message\?\.type === "restore-recovery-required"/);
  assert.match(launcher, /backendRestoreInProgress \|\| existsSync\(recoveryMarker\)/);
  assert.match(launcher, /database restore is still active or requires recovery; leaving MariaDB running/);
  assert.doesNotMatch(launcher, /backend\.kill\(/);
  assert.match(launcher, /mariadb-admin\.exe/);
  assert.doesNotMatch(launcher, /startedDatabase\.kill\(/);
  assert.match(launcher, /startedDatabase\.unref\(\)/);
  assert.match(server, /message\?\.type === "shutdown"/);
  assert.match(server, /import \{ checkDatabase, pool \} from "\.\/db\.js"/);
  assert.match(server, /await app\.close\(\)/);
  assert.match(server, /await pool\.end\(\)/);
  assert.match(server, /process\.disconnect\(\)/);
  assert.match(bootstrap, /Duration::from_secs\(450\)/);
});

test("Tauri development shutdown asks the supervised launcher to clean up", async () => {
  const startLocal = await readRoot("desktop/start-local.mjs");
  const launcher = await readRoot("desktop/launcher.mjs");
  assert.match(startLocal, /FOOD_SYSTEM_TAURI_CONTROL: "1"/);
  assert.match(startLocal, /stdio: \["pipe", "inherit", "inherit"\]/);
  assert.match(startLocal, /child\.stdin\.write\('\{"type":"shutdown"\}\\n'\)/);
  assert.doesNotMatch(startLocal, /const stopLauncher = \(\) => \{\s*if \(!child\.killed[^]*?child\.kill\(\);\s*\};/);
  assert.match(startLocal, /450_000/);
  assert.match(launcher, /if \(JSON\.parse\(line\)\?\.type === "shutdown"\) void shutdown\(\)/);
});

test("Tauri does not bundle an unused shell plugin", async () => {
  const manifest = await readRoot("src-tauri/Cargo.toml");
  const lockfile = await readRoot("src-tauri/Cargo.lock");
  const bootstrap = await readRoot("src-tauri/src/lib.rs");
  assert.doesNotMatch(manifest, /tauri-plugin-shell/);
  assert.doesNotMatch(lockfile, /tauri-plugin-shell/);
  assert.doesNotMatch(bootstrap, /tauri_plugin_shell/);
  assert.match(bootstrap, /generate_handler!\[app_info, local_access_token, public_menu_base_url\]/);
});

test("MariaDB provisioning protects its config file before writing credentials", async () => {
  const provision = await readRoot("desktop/provision-mariadb.ps1");
  assert.ok(provision.indexOf('WriteAllText($configTempPath, ""') < provision.indexOf("Set-Acl -LiteralPath $configTempPath") && provision.indexOf("Set-Acl -LiteralPath $configTempPath") < provision.indexOf("WriteAllText($configTempPath, $configContent"));
  assert.ok(provision.indexOf("WriteAllText($configTempPath, $configContent") < provision.indexOf("[System.IO.File]::Replace($configTempPath, $ConfigPath, $null)"));
  assert.match(provision, /Set-Acl -LiteralPath \$ConfigPath -AclObject \$acl/);
  assert.match(provision, /ReadAllLines\(\$ConfigPath\)/);
  assert.match(provision, /foreach \(\$key in \$managedConfigKeys\)/);
  assert.match(provision, /MYSQL_MAINTENANCE_PASSWORD/);
  assert.match(provision, /LocalSystemSid/);
  assert.match(provision, /rootPlainPassword/);
  assert.doesNotMatch(provision, /\$rootPassword = \[Runtime/);
  assert.ok(provision.indexOf("DROP USER IF EXISTS") < provision.indexOf("CREATE USER '") && provision.indexOf("CREATE USER '") < provision.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON"));
  assert.match(provision, /GRANT SELECT, INSERT, UPDATE, DELETE ON ``\$Database``\.\* TO '\$AppUser'@'\$HostName'/);
  assert.match(provision, /GRANT ALL PRIVILEGES ON ``\$Database``\.\* TO '\$MaintenanceUser'@'\$HostName'/);
  assert.match(provision, /GRANT SHUTDOWN ON \*\.\* TO '\$MaintenanceUser'@'\$HostName'/);
  assert.match(provision, /MYSQL_MAINTENANCE_USER=\$MaintenanceUser/);
  assert.match(provision, /MYSQL_MAINTENANCE_PASSWORD=\$maintenancePassword/);
});

test("Tauri build preparation installs backend production dependencies before bundling", async () => {
  const prepare = await readRoot("desktop/prepare-runtime.ps1");
  const tauriConfig = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  const packageJson = JSON.parse(await readRoot("package.json"));
  assert.match(prepare, /Get-Command npm\.cmd/);
  assert.match(prepare, /--prefix \$backend ci --omit=dev/);
  assert.match(prepare, /Could not install the backend production dependencies/);
  assert.match(tauriConfig.build.beforeBuildCommand.script, /prepare-runtime\.ps1/);
  assert.equal(packageJson.scripts["desktop:build"], "tauri build");
  assert.match(packageJson.scripts["desktop:dev"], /npm ci --prefix backend && tauri dev/);
});

test("Tauri resources preserve the paths used by the packaged launcher", async () => {
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  const bootstrap = await readRoot("src-tauri/src/lib.rs");
  const launcher = await readRoot("desktop/launcher.mjs");
  assert.deepEqual(config.bundle.resources, {
    "../backend/": "backend/",
    "../desktop/": "desktop/",
    "../frontend/": "frontend/",
  });
  assert.match(bootstrap, /resource_dir\.join\("desktop"\)\.join\("launcher\.mjs"\)/);
  assert.match(bootstrap, /resource_dir\.join\("desktop"\)\.join\("runtime"\)\.join\("node\.exe"\)/);
  assert.match(launcher, /const frontendRoot = join\(root, "frontend"\)/);
  assert.match(launcher, /const backendRoot = join\(root, "backend"\)/);
});

test("runtime and maintenance database credentials use separate grants", async () => {
  const config = await read("src/config.js");
  const db = await read("src/db.js");
  const migrate = await read("src/migrate.js");
  const backup = await read("src/backup.js");
  const restore = await read("src/restore.js");
  assert.match(config, /mysqlMaintenance:/);
  assert.match(db, /export const pool = createPool\(config\.mysql\)/);
  assert.match(db, /export const getMaintenancePool = \(\) =>/);
  assert.match(db, /maintenancePool \?\?= createPool\(config\.mysqlMaintenance\)/);
  assert.match(migrate, /getMaintenancePool\(\)/);
  assert.match(migrate, /maintenancePool\.getConnection\(\)/);
  assert.match(backup, /config\.mysqlMaintenance/);
  assert.match(restore, /config\.mysqlMaintenance/);
});

test("orders persist and apply discount totals", async () => {
  const sql = await read("sql/007_order_discounts.sql");
  const routes = await read("src/routes/orders.js");
  assert.match(sql, /discount_amount/);
  assert.match(routes, /Invalid or expired discount code/);
  assert.match(routes, /discountCode/);
});

test("authentication bounds expensive credential inputs and preserves active rate limits", async () => {
  const auth = await read("src/routes/auth.js");
  const server = await read("src/server.js");
  assert.match(auth, /MAX_PASSWORD_BYTES = 1024/);
  assert.match(auth, /Buffer\.byteLength\(password, "utf8"\) > MAX_PASSWORD_BYTES/);
  assert.match(auth, /email\.length > 254/);
  assert.match(server, /authAttempts\.size >= 10000/);
  assert.doesNotMatch(server, /authAttempts\.clear\(\)/);
});

test("cash register opening uses a connection-scoped business lock", async () => {
  const routes = await read("src/routes/operations.js");
  const cash = await read("src/routes/cash.js");
  const orders = await read("src/routes/orders.js");
  assert.match(routes, /SELECT GET_LOCK\(\?, 10\) AS acquired/);
  assert.match(routes, /SELECT RELEASE_LOCK\(\?\)/);
  assert.match(routes, /food-system-cash:/);
  assert.match(routes, /LIMIT 1 FOR UPDATE/);
  assert.match(cash, /status = 'open'.*LIMIT 1 FOR UPDATE/);
  assert.match(orders, /status = 'open'.*LIMIT 1 FOR UPDATE/);
});

test("catalog updates validate tenant-owned relations and database field bounds", async () => {
  const routes = await read("src/routes/catalog.js");
  assert.match(routes, /categories WHERE id = \? AND business_id = \?/);
  assert.match(routes, /kitchen_stations WHERE id = \? AND business_id = \?/);
  assert.match(routes, /Buffer\.byteLength\(value, "utf8"\) <= maxBytes/);
  assert.match(routes, /MAX_IMAGE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(routes, /price > 99999999\.99/);
  assert.match(routes, /product\.image_url !== undefined \? product\.image_url : product\.image/);
  assert.match(routes, /business_id = p\.business_id/);
  assert.match(routes, /SELECT \* FROM products WHERE id = \? AND business_id = \?/);
});

test("backend request and product-image limits match the MEDIUMTEXT image column", async () => {
  const server = await read("src/server.js");
  const createSchema = await read("sql/001_initial.sql");
  const migration = await read("sql/019_product_images.sql");
  assert.match(server, /bodyLimit: 5 \* 1024 \* 1024/);
  assert.match(createSchema, /image_url MEDIUMTEXT NULL/);
  assert.match(migration, /MODIFY COLUMN image_url MEDIUMTEXT NULL/);
});

test("dining tab creation serializes concurrent opens by locking the table row", async () => {
  const routes = await read("src/routes/dining-tabs.js");
  assert.match(routes, /restaurant_tables WHERE id = \? AND business_id = \? AND active = TRUE LIMIT 1 FOR UPDATE/);
});

test("delivery assignment serializes by locking the order and commits assignment atomically", async () => {
  const routes = await read("src/routes/delivery.js");
  assert.match(routes, /orders WHERE id = \? AND business_id = \? AND delivery_address IS NOT NULL FOR UPDATE/);
  assert.match(routes, /await connection\.beginTransaction\(\)/);
  assert.match(routes, /await connection\.commit\(\)/);
});

test("public order creation bounds work and DECIMAL totals", async () => {
  const routes = await read("src/routes/orders.js");
  assert.match(routes, /MAX_ORDER_ITEMS = 100/);
  assert.match(routes, /MAX_PAYMENT_ALLOCATIONS = 20/);
  assert.match(routes, /const validId = \(value\) => typeof value === "string"/);
  assert.match(routes, /const validTableToken = \(value\) => typeof value === "string"/);
  assert.match(routes, /total > MAX_ORDER_AMOUNT/);
  assert.match(routes, /subtotal > MAX_ORDER_AMOUNT/);
});

test("reports backend is registered", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/reports.js");
  assert.match(server, /register\(reportRoutes\)/);
  assert.match(routes, /reports\/sales/);
  assert.match(routes, /critical-stock/);
});

test("reports frontend exists", async () => {
  const page = await readFrontend("pages/app/reports/index.html");
  const app = await readFrontend("pages/app/reports/app.js");
  assert.match(page, /Reports/);
  assert.match(app, /reports\/sales/);
});

test("backup routes validate safe backup names", async () => {
  const routes = await read("src/routes/backups.js");
  const page = await readFrontend("pages/app/backups/index.html");
  assert.match(routes, /isSafeBackupName/);
  assert.match(routes, /Restore failed/);
  assert.match(page, /Create backup/);
});

test("concurrent backups use unique names and publish only completed encrypted files", async () => {
  const backup = await read("src/backup.js");
  assert.match(backup, /const backupName = process\.argv\[2\] \|\| createBackupName\(\)/);
  assert.match(backup, /if \(!isSafeBackupName\(backupName\)\)/);
  assert.match(backup, /await encryptFile\(plainOutput, temporaryOutput\)/);
  assert.match(backup, /dumpInfo\.size === 0/);
  assert.ok(backup.indexOf("await rename(temporaryOutput, output)") > backup.indexOf("await encryptFile"));
  assert.match(backup, /rm\(temporaryOutput, \{ force: true \}\)/);
});

test("desktop startup cleans only stale recognized plaintext backup files", async () => {
  const launcher = await readRoot("desktop/launcher.mjs");
  const cleanup = await readRoot("desktop/cleanup-backups.mjs");
  assert.match(launcher, /removeStalePlaintextBackups\(backupDir\)/);
  assert.match(cleanup, /DEFAULT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(cleanup, /isSafeBackupName\(`\$\{entry\.name\}\.enc`\)/);
  assert.match(cleanup, /RESTORE_TEMP_PATTERN/);
  assert.match(cleanup, /if \(!entry\.isFile\(\)\) continue/);
  assert.match(cleanup, /now - info\.mtimeMs <= maxAgeMs/);
});

test("restore enters API maintenance and uses an exclusive plaintext file", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/backups.js");
  const restore = await read("src/restore.js");
  const backup = await read("src/backup.js");
  const maintenance = await read("src/maintenance.js");
  const launcher = await readRoot("desktop/launcher.mjs");
  assert.match(server, /if \(!enterRequest\(\)\) return reply\.serviceUnavailable/);
  assert.match(server, /if \(!request\.maintenanceRequest\) return/);
  assert.match(server, /app\.addHook\("onRequestAbort"/);
  assert.match(routes, /if \(!\(await beginRestore\(\)\)\) return reply\.conflict/);
  assert.match(routes, /if \(!keepMaintenance\) endRestore\(\)/);
  assert.match(routes, /\.restore-\$\{process\.pid\}-\$\{randomUUID\(\)\}\.sql/);
  assert.match(routes, /plaintextInfo\.size === 0/);
  assert.match(routes, /await decryptFile\(file, plaintextFile\)/);
  assert.match(routes, /safetyBackupName = createBackupName\(\)/);
  assert.match(routes, /\["src\/backup\.js", safetyBackupName\]/);
  assert.doesNotMatch(routes, /backupLine|Backup criado:/);
  assert.doesNotMatch(routes, /timeout:\s*120000/);
  assert.ok(routes.indexOf('["src/backup.js", safetyBackupName]') < routes.indexOf('runRestore(plaintextFile)'));
  assert.match(restore, /const timeout = setTimeout\(\(\) =>/);
  assert.match(restore, /child\.kill\(\)/);
  assert.match(restore, /Promise\.allSettled\(/);
  assert.match(restore, /await closePromise\.catch/);
  assert.match(restore, /"--execute", "SELECT 1"/);
  assert.match(restore, /Food System restore importer started/);
  assert.match(restore, /process\.send\(\{ type: "restore-import-started" \}\)/);
  assert.match(routes, /if \(!restoreImportStarted\) throw restoreError/);
  assert.match(backup, /timeout: 120000/);
  assert.match(routes, /restore-recovery-required/);
  assert.match(routes, /path\.join\(path\.dirname\(backupDir\), "restore-recovery-required"\)/);
  assert.match(routes, /safety_backup: safetyBackupName/);
  assert.match(routes, /flag: "wx"/);
  assert.doesNotMatch(routes, /flag: "w"/);
  assert.match(routes, /notifyLauncher\("restore-start"\)/);
  assert.match(routes, /notifyLauncher\("restore-end"\)/);
  assert.match(routes, /notifyLauncher\(keepMaintenance \? "restore-recovery-required" : "restore-end"\)/);
  assert.match(routes, /const runRestore = \(file\) =>/);
  assert.match(routes, /fork\("src\/restore\.js"/);
  assert.match(routes, /restore-import-started/);
  assert.match(routes, /restoreImportStarted \|\| restoreSucceeded \|\| recoverySucceeded/);
  assert.match(launcher, /const backupDir = join\(dataDir, "backups"\)/);
  assert.match(launcher, /existsSync\(recoveryMarker\)/);
  assert.match(launcher, /startup is blocked until the database and safety backup are checked/);
  assert.match(routes, /safety_backup_created: true/);
  assert.match(maintenance, /activeRequests > 1/);
  assert.match(maintenance, /if \(restoreInProgress\) return false/);
});

test("inventory frontend exposes movement and recipe workflows", async () => {
  const page = await readFrontend("pages/app/inventory/index.html");
  const app = await readFrontend("pages/app/inventory/app.js");
  assert.match(page, /Stock movement/);
  assert.match(page, /Product recipe/);
  assert.match(app, /inventory\/items/);
  assert.match(app, /\/recipe/);
});

test("order printing is available in backend and kitchen frontend", async () => {
  const routes = await read("src/routes/orders.js");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(routes, /orders\/:id\/print/);
  assert.match(app, /data-print-order/);
  assert.match(app, /window\.print/);
  const worker = await read("src/print-worker.js");
  assert.match(worker, /print_jobs/);
  assert.match(worker, /attempts >= 3/);
});

test("cashier frontend exposes register session controls", async () => {
  const page = await readFrontend("pages/app/cashier/index.html");
  const app = await readFrontend("pages/app/cashier/app.js");
  assert.match(page, /cashRegisterForm/);
  assert.match(app, /openCashRegister/);
  assert.match(app, /closeCashRegister/);
});

test("cashier frontend exposes supply and withdrawal controls", async () => {
  const page = await readFrontend("pages/app/cashier/index.html");
  const app = await readFrontend("pages/app/cashier/app.js");
  assert.match(page, /movementForm/);
  assert.match(page, /withdrawal/);
  assert.match(app, /createCashMovement/);
});

test("cashier recognizes QR counter payments across locales and legacy labels", async () => {
  const auth = await readFrontend("shared/auth/auth.js");
  const qrMenu = await readFrontend("pages/qr-code-final/app.js");
  assert.match(auth, /\(\?:Pagamento\|Payment\)/);
  assert.match(auth, /\["dinheiro no balcao", "dinheiro_balcao"\]/);
  assert.match(auth, /\["cash at counter", "dinheiro_balcao"\]/);
  assert.match(qrMenu, /translate\("Pagamento: "\)\}\$\{paymentMethod\}/);
});

test("backend registers the required route groups", async () => {
  const server = await read("src/server.js");
  for (const route of ["authRoutes", "catalogRoutes", "tableRoutes", "diningTabRoutes", "orderRoutes", "cashRoutes", "integrationRoutes", "inventoryRoutes", "operationsRoutes", "kitchenRoutes"]) assert.match(server, new RegExp(`register\\(${route}\\)`));
});

test("dining tabs provide advanced table service controls", async () => {
  const routes = await read("src/routes/dining-tabs.js");
  const page = await readFrontend("pages/app/tables/index.html");
  const app = await readFrontend("pages/app/tables/app.js");
  assert.match(routes, /dining-tabs/);
  assert.match(routes, /transfer/);
  assert.match(routes, /close/);
  assert.match(page, /Tables and tabs/);
  assert.match(app, /openDiningTab/);
});

test("fiscal workflow is explicit and refuses unconfigured issuance", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/fiscal.js");
  const page = await readFrontend("pages/app/fiscal/index.html");
  assert.match(server, /register\(fiscalRoutes\)/);
  assert.match(routes, /FISCAL_PROVIDER_URL/);
  assert.match(routes, /certificate credentials/);
  assert.match(routes, /Fiscal provider must use HTTPS/);
  assert.match(routes, /resolvePublicHttpsAddress/);
  assert.match(routes, /resolvedAddress\.address, resolvedAddress\.family/);
  assert.match(routes, /target\.port && target\.port !== "443"/);
  assert.match(routes, /client_cert/);
  assert.match(routes, /client_key/);
  assert.match(page, /Fiscal documents/);
});

test("legacy screens expose a persistent language control", async () => {
  for (const pageName of ["dashboard", "cashier", "orders", "products", "menu", "team", "user-edit"]) {
    const page = await readFrontend(`pages/app/${pageName}/index.html`);
    assert.match(page, /data-global-language/);
    assert.match(page, /legacy-control\.js/);
  }
});

test("integration routes expose connection and event boundaries", async () => {
  const routes = await read("src/routes/integrations.js");
  assert.match(routes, /app\.post\("\/api\/v1\/businesses\/:businessId\/integrations"/);
  assert.match(routes, /integrations\/:id\/events", async \(request, reply\) => \{\s+if \(request\.headers\.authorization\) \{\s+if \(\!\(await requireRole\(request, reply\)\)\) return/);
  assert.match(routes, /external-orders/);
  assert.match(routes, /order\.received/);
  assert.match(routes, /external_order_id/);
  assert.match(routes, /secure storage is configured/);
  assert.match(routes, /const linkedOrderId = orderId \|\| externalOrders\[0\]\.order_id \|\| null/);
  assert.match(routes, /SELECT id, status FROM orders WHERE id = \? AND business_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(routes, /if \(linkedOrderId && status\)/);
  assert.match(routes, /Unsupported integration event type/);
  assert.match(routes, /external_order_id must contain 1 to 190 characters/);
  assert.match(routes, /MAX_INTEGRATION_SETTINGS_BYTES = 32 \* 1024/);
  assert.match(routes, /MAX_INTEGRATION_EVENT_BYTES = 256 \* 1024/);
  assert.match(routes, /Integration event payload must be an object no larger than 256 KB/);
  assert.match(routes, /Integration settings must be an object no larger than 32 KB/);
  assert.match(routes, /Credentials exceed the 32 KB storage limit/);
  assert.match(routes, /Webhook secrets must contain 16 to 512 characters/);
  assert.match(routes, /status: "processed", duplicate: true/);
});

test("frontend API maps Node response envelopes", async () => {
  const client = await readFrontend("shared/api/client.js");
  assert.match(client, /data\.orders \|\| \[\]/);
  assert.match(client, /data\.tables \|\| \[\]/);
  assert.match(client, /data\.movement \|\| data/);
});

test("local first-run provisions its business explicitly and retries after offline setup", async () => {
  const auth = await readFrontend("shared/auth/auth.js");
  const entry = await readFrontend("entry/entry.js");
  const client = await readFrontend("shared/api/client.js");
  const routes = await read("src/routes/auth.js");
  assert.match(auth, /if \(apiAvailable && LOCAL_MODE\)[\s\S]*await provisionLocalBusiness\(localName\)/);
  assert.match(entry, /await provisionLocalBusiness\(name\)/);
  assert.match(client, /apiRequest\("\/local\/business", \{ method: "PUT"/);
  assert.match(routes, /app\.put\("\/api\/v1\/local\/business"/);
  assert.match(routes, /INSERT INTO businesses .*ON DUPLICATE KEY UPDATE name = VALUES\(name\), description = VALUES\(description\)/);
  assert.doesNotMatch(routes, /ON DUPLICATE KEY UPDATE[^\n]*settings = VALUES\(settings\)/);
  assert.match(auth, /saveBusiness\(\{\s+id: localSession\.businessId/);
  assert.match(auth, /saveBusiness\(\{ id: business\.id, name: business\.name \}\)/);
});

test("Tauri local administrator cannot access another tenant business", async () => {
  const auth = await read("src/routes/auth.js");
  assert.match(auth, /LOCAL_BUSINESS_ID = "00000000-0000-4000-8000-000000000001"/);
  assert.match(auth, /businessId && businessId !== LOCAL_BUSINESS_ID/);
  assert.match(auth, /reply\.forbidden\("The local administrator can only access the local Food System business"\)/);
  assert.doesNotMatch(auth, /INSERT IGNORE INTO businesses/);
});

test("local authentication bypass is restricted to explicit or loopback development mode", async () => {
  const config = await read("src/config.js");
  const auth = await read("src/routes/auth.js");
  assert.match(config, /ALLOW_LOCAL_HEADER/);
  assert.match(config, /isLoopback\(host\)/);
  assert.match(config, /nodeEnv !== "production"/);
  assert.match(config, /production API must bind to a loopback address/);
  assert.match(auth, /config\.allowLocalHeader && !config\.localAccessToken/);
});

test("desktop update downloader enforces HTTPS, hash verification and atomic staging", async () => {
  const updater = await readRoot("desktop/download-update.mjs");
  const config = await read("src/config.js");
  const platform = await read("src/routes/platform.js");
  assert.match(updater, /parsed\.protocol !== "https:"/);
  assert.match(updater, /parsed\.username \|\| parsed\.password \|\| parsed\.hash/);
  assert.match(updater, /MAX_UPDATE_BYTES = 1024 \* 1024 \* 1024/);
  assert.match(updater, /downloadedBytes > MAX_UPDATE_BYTES/);
  assert.match(updater, /createHash\("sha256"\)/);
  assert.match(updater, /actual !== expected/);
  assert.match(updater, /verify\(null/);
  assert.match(updater, /rename\(temporary, output\)/);
  assert.match(config, /parsedUpdateUrl\.username \|\| parsedUpdateUrl\.password/);
  assert.doesNotMatch(platform, /public_key: config\.update|signature: config\.update|sha256: config\.update/);
});

test("production update configuration requires a valid asset hash and signature", async () => {
  const config = await read("src/config.js");
  assert.match(config, /UPDATE_SHA256/);
  assert.match(config, /\^\[a-f0-9\]\{64\}\$/i);
  assert.match(config, /UPDATE_SIGNATURE, and UPDATE_PUBLIC_KEY are required/);
});

test("team member removal serializes role checks and limits managers to staff", async () => {
  const platform = await read("src/routes/platform.js");
  const apiClient = await readFrontend("shared/api/client.js");
  const teamPage = await readFrontend("pages/app/team/app.js");
  assert.match(platform, /SELECT id FROM businesses WHERE id = \? FOR UPDATE/);
  assert.match(platform, /SELECT role FROM business_memberships WHERE id = \? AND business_id = \? FOR UPDATE/);
  assert.match(platform, /user\.role !== "owner" && members\[0\]\.role !== "staff"/);
  assert.match(platform, /return \{ members:/);
  assert.match(apiClient, /fetchTeamMembers = \(businessId\) =>\s+apiRequest\(`\/businesses\/\$\{businessId\}\/team`\)\.then\(\(data\) => data\.members \|\| \[\]\)/);
  assert.match(teamPage, /state\.members\.filter/);
  assert.match(platform, /email\.length > 190 \|\| name\.length < 2 \|\| name\.length > 160/);
  assert.match(platform, /if \(!\["owner", "manager", "staff"\]\.includes\(role\)\) return reply\.badRequest/);
});

test("loyalty point operations reject amounts outside the supported range", async () => {
  const routes = await read("src/routes/customer-value.js");
  assert.match(routes, /MAX_LOYALTY_POINTS_PER_OPERATION = 1_000_000/);
  assert.equal((routes.match(/points > MAX_LOYALTY_POINTS_PER_OPERATION/g) || []).length, 2);
});

test("inventory batch operations cap work and stay within database decimal ranges", async () => {
  const routes = await read("src/routes/inventory.js");
  const orders = await read("src/routes/orders.js");
  const catalog = await read("src/routes/catalog.js");
  const cash = await read("src/routes/cash.js");
  const operations = await read("src/routes/operations.js");
  const numbers = await read("src/numbers.js");
  assert.match(routes, /MAX_BATCH_ITEMS = 100/);
  assert.match(routes, /inputItems\.length > MAX_BATCH_ITEMS/);
  assert.match(routes, /ingredients\.length > MAX_BATCH_ITEMS/);
  assert.match(routes, /MAX_INVENTORY_QUANTITY = 999_999_999\.999/);
  assert.match(routes, /MAX_UNIT_COST = 99_999_999\.9999/);
  assert.match(routes, /MAX_MONEY = 9_999_999_999\.99/);
  assert.match(routes, /totalCost \+ lineTotal > MAX_MONEY/);
  assert.match(routes, /hasDecimalScale\(input\.quantity, 3\)/);
  assert.match(routes, /hasDecimalScale\(input\.unit_cost, 4\)/);
  assert.match(routes, /hasDecimalScale\(entry\.quantity, 3\)/);
  assert.match(orders, /hasDecimalScale\(item\.quantity, 2\)/);
  assert.match(orders, /\[\.\.\.requirements\]\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(orders, /const deliveryFee = deliveryAddress \? configuredDeliveryFee : 0/);
  assert.match(orders, /customer_name, delivery_address/);
  assert.match(orders, /businessSettings\?\.delivery_fee/);
  assert.match(orders, /validIdempotencyKey/);
  assert.match(orders, /A valid idempotency key is required/);
  assert.match(orders, /idempotency_hash/);
  assert.match(orders, /paidCents !== toMinorUnits\(total\)/);
  assert.match(catalog, /hasDecimalScale\(product\.price, 2\)/);
  assert.match(cash, /hasDecimalScale\(input\.amount, 2\)/);
  assert.match(operations, /hasDecimalScale\(value, 2\)/);
  assert.match(numbers, /Number\(number\.toFixed\(scale\)\) === number/);
});

test("order migration persists public customer names", async () => {
  const migration = await read("sql/021_order_customer_name.sql");
  const orders = await read("src/routes/orders.js");
  const businesses = await read("src/routes/businesses.js");
  const auth = await readFrontend("shared/auth/auth.js");
  assert.match(migration, /ALTER TABLE orders ADD COLUMN customer_name VARCHAR\(160\) NULL/);
  assert.match(orders, /customer_name: customerName \|\| null/);
  assert.match(businesses, /hasDecimalScale\(business\.settings\.delivery_fee, 2\)/);
  assert.doesNotMatch(auth, /customer_phone: "0000000000"/);
});

test("order migrations add a business-scoped idempotency key", async () => {
  const key = await read("sql/022_order_idempotency_key.sql");
  assert.match(key, /ADD COLUMN idempotency_key CHAR\(36\) NULL/);
  assert.match(key, /ADD COLUMN idempotency_hash CHAR\(64\) NULL/);
  assert.match(key, /UNIQUE KEY uq_orders_business_idempotency \(business_id, idempotency_key\)/);
});

test("courier location writes are throttled and retain only the latest position", async () => {
  const delivery = await read("src/routes/delivery.js");
  const migration = await read("sql/020_courier_latest_location.sql");
  const server = await read("src/server.js");
  assert.match(delivery, /const courierLocationWrites = new Map\(\)/);
  assert.match(delivery, /now - lastWrite < 5_000/);
  assert.match(delivery, /accuracy > 99_999_999\.99/);
  assert.match(delivery, /status IN \('assigned','picked_up'\) LIMIT 1 FOR UPDATE/);
  assert.match(delivery, /Location sharing is available only during an active delivery/);
  assert.match(delivery, /NOW\(\) - INTERVAL 15 MINUTE/);
  assert.match(delivery, /requireRole\(request, reply\)/);
  assert.match(delivery, /da\.updated_at >= NOW\(\) - INTERVAL 1 DAY/);
  assert.match(delivery, /Invalid courier delivery status transition/);
  assert.match(delivery, /Delivery status cannot move backwards or leave a terminal state/);
  assert.match(delivery, /DELETE FROM courier_locations WHERE courier_id = \?/);
  assert.match(delivery, /ON DUPLICATE KEY UPDATE business_id = VALUES\(business_id\)/);
  assert.match(server, /reply\.header\("Cache-Control", "no-store"\)/);
  assert.match(migration, /DELETE older\s+FROM courier_locations older\s+JOIN courier_locations newer/s);
  assert.match(migration, /ADD UNIQUE KEY uq_courier_locations_courier \(courier_id\)/);
});

test("outbound HTTPS probes cap response bytes and total duration", async () => {
  const outbound = await read("src/outbound-request.js");
  assert.match(outbound, /responseBytes > 1024 \* 1024/);
  assert.match(outbound, /setTimeout\(\(\) => request\.destroy\(new Error\("Outbound HTTPS request exceeded 10 seconds"\)\), 10_000\)/);
});

test("fiscal provider responses are bounded and have a total deadline", async () => {
  const fiscal = await read("src/routes/fiscal.js");
  assert.match(fiscal, /MAX_FISCAL_PAYLOAD_BYTES = 256 \* 1024/);
  assert.match(fiscal, /MAX_FISCAL_CREDENTIAL_BYTES = 32 \* 1024/);
  assert.match(fiscal, /Fiscal document payload must be an object no larger than 256 KB/);
  assert.match(fiscal, /Fiscal credentials exceed the 32 KB storage limit/);
  assert.match(fiscal, /responseBytes > 1024 \* 1024/);
  assert.match(fiscal, /Fiscal provider request exceeded 60 seconds/);
  assert.match(fiscal, /Object\.keys\(payload\)\.length === 0/);
  assert.match(fiscal, /reservation\.affectedRows !== 1/);
  assert.match(fiscal, /\["authorized", "issued"\]\.includes\(providerStatus\)/);
  assert.match(fiscal, /Provider outcome is unknown; reconcile with the provider before any retry/);
  assert.match(fiscal, /status = 'pending'\", \[provider\.label, request\.params\.id, request\.params\.businessId\]\)/);
  assert.match(fiscal, /target\.username \|\| target\.password/);
  assert.match(fiscal, /app\.get\("\/api\/v1\/businesses\/:businessId\/fiscal\/documents", async \(request, reply\) => \{\s+if \(!\(await requireRole\(request, reply\)\)\) return/);
});

test("customer and supplier fields are bounded before database writes", async () => {
  const operations = await read("src/routes/operations.js");
  assert.match(operations, /MAX_CONTACT_NOTES_BYTES = 16 \* 1024/);
  assert.match(operations, /optionalText\(body\.phone, 40\)/);
  assert.match(operations, /optionalText\(body\.email, 190\)/);
  assert.match(operations, /optionalText\(body\.tax_id, 30\)/);
  assert.match(operations, /Invalid email address/);
  assert.match(operations, /Buffer\.byteLength\(notes\.value, "utf8"\) > MAX_CONTACT_NOTES_BYTES/);
});

test("MariaDB hardening script restricts the local database to loopback", async () => {
  const script = await readRoot("desktop/harden-mariadb.ps1");
  const readme = await readRoot("README.md");
  assert.match(script, /bind-address=127\.0\.0\.1/);
  assert.match(script, /skip-name-resolve/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /\$serviceRootPattern = \[regex\]::Escape\(\$serviceRoot\)/);
  assert.match(script, /\$_.PathName -match \$serviceRootPattern/);
  assert.match(script, /Restart-Service/);
  assert.match(readme, /harden-mariadb\.ps1 -RestartService/);
  assert.match(readme, /SELECT @@bind_address/);
});

test("desktop MariaDB defaults to the LTS series and discovers the prior supported install", async () => {
  const launcher = await readRoot("desktop/launcher.mjs");
  const provision = await readRoot("desktop/provision-mariadb.ps1");
  const hardening = await readRoot("desktop/harden-mariadb.ps1");
  const backup = await read("src/backup.js");
  const restore = await read("src/restore.js");
  assert.match(launcher, /"C:\\\\Program Files\\\\MariaDB 11\.8", "C:\\\\Program Files\\\\MariaDB 13\.0"/);
  assert.match(launcher, /Install and start MariaDB 11\.8/);
  assert.match(provision, /MariaDB 11\.8/);
  assert.match(hardening, /MariaDB 11\.8/);
  assert.match(backup, /MariaDB 11\.8.*MariaDB 13\.0/s);
  assert.match(restore, /MariaDB 11\.8.*MariaDB 13\.0/s);
});
