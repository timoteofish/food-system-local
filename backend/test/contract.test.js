import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
const readFrontend = (file) => fs.readFile(new URL(`../../frontend/${file}`, import.meta.url), "utf8");
const readRoot = (file) => fs.readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("schema contains the operational tables", async () => {
  const sql = await read("sql/migrations/001_initial.sql");
  for (const table of ["users", "businesses", "categories", "products", "restaurant_tables", "orders", "order_items", "cash_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("SQLite is the only database engine and its schema is created locally", async () => {
  const db = await read("src/db.js");
  const migrationRunner = await read("src/migrate.js");
  const config = await read("src/config.js");
  const packageJson = JSON.parse(await read("package.json"));
  const schema = await read("sqlite/schema.sql");
  assert.match(db, /new DatabaseSync\(temporaryPath/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS app_schema_migrations/);
  assert.match(db, /sqlite_initial_schema/);
  assert.match(db, /new DatabaseSync\(databasePath/);
  assert.doesNotMatch(db, /mysql2|MYSQL_|createConnection|information_schema/i);
  assert.doesNotMatch(config, /mysql2|MYSQL_|MariaDB|mariadb/i);
  assert.ok(config.includes("tauri://localhost"));
  assert.equal(packageJson.dependencies.mysql2, undefined);
  assert.match(migrationRunner, /SQLite database ready/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS "orders"/);
  assert.doesNotMatch(migrationRunner, /information_schema|GET_LOCK|mysql|maria/i);
});

test("schema contains the integration boundary tables", async () => {
  const sql = await read("sql/migrations/002_integrations.sql");
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
  const sql = await read("sql/migrations/003_inventory.sql");
  for (const table of ["inventory_items", "product_ingredients", "inventory_movements"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /uq_inventory_order_item/);
});

test("schema contains operational management tables", async () => {
  const sql = await read("sql/migrations/004_operations.sql");
  for (const table of ["cash_register_sessions", "customers", "suppliers", "discounts", "loyalty_accounts"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});

test("frontend contains a kitchen display workflow", async () => {
  const page = await readFrontend("pages/app/kitchen/index.html");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(page, /Kitchen display/);
  assert.match(app, /update_status/);
  assert.match(app, /preparing/);
});

test("frontend removes the contacts page and navigation entry", async () => {
  const ui = await readFrontend("shared/ui/ui.js");
  const suppliersPage = await readFrontend("pages/app/suppliers/index.html");
  const app = await readFrontend("shared/features/contacts/index.js");
  assert.doesNotMatch(ui, /\["contacts",/);
  assert.doesNotMatch(suppliersPage, /contacts\/index\.html/);
  assert.doesNotMatch(app, /customerForm|customerList|customerSearch|endpoint: "customers"/);
  assert.match(app, /suppliers: \[/);
  assert.match(suppliersPage, /supplierForm/);
});

test("supplier and discount records are rendered from the shared contacts feature", async () => {
  const app = await readFrontend("shared/features/contacts/index.js");
  assert.match(app, /escapeHtml\(row\.name\)/);
  assert.match(app, /escapeHtml\(getDetails\(row\)\)/);
});

test("product detail panel validates image URL schemes before rendering", async () => {
  const panel = await readFrontend("pages/app/products/id-product/index.js");
  const utils = await readFrontend("shared/utils/utils.js");
  const profile = await readFrontend("shared/ui/ui.js");
  assert.match(panel, /safeImageUrl\(product\.image\)/);
  assert.doesNotMatch(panel, /src="\$\{escapeHtml\(product\.image\)\}"/);
  assert.match(profile, /safeClientAvatar = safeImageUrl\(business\.avatar\)/);
  assert.match(profile, /safeSessionAvatar = safeImageUrl\(session\?\.avatar\)/);
  assert.match(profile, /const safeAvatar = safeImageUrl\(business\.avatar\)/);
  assert.doesNotMatch(profile, /src="\$\{escapeHtml\(session\.avatar\)\}"/);
  assert.ok(utils.includes("data:image\\/"));
  assert.doesNotMatch(utils, /\["http:", "https:", "data:"\]/);
});

test("product and profile image inputs cap file size, formats and decoded dimensions", async () => {
  const productImage = await readFrontend("pages/app/products/image-user/index.js");
  const profile = await readFrontend("shared/ui/ui.js");
  const legacyProfile = await readFrontend("pages/app/user-edit/app.js");
  assert.match(productImage, /MAX_IMAGE_FILE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(productImage, /MAX_IMAGE_PIXELS = 40_000_000/);
  assert.match(productImage, /supportedImageTypes\.has\(file\.type\)/);
  assert.match(profile, /supportedTypes\.has\(file\.type\) \|\| file\.size > 8 \* 1024 \* 1024/);
  assert.match(profile, /image\.naturalWidth \* image\.naturalHeight > 40_000_000/);
  assert.match(legacyProfile, /image\.naturalWidth \* image\.naturalHeight > 40_000_000/);
});

test("order, product, and customer renderers escape stored text before HTML insertion", async () => {
  const orders = await readFrontend("pages/app/orders/app.js");
  const products = await readFrontend("pages/app/products/app.js");
  const contacts = await readFrontend("shared/features/contacts/index.js");
  assert.match(orders, /escapeHtml\(getCustomerName\(order\)\)/);
  assert.match(orders, /escapeHtml\(getOrderItemsLabel\(order\)\)/);
  assert.match(orders, /escapeHtml\(group\.location\)/);
  assert.match(products, /const productName = escapeHtml\(item\.name/);
  assert.match(products, /aria-label="\$\{statusAction\}: \$\{productName\}"/);
  assert.match(contacts, /escapeHtml\(row\.name\)/);
  assert.match(contacts, /escapeHtml\(getDetails\(row\)\)/);
});

test("inventory recipe labels escape stored names before interpolating into attributes", async () => {
  const inventory = await readFrontend("pages/app/inventory/app.js");
  assert.match(inventory, /escapeHtml\(translate\("removeRecipeIngredient"\)\.replace\("\$1", ingredient\.name\)\)/);
});

test("team labels and public menu empty state escape stored text in HTML contexts", async () => {
  const team = await readFrontend("pages/app/team/app.js");
  const publicMenu = await readFrontend("pages/qr-code-final/app.js");
  const products = await readFrontend("pages/app/products/app.js");
  const productPanel = await readFrontend("pages/app/products/id-product/index.js");
  assert.match(team, /aria-label="\$\{escapeHtml\(translate\("teamRoleLabel"\)\)\} \$\{name\}"/);
  assert.match(team, /aria-label="\$\{escapeHtml\(translate\("teamRemovePerson"\)\)\} \$\{name\}"/);
  assert.match(publicMenu, /\.replace\("\$1", escapeHtml\(selectedCategory\)\)/);
  assert.match(publicMenu, /\$\{escapeHtml\(translate\("to your order"\)\)\}/);
  assert.match(products, /const statusAction = escapeHtml\(translate\(/);
  assert.match(productPanel, /aria-label="\$\{escapeHtml\(translate\("Close"\)\)\}"/);
});

test("backend registers discount and loyalty routes", async () => {
  const server = await read("src/server.js");
  const inventory = await readFrontend("pages/app/inventory/app.js");
  const routes = await read("src/routes/customer-value.js");
  assert.match(server, /register\(customerValueRoutes\)/);
  assert.match(routes, /discounts\/preview/);
  assert.match(routes, /loyalty\/redeem/);
});

test("profitability report aggregates revenue separately from recipe costs", async () => {
  const reports = await read("src/routes/reports.js");
  assert.match(reports, /SELECT \(SELECT COALESCE\(SUM\(amount\), 0\) FROM cash_movements WHERE business_id = \? AND type = 'sale'/);
  assert.match(reports, /SELECT COALESCE\(SUM\(oi\.quantity \* pi\.quantity \* ii\.cost_per_unit\), 0\)/);
  assert.match(reports, /oi\.total \/ o\.subtotal \* o\.discount_amount/);
  assert.match(reports, /cm\.type = 'sale'/);
  assert.doesNotMatch(reports, /SUM\(o\.total\).*JOIN order_items/);
});

test("frontend contains a courier mobile workflow", async () => {
  const page = await readFrontend("pages/courier/index.html");
  const app = await readFrontend("pages/courier/app.js");
  const translations = await readFrontend("pages/courier/translations.js");
  assert.match(page, /data-courier-i18n="My deliveries"/);
  assert.match(translations, /"My deliveries": \{ en: "My deliveries", pt: "[^"]+" \}/);
  assert.match(app, /X-Courier-Token/);
  assert.match(app, /courier\/deliveries/);
  assert.match(page, /manifest\.webmanifest/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(app, /courier\/location/);
});

test("LAN proxy exposes only the courier endpoints required by the mobile workflow", async () => {
  const launcher = await readRoot("desktop/launcher.mjs");
  const proxy = launcher.slice(launcher.indexOf("const handlePublicApi ="), launcher.indexOf("const handleFrontend ="));
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
  assert.match(proxy, /const headers = \{ Accept: request\.headers\.accept \|\| "application\/json" \}/);
  assert.doesNotMatch(proxy, /headers\["(?:Authorization|X-Food-System-Local)"\]/i);
  assert.match(proxy, /headers\["X-Courier-Token"\] = courierToken/);
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

test("development Live Server origins can reach the local API without changing production access", async () => {
  const server = await read("src/server.js");
  const auth = await read("src/routes/auth.js");
  const origins = await read("src/local-origin.js");
  assert.match(server, /config\.allowLocalHeader && isLoopbackHttpOrigin\(origin\)/);
  assert.match(auth, /const unkeyedDevelopment = config\.allowLocalHeader && !config\.localAccessToken/);
  assert.match(auth, /unkeyedDevelopment && isLoopbackHttpOrigin\(request\.headers\.origin\)/);
  assert.match(auth, /if \(!hasLocalAdminAccess\(request\)\)/);
  assert.match(origins, /"localhost", "127\.0\.0\.1", "::1"/);
  assert.match(auth, /if \(config\.nodeEnv === "production"\)/);
});

test("public API requests do not attach saved or Tauri administrator credentials", async () => {
  const client = await readFrontend("shared/api/client.js");
  assert.match(client, /const needsAuthentication = auth !== false/);
  assert.match(client, /const isLocalAdminApi = \(\(\) =>/);
  assert.match(client, /url\.protocol === "http:"/);
  assert.match(client, /url\.hostname === "127\.0\.0\.1"/);
  assert.match(client, /url\.port === "3000"/);
  assert.match(client, /url\.pathname === "\/api\/v1"/);
  assert.match(client, /if \(needsAuthentication && isLocalAdminApi\) \{\s+try \{\s+localAccessToken = await window\.__TAURI__/);
  assert.match(client, /const developmentLocalMode = needsAuthentication && isLocalAdminApi &&/);
  assert.match(client, /if \(needsAuthentication\) \{\s+const storedSession = JSON\.parse\(localStorage\.getItem/);
  assert.match(client, /if \(storedSession\?\.token\) headers\.Authorization/);
  assert.match(client, /credentials: needsAuthentication \? "same-origin" : "omit"/);
  assert.match(client, /redirect: "error"/);
});

test("local administrator credentials never leave the exact loopback API target", async () => {
  const clientUrl = new URL("../../frontend/shared/api/client.js", import.meta.url).href;
  const harness = `
    import assert from "node:assert/strict";
    const apiUrl = process.env.CASE_API_URL;
    const expectToken = process.env.CASE_EXPECT_TOKEN === "yes";
    const expectInvoke = process.env.CASE_EXPECT_INVOKE === "yes";
    let invoked = 0;
    let request;
    globalThis.window = {
      FOOD_SYSTEM_API_URL: apiUrl,
      location: { hostname: "tauri.localhost", port: "" },
      __TAURI__: { core: { invoke: async (name) => { invoked += 1; assert.equal(name, "local_access_token"); if (process.env.CASE_TOKEN_READY === "no") throw new Error("API starting"); return "local-secret"; } } },
    };
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    globalThis.sessionStorage = globalThis.localStorage;
    globalThis.fetch = async (url, options) => {
      request = { url, redirect: options.redirect, headers: Object.fromEntries(new Headers(options.headers).entries()) };
      return new Response("{}", { status: 200 });
    };
    const { apiRequest } = await import(${JSON.stringify(clientUrl)});
    if (process.env.CASE_TOKEN_READY === "no") {
      await assert.rejects(apiRequest("/probe"), /API local ainda não está pronta|The local API is not ready yet/);
      assert.equal(request, undefined);
    } else {
      await apiRequest("/probe");
      assert.equal(request.redirect, "error");
      assert.equal(Boolean(request.headers["x-food-system-local"]), expectToken);
    }
    assert.equal(invoked, expectInvoke ? 1 : 0);
    if (expectToken) assert.equal(request.headers["x-food-system-local"], "local-secret");
  `;
  const cases = [
    ["https://attacker.invalid/api/v1", false, false, "yes"],
    ["http://127.0.0.1:3000/api/v1", true, true, "yes"],
    ["http://127.0.0.1:3000/api/v1?redirect=https://attacker.invalid", false, false, "yes"],
    ["http://127.0.0.1:3001/api/v1", false, false, "yes"],
    ["http://127.0.0.1:3000/api/v1", false, true, "no"],
  ];

  for (const [apiUrl, expectToken, expectInvoke, tokenReady] of cases) {
    execFileSync(process.execPath, ["--input-type=module", "--eval", harness], {
      env: { ...process.env, CASE_API_URL: apiUrl, CASE_EXPECT_TOKEN: expectToken ? "yes" : "no", CASE_EXPECT_INVOKE: expectInvoke ? "yes" : "no", CASE_TOKEN_READY: tokenReady },
      stdio: "pipe",
    });
  }
});

test("Tauri development launcher is supervised and receives its parent PID", async () => {
  const launcher = await readRoot("desktop/start-local.mjs");
  const backendLauncher = await readRoot("desktop/launcher.mjs");
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  assert.equal(config.identifier, "com.foodsystem.local");
  assert.equal(config.build.beforeDevCommand.cwd, "../");
  assert.equal(config.build.beforeDevCommand.script, "node desktop/start-local.mjs");
  assert.equal(config.build.beforeDevCommand.wait, false);
  assert.match(launcher, /FOOD_SYSTEM_PARENT_PID: String\(process\.pid\)/);
  assert.match(launcher, /process\.env\.APPDATA \|\| process\.env\.LOCALAPPDATA/);
  assert.match(launcher, /join\(appDataRoot, "com\.foodsystem\.local"\)/);
  assert.match(launcher, /FOOD_SYSTEM_ENV_FILE: join\(dataDir, "config\.env"\)/);
  assert.match(launcher, /NODE_ENV: "development"/);
  assert.match(backendLauncher, /const nodeEnvironment = process\.env\.NODE_ENV \|\| "production"/);
  assert.match(backendLauncher, /const environmentFile = process\.env\.FOOD_SYSTEM_ENV_FILE \|\| join\(dataDir, "config\.env"\)/);
  assert.match(backendLauncher, /FOOD_SYSTEM_ENV_FILE: environmentFile/);
  assert.match(backendLauncher, /const localAccessToken = nodeEnvironment === "development"\s+\? ""/);
  assert.match(backendLauncher, /FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: localAccessToken/);
  assert.match(launcher, /FOOD_SYSTEM_DATA_DIR: dataDir/);
  assert.match(launcher, /FOOD_SYSTEM_SECRET_KEY: secretKey/);
  assert.match(launcher, /flag: "wx"/);
  assert.match(launcher, /stdio: \["pipe", "inherit", "inherit"\]/);
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
  assert.equal(config.bundle.resources["../desktop/launcher.mjs"], "desktop/launcher.mjs");
  assert.equal(config.bundle.resources["../desktop/cleanup-backups.mjs"], "desktop/cleanup-backups.mjs");
  assert.equal(config.bundle.resources["../desktop/runtime/"], "desktop/runtime/");
  assert.doesNotMatch(JSON.stringify(config.bundle.resources), /mysql|maria/i);
  assert.match(prepareRuntime, /Join-Path \$PSScriptRoot "runtime\\node\.exe"/);
});

test("desktop startup stores the launcher child and creates a private encryption key", async () => {
  const bootstrap = await readRoot("src-tauri/src/lib.rs");
  const launcher = await readRoot("desktop/launcher.mjs");
  const server = await read("src/server.js");
  const database = await read("src/db.js");
  const migration = await read("src/migrate.js");
  assert.match(bootstrap, /struct BackendProcess\(Mutex<Option<Child>>\)/);
  assert.match(bootstrap, /create_new\(true\)/);
  assert.match(bootstrap, /options\.mode\(0o600\)/);
  assert.match(bootstrap, /WindowEvent::CloseRequested/);
  assert.match(bootstrap, /api_ready: Arc<AtomicBool>/);
  assert.match(launcher, /local encryption key is missing or invalid/);
  assert.match(launcher, /FOOD_SYSTEM_DATA_DIR: dataDir/);
  assert.match(launcher, /FOOD_SYSTEM_ENV_FILE: environmentFile/);
  assert.doesNotMatch(launcher, /ensureDatabase|MARIADB_ROOT|mariadbd/);
  assert.match(database, /new DatabaseSync\(databasePath/);
  assert.match(migration, /SQLite database ready/);
  assert.match(server, /import \{ checkDatabase, pool \} from "\.\/db\.js"/);
  assert.match(server, /await pool\.end\(\)/);
  assert.match(server, /process\.send\(\{ type: "api-listening" \}\)/);
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

test("obsolete MariaDB setup code and package dependencies are removed", async () => {
  const config = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  const databasePackage = JSON.parse(await readRoot("backend/package.json"));
  for (const oldScript of ["setup-mariadb.ps1", "harden-mariadb.ps1", "provision-mariadb.ps1"]) {
    await assert.rejects(fs.access(new URL(`../../desktop/${oldScript}`, import.meta.url)));
  }
  assert.equal(databasePackage.dependencies.mysql2, undefined);
  assert.doesNotMatch(JSON.stringify(config.bundle.resources), /mysql|maria/i);
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
    "../backend/src/": "backend/src/",
    "../backend/sqlite/": "backend/sqlite/",
    "../backend/node_modules/": "backend/node_modules/",
    "../backend/package.json": "backend/package.json",
    "../desktop/launcher.mjs": "desktop/launcher.mjs",
    "../desktop/cleanup-backups.mjs": "desktop/cleanup-backups.mjs",
    "../desktop/runtime/": "desktop/runtime/",
    "../frontend/": "frontend/",
  });
  assert.doesNotMatch(JSON.stringify(config.bundle.resources), /backend\/sql\//);
  assert.match(bootstrap, /resource_dir\.join\("desktop"\)\.join\("launcher\.mjs"\)/);
  assert.match(bootstrap, /resource_dir\.join\("desktop"\)\.join\("runtime"\)\.join\("node\.exe"\)/);
  assert.match(launcher, /const frontendRoot = join\(root, "frontend"\)/);
  assert.match(launcher, /const backendRoot = join\(root, "backend"\)/);
});

test("database queries and migrations use local SQLite", async () => {
  const config = await read("src/config.js");
  const db = await read("src/db.js");
  const migrate = await read("src/migrate.js");
  assert.doesNotMatch(config, /MYSQL_|MariaDB|mariadb/i);
  assert.match(db, /new DatabaseSync\(databasePath/);
  assert.match(db, /PRAGMA foreign_keys = ON/);
  assert.match(db, /PRAGMA journal_mode = WAL/);
  assert.match(db, /synchronous = FULL/);
  assert.match(db, /sqlite_initial_schema/);
  assert.doesNotMatch(db, /mysql2|MYSQL_|createConnection|information_schema/i);
  assert.match(migrate, /SQLite database ready/);
  assert.doesNotMatch(migrate, /mysql|maria/i);
});

test("orders persist and apply discount totals", async () => {
  const sql = await read("sql/migrations/007_order_discounts.sql");
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
  assert.match(server, /config\.nodeEnv === "test" && process\.env\.FOOD_SYSTEM_TEST_DISABLE_AUTH_RATE_LIMIT === "1"/);
  assert.doesNotMatch(server, /authAttempts\.clear\(\)/);
});

test("cash register opening uses a connection-scoped business lock", async () => {
  const routes = await read("src/routes/operations.js");
  const cash = await read("src/routes/cash.js");
  const orders = await read("src/routes/orders.js");
  const db = await read("src/db.js");
  assert.match(db, /BEGIN IMMEDIATE/);
  assert.match(db, /class Mutex/);
  assert.match(routes, /await connection\.beginTransaction\(\)/);
  assert.doesNotMatch(routes, /GET_LOCK|RELEASE_LOCK/);
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
  const createSchema = await read("sql/migrations/001_initial.sql");
  const migration = await read("sql/migrations/019_product_images.sql");
  assert.match(server, /bodyLimit: 5 \* 1024 \* 1024/);
  assert.match(createSchema, /image_url MEDIUMTEXT NULL/);
  assert.match(migration, /MODIFY COLUMN image_url MEDIUMTEXT NULL/);
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
  assert.match(routes, /"backup\.restored", "backup", null, \{ backup_name: name, safety_backup_created: true \}/);
  assert.match(routes, /Restore failed/);
  assert.match(page, /Criar backup|Create backup/);
});

test("concurrent backups use unique names and publish only completed encrypted files", async () => {
  const backup = await read("src/backup.js");
  const names = await read("src/backup-files.js");
  assert.match(backup, /const backupName = process\.argv\[2\] \|\| createBackupName\(\)/);
  assert.match(backup, /if \(!isSafeBackupName\(backupName\)\)/);
  assert.match(backup, /createDatabaseBackup\(temporaryDatabase\)/);
  assert.match(backup, /await encryptFile\(temporaryDatabase, temporaryOutput\)/);
  assert.ok(backup.indexOf("await rename(temporaryOutput, output)") > backup.indexOf("await encryptFile"));
  assert.match(backup, /rm\(temporaryOutput, \{ force: true \}\)/);
  assert.match(names, /\.sqlite\.enc/);
});

test("desktop startup cleans only stale recognized plaintext backup files", async () => {
  const launcher = await readRoot("desktop/launcher.mjs");
  const cleanup = await readRoot("desktop/cleanup-backups.mjs");
  assert.match(launcher, /removeStalePlaintextBackups\(backupDir\)/);
  assert.match(cleanup, /DEFAULT_MAX_AGE_MS = 60 \* 60 \* 1000/);
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
  assert.match(server, /app\.addHook\("onRequestAbort"/);
  assert.match(routes, /if \(!\(await beginRestore\(\)\)\) return reply\.conflict/);
  assert.match(routes, /sourceInfo = await lstat\(file\)/);
  assert.match(routes, /validateDatabase\(plain\)/);
  assert.match(routes, /await decryptFile\(file, plain\)/);
  assert.match(routes, /safetyName = createBackupName\(\)/);
  assert.match(routes, /await replaceDatabase\(plain\)/);
  assert.match(routes, /await replaceDatabase\(safetyPlain\)/);
  assert.match(routes, /if \(!keepMaintenance\) endRestore\(\)/);
  assert.match(restore, /PRAGMA integrity_check/);
  assert.match(restore, /await replaceDatabase\(staged\)/);
  assert.match(backup, /await createDatabaseBackup\(temporaryDatabase\)/);
  assert.match(maintenance, /activeRequests/);
  assert.match(launcher, /restore-recovery-required/);
});

test("inventory frontend exposes movement and recipe workflows", async () => {
  const page = await readFrontend("pages/app/inventory/index.html");
  const app = await readFrontend("pages/app/inventory/app.js");
  assert.match(page, /Adjustment or waste/);
  assert.match(page, /Recipe/);
  assert.match(app, /inventory\/items/);
  assert.match(app, /\/recipe/);
});

test("order printing is available in backend and kitchen frontend", async () => {
  const routes = await read("src/routes/orders.js");
  const app = await readFrontend("pages/app/kitchen/app.js");
  assert.match(routes, /orders\/:id\/print/);
  assert.match(app, /data-print-order/);
  assert.match(app, /popup\.print\(\)/);
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
  const legacyData = await readFrontend("shared/compatibility/legacy-portuguese-data.js");
  assert.match(auth, /legacyOrderNoteLabels\.payment/);
  assert.match(auth, /legacyPaymentMethodEntries/);
  assert.match(legacyData, /legacyOrderNoteLabels = Object\.freeze/);
  assert.match(legacyData, /legacyPaymentMethodEntries = Object\.freeze/);
  assert.match(auth, /PAYMENT_METHODS\.CASH_AT_COUNTER/);
  assert.match(qrMenu, /translate\("orderPaymentNoteLabel"\)\}\$\{paymentMethod\}/);
  assert.match(qrMenu, /legacyMenuQueryParams/);
});

test("backend registers the required route groups", async () => {
  const server = await read("src/server.js");
  for (const route of ["authRoutes", "catalogRoutes", "tableRoutes", "orderRoutes", "cashRoutes", "integrationRoutes", "inventoryRoutes", "operationsRoutes", "kitchenRoutes"]) assert.match(server, new RegExp(`register\\(${route}\\)`));
});

test("table QR menus create restaurant tables without the removed dining-tab workflow", async () => {
  const server = await read("src/server.js");
  const orders = await read("src/routes/orders.js");
  const menuApp = await readFrontend("pages/app/menu/app.js");
  assert.match(menuApp, /ensureRestaurantTableRemote\(tableName\)/);
  assert.match(menuApp, /renderQrCode/);
  assert.doesNotMatch(server, /diningTabRoutes/);
  assert.match(orders, /INSERT INTO orders \(id, business_id, idempotency_key, idempotency_hash, restaurant_table_id, customer_id/);
});

test("fiscal workflow saves drafts and keeps unimplemented issuance disabled", async () => {
  const server = await read("src/server.js");
  const routes = await read("src/routes/fiscal.js");
  const page = await readFrontend("pages/app/fiscal/index.html");
  const app = await readFrontend("pages/app/fiscal/app.js");
  const styles = await readFrontend("pages/app/fiscal/styles.css");
  const i18n = await readFrontend("shared/i18n/locales/en.js");
  assert.match(server, /register\(fiscalRoutes\)/);
  assert.match(routes, /Fiscal issuance is disabled until a certified provider integration/);
  assert.match(routes, /configuration: \{ issuanceAvailable: false \}/);
  assert.doesNotMatch(routes, /node:https|resolvePublicHttpsAddress|fiscal\/credentials/);
  assert.match(page, /Tax documents/);
  assert.match(page, /Drafts for reference only/);
  assert.match(page, /Issuance status/);
  assert.match(page, /valid tax documents cannot be issued/);
  assert.match(page, /New draft with no tax validity/);
  assert.match(app, /document\.status === "draft" \? "draft" : "legacy"/);
  assert.match(app, /fiscalLegacyStatus/);
  assert.doesNotMatch(app, /authorized:|issued:|rejected:/);
  assert.doesNotMatch(styles, /status--authorized|status--issued|status--rejected/);
  assert.doesNotMatch(i18n, /issueDocument|providerAuthorizedDocument/);
});

test("legacy screens expose a persistent language control", async () => {
  for (const pageName of ["dashboard", "cashier", "orders", "products", "menu", "team"]) {
    const page = await readFrontend(`pages/app/${pageName}/index.html`);
    assert.match(page, /legacy-control\.js/);
  }
  const userEdit = await readFrontend("pages/app/user-edit/index.html");
  assert.match(userEdit, /data-global-language/);
  const profilePanel = await readFrontend("shared/ui/ui.js");
  assert.match(profilePanel, /data-global-language/);
});

test("integration routes expose connection and event boundaries", async () => {
  const routes = await read("src/routes/integrations.js");
  assert.match(routes, /app\.post\("\/api\/v1\/businesses\/:businessId\/integrations"/);
  assert.match(routes, /integrations\/:id\/events", \{ bodyLimit: MAX_INTEGRATION_EVENT_BODY_BYTES \}, async \(request, reply\) => \{\s+const body = request\.body;\s+if \(!isJsonObject\(body\)\) return reply\.badRequest\("Integration event must be an object"\);\s+if \(body\.event_type !== "order\.received"\)/);
  assert.match(routes, /external-orders/);
  assert.match(routes, /order\.received/);
  assert.match(routes, /external_order_id/);
  assert.match(routes, /Credentials must be submitted through the encrypted credentials endpoint/);
  assert.match(routes, /only the generic webhook signing secret can be stored/);
  assert.match(routes, /const linkedOrderId = orderId \|\| externalOrders\[0\]\.order_id \|\| null/);
  assert.match(routes, /SELECT id, status FROM orders WHERE id = \? AND business_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(routes, /if \(linkedOrderId && status\)/);
  assert.match(routes, /Unsupported integration event type/);
  assert.match(routes, /external_order_id must contain 1 to 190 characters/);
  assert.match(routes, /MAX_INTEGRATION_SETTINGS_BYTES = 32 \* 1024/);
  assert.match(routes, /MAX_INTEGRATION_EVENT_BYTES = 256 \* 1024/);
  assert.match(routes, /MAX_INTEGRATION_EVENT_BODY_BYTES = MAX_INTEGRATION_EVENT_BYTES \+ 4 \* 1024/);
  assert.match(routes, /Integration event payload must be an object no larger than 256 KB/);
  assert.match(routes, /Integration settings must be an object no larger than 32 KB/);
  assert.match(routes, /Credentials exceed the 32 KB storage limit/);
  assert.match(routes, /typeof credentials\.webhook_secret !== "string"/);
  assert.match(routes, /Webhook secrets must contain 16 to 512 characters/);
  assert.match(routes, /status: "processed", duplicate: true/);
  assert.match(routes, /connectionStatuses = new Set\(\["disconnected", "pending", "error", "disabled"\]\)/);
  assert.match(routes, /const reachable = status >= 200 && status < 300/);
  assert.match(routes, /reachable \? "reachable" : "error"/);
  assert.match(routes, /return \{ reachable, status, provider:/);
  assert.match(routes, /Object\.keys\(credentials\)\.some\(\(key\) => key !== "webhook_secret"\)/);
  assert.doesNotMatch(routes, /credentials\.api_token/);
  assert.doesNotMatch(routes, /success: connected|return \{ connected,/);
  const migration = await read("sql/migrations/024_integration_reachability_status.sql");
  assert.match(migration, /UPDATE integration_connections SET status = 'reachable' WHERE status = 'connected'/);
  assert.match(migration, /ENUM\('disconnected','pending','reachable','error','disabled'\)/);
  const timestampMigration = await read("sql/migrations/025_integration_last_checked_at.sql");
  assert.match(timestampMigration, /CHANGE COLUMN last_synced_at last_checked_at DATETIME NULL/);
  assert.match(routes, /last_checked_at/);
  assert.doesNotMatch(routes, /last_synced_at/);
  const page = await readFrontend("pages/app/integrations/index.html");
  const app = await readFrontend("pages/app/integrations/app.js");
  assert.match(page, /Connectors for iFood, 99Food, Keeta, payments, and logistics are not implemented/);
  assert.match(page, /signed order\.received events as external orders/);
  assert.match(page, /does not authenticate with provider APIs, send orders, or sync statuses/);
  assert.doesNotMatch(page, /Token da API/);
  assert.match(app, /Test URL response/);
  assert.match(app, /URL responded · provider not verified/);
  assert.match(app, /result\.reachable/);
  assert.match(app, /Provider connector is not implemented yet/);
  assert.match(app, /credentials: \{ webhook_secret: webhookSecret \}/);
  assert.doesNotMatch(app, /api_token|Token da API/);
  assert.doesNotMatch(app, /Integration and credentials saved"/);
});

test("business-scoped public routes have explicit security boundaries", async () => {
  const orders = await read("src/routes/orders.js");
  const platform = await read("src/routes/platform.js");
  const integrations = await read("src/routes/integrations.js");
  const backups = await read("src/routes/backups.js");
  const orderStart = orders.indexOf('app.post("/api/v1/businesses/:businessId/orders"');
  const orderEnd = orders.indexOf("\n  });", orderStart);
  assert.ok(orderStart >= 0 && orderEnd > orderStart);
  assert.doesNotMatch(orders.slice(orderStart, orderEnd), /requireBusinessAccess|requireRole/);
  assert.match(orders.slice(orderStart, orderEnd), /validIdempotencyKey/);
  assert.match(platform, /app\.get\("\/api\/v1\/businesses\/:businessId\/public", async \(request, reply\) => \{\s+const \[businesses\]/);
  assert.match(integrations, /if \(request\.headers\.authorization\) \{\s+if \(!\(await requireRole\(request, reply\)\)\) return;\s+\} else if \(!\(await validWebhookSignature\(request, request\.params\.businessId, request\.params\.id\)\)\)/);
  assert.match(backups, /const requireLocalAdmin = async \(request, reply\) => \{\s+const user = await requireRole\(request, reply\);\s+if \(!user\) return null;\s+if \(user\.local !== true\)/);
  assert.equal((backups.match(/await requireLocalAdmin\(request, reply\)/g) || []).length, 2);
  assert.match(backups, /const user = await requireLocalAdmin\(request, reply\);/);
});

test("business route inventory requires an access check except for documented public handlers", async () => {
  const routeFiles = (await fs.readdir(new URL("../src/routes/", import.meta.url))).filter((name) => name.endsWith(".js"));
  const registrations = [];
  const unprotected = [];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*([`"'])([^`"']+)\2\s*,\s*async\s*\(request,\s*reply\)\s*=>\s*\{/g;
  const accessPattern = /requireBusinessAccess|requireRole|requireLocalAdmin|authenticate\(|validWebhookSignature|authenticateCourier/;
  for (const file of routeFiles) {
    const source = await read(`src/routes/${file}`);
    for (const match of source.matchAll(routePattern)) {
      if (!match[3].includes("/businesses/")) continue;
      registrations.push(`${match[1].toUpperCase()} ${match[3]}`);
      const handlerStart = match.index + match[0].length;
      if (accessPattern.test(source.slice(handlerStart, handlerStart + 350))) continue;
      const key = `${match[1].toUpperCase()} ${match[3]}`;
      unprotected.push(key);
    }
  }
  assert.ok(registrations.length >= 73, `Route inventory unexpectedly found only ${registrations.length} handlers`);
  assert.deepEqual(unprotected.sort(), [
    "GET /api/v1/businesses/:businessId/public",
    "POST /api/v1/businesses/:businessId/orders",
  ]);
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
  assert.match(routes, /ON CONFLICT\(id\) DO UPDATE SET name = excluded\.name/);
  assert.doesNotMatch(routes, /ON CONFLICT\(id\)[^\n]*settings = excluded\.settings/);
  assert.match(auth, /saveBusiness\(\{ id: business\.id, name: business\.name \}\)/);
  assert.match(client, /fetch\(`\$\{API_BASE_URL\}\/health`/);
});

test("local API availability check requires a healthy database, not only an HTTP listener", async () => {
  const server = await read("src/server.js");
  const client = await readFrontend("shared/api/client.js");
  assert.match(server, /app\.get\("\/api\/v1\/health", async \(_request, reply\) => \{\s+try \{\s+await checkDatabase\(\);\s+return \{ status: "ok", database: "ok" \};[\s\S]*?database: "unavailable"/);
  assert.match(client, /fetch\(`\$\{API_BASE_URL\}\/health`, \{\s+signal: AbortSignal\.timeout\(2500\)/);
});

test("frontend health probe reports the database as offline when API health returns 503", async () => {
  const clientUrl = new URL("../../frontend/shared/api/client.js", import.meta.url).href;
  const harness = `
    import assert from "node:assert/strict";
    globalThis.window = { FOOD_SYSTEM_API_URL: "http://127.0.0.1:3000/api/v1", location: { hostname: "tauri.localhost", port: "" } };
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    globalThis.sessionStorage = globalThis.localStorage;
    let requestedUrl = "";
    globalThis.fetch = async (url, options) => {
      requestedUrl = url;
      assert.ok(options.signal);
      return new Response("{}", { status: Number(process.env.CASE_STATUS) });
    };
    const { pingApi } = await import(${JSON.stringify(clientUrl)});
    assert.equal(await pingApi(), process.env.CASE_STATUS === "200");
    assert.equal(requestedUrl, "http://127.0.0.1:3000/api/v1/health");
  `;

  for (const status of ["200", "503"]) {
    execFileSync(process.execPath, ["--input-type=module", "--eval", harness], {
      env: { ...process.env, CASE_STATUS: status },
      stdio: "pipe",
    });
  }
});

test("Tauri local administrator cannot access another tenant business", async () => {
  const auth = await read("src/routes/auth.js");
  assert.match(auth, /LOCAL_BUSINESS_ID = "00000000-0000-4000-8000-000000000001"/);
  assert.match(auth, /businessId && businessId !== LOCAL_BUSINESS_ID/);
  assert.match(auth, /reply\.forbidden\("The local administrator can only access the local Food System business"\)/);
  assert.doesNotMatch(auth, /INSERT IGNORE INTO businesses/);
});

test("local administrator middleware accepts only its reserved business", async () => {
  const authUrl = new URL("../src/routes/auth.js", import.meta.url).href;
  const harness = `
    import assert from "node:assert/strict";
    const { requireBusinessAccess } = await import(${JSON.stringify(authUrl)});
    const token = "local-admin-runtime-test-token";
    const authorizedRequest = { headers: { "x-food-system-local": token }, params: { businessId: "00000000-0000-4000-8000-000000000001" } };
    const deniedRequest = { headers: { "x-food-system-local": token }, params: { businessId: "11111111-1111-4111-8111-111111111111" } };
    const makeReply = () => ({ status: 200, message: "", forbidden(message) { this.status = 403; this.message = message; }, unauthorized(message) { this.status = 401; this.message = message; } });
    const acceptedReply = makeReply();
    const accepted = await requireBusinessAccess(authorizedRequest, acceptedReply);
    assert.equal(accepted.local, true);
    assert.equal(accepted.business_id, authorizedRequest.params.businessId);
    const deniedReply = makeReply();
    const denied = await requireBusinessAccess(deniedRequest, deniedReply);
    assert.equal(denied, null);
    assert.equal(deniedReply.status, 403);
    assert.match(deniedReply.message, /only access the local Food System business/);
    assert.equal(deniedRequest.user, undefined);
  `;

  execFileSync(process.execPath, ["--input-type=module", "--eval", harness], {
    env: { ...process.env, NODE_ENV: "test", FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: "local-admin-runtime-test-token" },
    stdio: "pipe",
  });
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

test("production local app exposes no account endpoints and accepts no session fallback", async () => {
  const authPath = new URL("../src/routes/auth.js", import.meta.url).href;
  const harness = `
    import assert from "node:assert/strict";
    const routes = [];
    const app = Object.fromEntries(["put", "post", "get"].map((method) => [method, (url) => routes.push([method, url])]));
    const { default: authRoutes, requireBusinessAccess } = await import(${JSON.stringify(authPath)});
    await authRoutes(app);
    assert.deepEqual(routes, [["put", "/api/v1/local/business"]]);
    const deniedRequest = { headers: { authorization: "Bearer legacy-session" }, params: { businessId: "00000000-0000-4000-8000-000000000001" } };
    const deniedReply = { status: 200, unauthorized(message) { this.status = 401; this.message = message; }, forbidden() { this.status = 403; } };
    assert.equal(await requireBusinessAccess(deniedRequest, deniedReply), null);
    assert.equal(deniedReply.status, 401);
    const acceptedRequest = { headers: { "x-food-system-local": "local-production-token" }, params: { businessId: "00000000-0000-4000-8000-000000000001" } };
    const acceptedReply = { status: 200, unauthorized() { this.status = 401; }, forbidden() { this.status = 403; } };
    assert.equal((await requireBusinessAccess(acceptedRequest, acceptedReply)).local, true);
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", harness], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: "local-production-token",
    },
    stdio: "pipe",
  });
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
  const migration = await read("sql/migrations/021_order_customer_name.sql");
  const orders = await read("src/routes/orders.js");
  const businesses = await read("src/routes/businesses.js");
  const auth = await readFrontend("shared/auth/auth.js");
  assert.match(migration, /ALTER TABLE orders ADD COLUMN customer_name VARCHAR\(160\) NULL/);
  assert.match(orders, /customer_name: customerName \|\| null/);
  assert.match(businesses, /hasDecimalScale\(business\.settings\.delivery_fee, 2\)/);
  assert.doesNotMatch(auth, /customer_phone: "0000000000"/);
});

test("order migrations add a business-scoped idempotency key", async () => {
  const key = await read("sql/migrations/022_order_idempotency_key.sql");
  assert.match(key, /ADD COLUMN idempotency_key CHAR\(36\) NULL/);
  assert.match(key, /ADD COLUMN idempotency_hash CHAR\(64\) NULL/);
  assert.match(key, /UNIQUE KEY uq_orders_business_idempotency \(business_id, idempotency_key\)/);
});

test("courier location writes are throttled and retain only the latest position", async () => {
  const delivery = await read("src/routes/delivery.js");
  const migration = await read("sql/migrations/020_courier_latest_location.sql");
  const server = await read("src/server.js");
  const db = await read("src/db.js");
  assert.match(delivery, /const courierLocationWrites = new Map\(\)/);
  assert.match(delivery, /now - lastWrite < 5_000/);
  assert.match(delivery, /accuracy > 99_999_999\.99/);
  assert.match(delivery, /Location sharing is available only during an active delivery/);
  assert.match(db, /CURRENT_TIMESTAMP.*INTERVAL.*MINUTE/);
  assert.match(delivery, /Invalid courier delivery status transition/);
  assert.match(delivery, /ON CONFLICT\(courier_id\) DO UPDATE SET business_id = excluded\.business_id/);
  assert.match(server, /reply\.header\("Cache-Control", "no-store"\)/);
  assert.match(migration, /ADD UNIQUE KEY uq_courier_locations_courier \(courier_id\)/);
});

test("outbound HTTPS probes cap response bytes and total duration", async () => {
  const outbound = await read("src/outbound-request.js");
  assert.match(outbound, /responseBytes > 1024 \* 1024/);
  assert.match(outbound, /setTimeout\(\(\) => request\.destroy\(new Error\("Outbound HTTPS request exceeded 10 seconds"\)\), 10_000\)/);
});

test("fiscal drafts are bounded and no provider credentials or issue request are exposed", async () => {
  const fiscal = await read("src/routes/fiscal.js");
  assert.match(fiscal, /MAX_FISCAL_PAYLOAD_BYTES = 256 \* 1024/);
  assert.match(fiscal, /Fiscal document payload must be an object no larger than 256 KB/);
  assert.match(fiscal, /Fiscal issuance is disabled/);
  assert.doesNotMatch(fiscal, /node:https|resolvePublicHttpsAddress|fiscal\/credentials/);
  assert.match(fiscal, /app\.get\("\/api\/v1\/businesses\/:businessId\/fiscal\/documents", async \(request, reply\) => \{\s+if \(!\(await requireRole\(request, reply\)\)\) return/);
});

test("orders page binds delegated click actions without invoking the event listener", async () => {
  const orders = await readFrontend("pages/app/orders/app.js");
  assert.match(orders, /document\.addEventListener\("click", async \(event\) => \{[\s\S]*?actionButton\.disabled = false;\s*\}\n\}\);/);
  assert.doesNotMatch(orders, /actionButton\.disabled = false;\s*\}\n\}\)\(\);/);
});

test("local app shell collapses navigation to icon rail and opens its profile panel without login", async () => {
  const auth = await readFrontend("shared/auth/auth.js");
  const shell = await readFrontend("shared/ui/ui.js");
  const responsive = await readFrontend("styles/app-responsive.css");
  const entry = await readFrontend("entry/entry.js");
  const firstRun = await readFrontend("index.html");
  const dashboard = await readFrontend("pages/app/dashboard/index.html");
  assert.match(auth, /const LOCAL_MODE = true/);
  assert.match(auth, /if \(LOCAL_MODE\) return ensureLocalSession\(\)/);
  assert.match(shell, /food-system-sidebar-collapsed/);
  assert.match(shell, /setSidebarCollapsedState\(collapsed\)/);
  assert.match(shell, /const scheduleSidebarNavigationScrollSave =/);
  assert.match(shell, /addEventListener\("scroll", scheduleSidebarNavigationScrollSave/);
  assert.match(shell, /toggle\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(shell, /toggle\.setAttribute\("aria-label", translate\(collapsed \? "Expand menu" : "Collapse menu"\)\)/);
  assert.match(shell, /link\.setAttribute\("aria-label", translatedLabel\)/);
  assert.match(shell, /aria-haspopup", "dialog"/);
  assert.match(shell, /data-profile-view="settings"/);
  assert.match(responsive, /menu-shell\[data-sidebar-state="collapsed"\] \.menu-sidebar__nav a/);
  assert.match(responsive, /flex-basis:84px !important/);
  assert.match(responsive, /--app-rail:64px/);
  assert.match(responsive, /menu-sidebar__profile \.profile-label/);
  assert.match(dashboard, /class="profile-btn" type="button" aria-label="(Perfil|Profile)"/);
  assert.match(entry, /DEFAULT_TARGET = "\/pages\/app\/dashboard\/index\.html"/);
  assert.match(firstRun, /minlength="2" maxlength="160" required/);
  assert.match(entry, /name\.length < 2 \|\| name\.length > 160/);
});

test("business profile updates validate column limits and settings size before writing", async () => {
  const routes = await read("src/routes/businesses.js");
  const validation = await read("src/business-validation.js");
  const profile = await readFrontend("shared/ui/ui.js");
  assert.match(validation, /hasValidBusinessName =/);
  assert.match(validation, /hasValidBusinessDescription =/);
  assert.match(validation, /hasValidBusinessColor =/);
  assert.match(routes, /business\.name !== undefined && !hasValidBusinessName\(business\.name\)/);
  assert.match(routes, /business\.description !== undefined && !hasValidBusinessDescription\(business\.description\)/);
  assert.match(routes, /business\.primary_color !== undefined && !hasValidBusinessColor\(business\.primary_color\)/);
  const createStart = routes.indexOf('app.post("/api/v1/businesses",');
  const connectionStart = routes.indexOf("const connection = await pool.getConnection()", createStart);
  assert.ok(createStart >= 0 && connectionStart > createStart);
  const createHandler = routes.slice(createStart, connectionStart);
  assert.match(createHandler, /!hasValidBusinessName\(name\)/);
  assert.match(createHandler, /!hasValidBusinessDescription\(description\)/);
  assert.match(createHandler, /!hasValidBusinessColor\(primary_color\)/);
  assert.match(routes, /Buffer\.byteLength\(JSON\.stringify\(business\.settings\), "utf8"\) > 32 \* 1024/);
  assert.match(profile, /maxlength="160" required/);
  assert.match(profile, /phone\.length > 40/);
});

test("business validators enforce name, UTF-8 description, and color boundaries", async () => {
  const { hasValidBusinessName, hasValidBusinessDescription, hasValidBusinessColor } = await import("../src/business-validation.js");
  assert.equal(hasValidBusinessName("AB"), true);
  assert.equal(hasValidBusinessName(` ${"A".repeat(158)} `), true);
  assert.equal(hasValidBusinessName("A"), false);
  assert.equal(hasValidBusinessName("A".repeat(161)), false);
  assert.equal(hasValidBusinessName(42), false);
  assert.equal(hasValidBusinessDescription("a".repeat(65_535)), true);
  assert.equal(hasValidBusinessDescription("a".repeat(65_536)), false);
  assert.equal(hasValidBusinessDescription("😀".repeat(16_383)), true);
  assert.equal(hasValidBusinessDescription("😀".repeat(16_384)), false);
  assert.equal(hasValidBusinessColor("#A1b2C3"), true);
  assert.equal(hasValidBusinessColor("red"), false);
  assert.equal(hasValidBusinessColor("#12345g"), false);
});

test("verification panel lists process results and provides green checks, red X marks, and a close button", async () => {
  const ui = await readFrontend("shared/ui/ui.js");
  const styles = await readFrontend("styles/base.css");
  assert.match(ui, /data-profile-view="verification"/);
  assert.match(ui, /data-verification-close/);
  assert.match(ui, /4 checks completed · 2 items pending/);
  assert.match(ui, /64 of 64 files passed module syntax checks/);
  assert.match(ui, /22 of 22 tests passed against an isolated test server/);
  assert.match(ui, /81 of 87 checks passed; 6 existing assertions need review/);
  assert.match(ui, /verification-panel__status is-complete/);
  assert.match(ui, /verification-panel__status is-pending/);
  assert.match(styles, /\.verification-panel__status\.is-complete\{background:#16803a\}/);
  assert.match(styles, /\.verification-panel__status\.is-pending\{background:#dc2626\}/);
  assert.match(styles, /stroke-width:3\.7/);
});

test("local team is a business-scoped roster and does not claim per-person access control", async () => {
  const sql = await read("sql/migrations/023_local_team_roster.sql");
  const routes = await read("src/routes/platform.js");
  const page = await readFrontend("pages/app/team/index.html");
  const app = await readFrontend("pages/app/team/app.js");
  const i18n = await readFrontend("shared/i18n/locales/en.js");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS local_team_members/);
  assert.match(sql, /FOREIGN KEY \(business_id\) REFERENCES businesses\(id\) ON DELETE CASCADE/);
  assert.match(routes, /if \(user\.local\) \{\s+const \[members\] = await pool\.query\([\s\S]+?FROM local_team_members WHERE business_id = \?/);
  assert.match(routes, /INSERT INTO local_team_members \(id, business_id, name, role\)/);
  assert.match(routes, /UPDATE local_team_members SET role = \? WHERE id = \? AND business_id = \?/);
  assert.match(routes, /DELETE FROM local_team_members WHERE id = \? AND business_id = \?/);
  assert.match(page, /no individual sign-in, these roles are informational only/);
  assert.match(page, /Team directory/);
  assert.match(i18n, /teamEyebrow: "Team directory"/);
  assert.doesNotMatch(i18n, /Choose who can access the system|Access role for|People with access/);
  assert.doesNotMatch(page, /memberEmail|email@restaurant\.com|Access role/);
  assert.match(page, /minlength="2" maxlength="160"/);
  assert.doesNotMatch(app, /elements\.email/);
});

test("local administrator mutations are written to the audit log without a fake user account", async () => {
  const audit = await read("src/audit.js");
  const server = await read("src/server.js");
  const schema = await read("sql/migrations/008_security.sql");
  assert.match(audit, /if \(!user\) return/);
  assert.match(audit, /const auditUserId = user\.local \? null : user\.id \|\| null/);
  assert.match(audit, /user\.business_id \|\| null, auditUserId/);
  assert.doesNotMatch(server, /request\.user\.local \|\| request\.auditRecorded/);
  assert.match(schema, /user_id CHAR\(36\) NULL/);
});

test("menu QR codes are generated locally without sending the target URL to a QR service", async () => {
  const menu = await readFrontend("pages/app/menu/app.js");
  const launcher = await readRoot("desktop/launcher.mjs");
  const tauri = JSON.parse(await readRoot("src-tauri/tauri.conf.json"));
  const generator = await readFrontend("shared/vendor/qrcode-generator.js");
  assert.match(menu, /import qrcode from "\.\.\/\.\.\/\.\.\/shared\/vendor\/qrcode-generator\.js"/);
  assert.match(menu, /code\.addData\(targetUrl\)/);
  assert.match(menu, /code\.createDataURL\(8, 4\)/);
  assert.doesNotMatch(menu, /api\.qrserver\.com/);
  assert.doesNotMatch(launcher, /api\.qrserver\.com/);
  assert.doesNotMatch(tauri.app.security.csp, /api\.qrserver\.com/);
  assert.match(generator, /Licensed under the MIT license/);
  const { default: generateQr } = await import(new URL("../../frontend/shared/vendor/qrcode-generator.js", import.meta.url));
  const code = generateQr(0, "M");
  code.addData("https://example.test/pages/qr-code-final/index.html?table=7");
  code.make();
  assert.match(code.createDataURL(8, 4), /^data:image\/gif;base64,/);
  assert.ok(code.getModuleCount() >= 21);
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

test("SQLite backup and restore recognize the active database schema", async () => {
  const db = await read("src/db.js");
  const backup = await read("src/routes/backups.js");
  const restore = await read("src/restore.js");
  assert.match(db, /sqlite_initial_schema/);
  assert.match(backup, /createDatabaseBackup/);
  assert.match(restore, /SQLite restore source is invalid/);
  assert.match(restore, /replaceDatabase/);
});
