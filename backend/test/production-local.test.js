import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

test("installed local administrator can run a restaurant workflow in production mode", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "food-production-test-"));
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const token = randomUUID();
  const env = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), FOOD_SYSTEM_DATA_DIR: path.join(directory, "data"), FOOD_SYSTEM_BACKUP_DIR: path.join(directory, "backups"), FOOD_SYSTEM_ENV_FILE: path.join(directory, "isolated.env"), FOOD_SYSTEM_LOCAL_ACCESS_TOKEN: token, FOOD_SYSTEM_SECRET_KEY: "production-integration-test-key-0123456789" };
  for (const key of ["FOOD_SYSTEM_DB_PATH", "UPDATE_URL", "UPDATE_SHA256", "UPDATE_SIGNATURE", "UPDATE_PUBLIC_KEY"]) delete env[key];
  const server = spawn(process.execPath, ["src/server.js"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = async (route, { method = "GET", body, status = 200, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "X-Food-System-Local": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return text ? JSON.parse(text) : null;
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {}
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready && server.exitCode === null, `Production API did not start: ${stderr}`);
    const business = (await call("/local/business", { method: "PUT", body: { name: "Production test" } })).business;
    const root = `/businesses/${business.id}`;
    const snapshotPath = path.join(directory, "snapshot.sqlite");
    const snapshotDb = new DatabaseSync(path.join(directory, "data", "food-system.sqlite"), { readOnly: true });
    try { await backup(snapshotDb, snapshotPath); } finally { snapshotDb.close(); }
    const standalone = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["src/restore.js", snapshotPath], { env, stdio: ["ignore", "ignore", "pipe"] });
      let output = "";
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
    assert.notEqual(standalone.code, 0);
    assert.match(standalone.output, /Stop API, print, backup and maintenance processes/);
    const beforeProfile = (await call(root)).business;
    await call(root, { method: "PATCH", body: { name: "Changed in profile" } });
    await call(root, { method: "PATCH", status: 409, body: { name: beforeProfile.name, settings: JSON.parse(beforeProfile.settings), expected_settings: beforeProfile.settings, expected_business: { name: beforeProfile.name, description: beforeProfile.description, primary_color: beforeProfile.primary_color } } });
    assert.equal((await call(root)).business.name, "Changed in profile");
    await call(root, { method: "PATCH", body: { name: "Production test" } });
    const member = (await call(`${root}/team`, { method: "POST", status: 201, body: { name: "Local employee", role: "staff" } })).member;
    assert.ok(member.id);
    const category = (await call(`${root}/categories`, { method: "POST", status: 201, body: { name: "Meals" } })).category;
    const station = (await call(`${root}/kitchen-stations`, { method: "POST", status: 201, body: { name: "Kitchen" } })).station;
    const product = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Meal", price: 10, category_id: category.id, kitchen_station_id: station.id } })).product;
    await call(root, { method: "PATCH", body: { settings: { currency: "BRL", show_all_products: false, selected_categories: ["Meals"] } } });
    const beforeRename = (await call(root)).business.settings;
    await call(`${root}/categories/${category.id}`, { method: "PATCH", body: { name: "Main dishes" } });
    await call(root, { method: "PATCH", status: 409, body: { expected_settings: beforeRename, settings: JSON.parse(beforeRename) } });
    const renamedMenu = await call(`${root}/public`);
    assert.deepEqual(renamedMenu.selected_categories, ["Main dishes"]);
    assert.ok(renamedMenu.products.some((entry) => entry.id === product.id));
    const renamedOrder = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), items: [{ product_id: product.id, quantity: 1 }] } })).order;
    await call(`${root}/orders/${renamedOrder.id}/update_status`, { method: "PATCH", body: { status: "cancelled" } });
    await call(`${root}/categories/${category.id}`, { method: "PATCH", body: { name: "Meals" } });
    assert.deepEqual((await call(`${root}/public`)).selected_categories, ["Meals"]);
    await call(root, { method: "PATCH", body: { settings: { currency: "BRL" } } });
    await call(`${root}/categories/${category.id}`, { method: "DELETE", status: 409 });
    const item = (await call(`${root}/inventory/items`, { method: "POST", status: 201, body: { name: "Ingredient", unit: "unit", current_quantity: 10 } })).item;
    await call(`${root}/products/${product.id}/recipe`, { method: "PUT", body: { ingredients: [{ inventory_item_id: item.id, quantity: 1 }] } });
    await call(`${root}/products/${product.id}`, { method: "DELETE", status: 409 });
    const unusedCategory = (await call(`${root}/categories`, { method: "POST", status: 201, body: { name: "Unused" } })).category;
    const unusedProduct = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "  Unused  ", price: 1, category_id: unusedCategory.id, active: false, position: 3, invented_field: "ignored" } })).product;
    assert.equal(unusedProduct.name, "Unused");
    assert.equal(unusedProduct.active, 0);
    assert.equal(unusedProduct.position, 3);
    assert.equal(unusedProduct.invented_field, undefined);
    const persistedProduct = (await call(`${root}/products`)).products.find((entry) => entry.id === unusedProduct.id);
    assert.equal(persistedProduct.active, unusedProduct.active);
    assert.equal(persistedProduct.category_name, "Unused");
    assert.equal((await call(`${root}/public`)).products.some((entry) => entry.id === unusedProduct.id), false);
    await call(`${root}/products`, { method: "POST", status: 400, body: { name: "Invalid", price: 1, category_id: unusedCategory.id, active: "false" } });
    await call(`${root}/products/${unusedProduct.id}`, { method: "PATCH", body: { category: "Meals" } });
    assert.equal((await call(`${root}/products`)).products.find((entry) => entry.id === unusedProduct.id).category_name, "Meals");
    await call(`${root}/products/${unusedProduct.id}`, { method: "PATCH", body: { category_id: unusedCategory.id } });
    await call(`${root}/categories/${unusedCategory.id}`, { method: "PATCH", body: { active: false } });
    await call(`${root}/products`, { method: "POST", status: 400, body: { name: "Unavailable", price: 1, category_id: unusedCategory.id } });
    await call(`${root}/products`, { method: "POST", status: 400, body: { name: "Unavailable", price: 1, category: "Unused" } });
    await call(`${root}/products/${product.id}`, { method: "PATCH", status: 400, body: { category_id: unusedCategory.id } });
    assert.equal((await call(`${root}/public`)).products.some((entry) => entry.id === unusedProduct.id), false);
    await call(`${root}/categories/${unusedCategory.id}`, { method: "PATCH", body: { active: true } });
    await call(`${root}/products/${unusedProduct.id}`, { method: "DELETE", status: 204 });
    await call(`${root}/categories/${unusedCategory.id}`, { method: "DELETE", status: 204 });
    await call(`${root}/products/${unusedProduct.id}`, { method: "DELETE", status: 404 });
    const count = (await call(`${root}/inventory/stock-counts`, { method: "POST", status: 201, body: { location_id: item.location_id } })).stock_count;
    const snapshot = (await call(`${root}/inventory/stock-counts/${count.id}`)).stock_count;
    await call(`${root}/inventory/stock-counts/${count.id}`, { method: "PATCH", body: { status: "submitted", items: snapshot.items.map((entry) => ({ inventory_item_id: entry.inventory_item_id, counted_quantity: entry.expected_quantity })) } });
    await call(`${root}/inventory/stock-counts/${count.id}`, { method: "PATCH", body: { status: "approved" } });
    const cash = (await call(`${root}/cash-register/open`, { method: "POST", status: 201, body: { opening_amount: 20 } })).session;
    const movementKey = randomUUID();
    const movementRequest = { method: "POST", status: 201, headers: { "Idempotency-Key": movementKey }, body: { type: "entry", amount: 1, description: "Change" } };
    await call(`${root}/cash_movements`, { ...movementRequest, status: 400, headers: { "Idempotency-Key": "invalid key" } });
    const [movement, repeated] = await Promise.all([call(`${root}/cash_movements`, movementRequest), call(`${root}/cash_movements`, movementRequest)]);
    assert.equal(movement.movement.id, repeated.movement.id);
    await call(`${root}/cash_movements`, { ...movementRequest, status: 409, body: { ...movementRequest.body, amount: 2 } });
    assert.equal((await call(`${root}/cash_movements`)).movements.filter((entry) => entry.id === movement.movement.id).length, 1);
    const order = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), items: [{ product_id: product.id, quantity: 2 }], delivery: { address: { street: "Rua A", number: "1", city: "Salvador" } } } })).order;
    await call(`${root}/products/${product.id}`, { method: "DELETE", status: 409 });
    await call(`${root}/orders/${order.id}/update_status`, { method: "PATCH", status: 409, body: { status: "completed" } });
    const courier = (await call(`${root}/couriers`, { method: "POST", status: 201, body: { name: "Courier" } })).courier;
    const assigned = (await call(`${root}/orders/${order.id}/delivery`, { method: "POST", body: { courier_id: courier.id } })).delivery;
    await call(`${root}/orders/${order.id}/update_status`, { method: "PATCH", body: { status: "preparing" } });
    await call(`${root}/orders/${order.id}/update_status`, { method: "PATCH", body: { status: "ready" } });
    const oldCourierToken = (await call(`${root}/couriers/${courier.id}/token`, { method: "POST", body: {} })).token;
    const db = new DatabaseSync(path.join(directory, "data", "food-system.sqlite"), { timeout: 5000 });
    try {
      db.exec("CREATE TRIGGER fail_courier_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'courier.token_rotated' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      await call(`${root}/couriers/${courier.id}/token`, { method: "POST", body: {}, status: 500 });
      await call("/courier/deliveries", { headers: { "X-Courier-Token": oldCourierToken } });
      db.exec("DROP TRIGGER fail_courier_audit");
    } finally { db.close(); }
    const courierToken = (await call(`${root}/couriers/${courier.id}/token`, { method: "POST", body: {} })).token;
    assert.notEqual(courierToken, oldCourierToken);
    await call("/courier/deliveries", { status: 401, headers: { "X-Courier-Token": oldCourierToken } });
    await call("/courier/deliveries", { headers: { "X-Courier-Token": courierToken } });
    await call(`/courier/deliveries/${assigned.id}`, { method: "PATCH", headers: { "X-Courier-Token": courierToken }, body: { status: "picked_up" } });
    await call(`${root}/orders/${order.id}/update_status`, { method: "PATCH", status: 409, body: { status: "completed" } });
    await call(`/courier/deliveries/${assigned.id}`, { method: "PATCH", headers: { "X-Courier-Token": courierToken }, body: { status: "delivered" } });
    await call(`${root}/orders/${order.id}/delivery`, { method: "POST", status: 409, body: { courier_id: courier.id } });
    await call(`${root}/orders/${order.id}/update_status`, { method: "PATCH", body: { status: "completed" } });
    const inventory = await call(`${root}/inventory/items`);
    assert.equal(Number(inventory.items.find((entry) => entry.id === item.id).current_quantity), 8);
    const closed = await call(`${root}/cash-register/${cash.id}/close`, { method: "POST", body: { closing_amount: 41 } });
    assert.equal(closed.reconciliation.expected_amount, 41);
    assert.equal((await call(`${root}/cash_movements`, movementRequest)).movement.id, movement.movement.id);
    const retryOrder = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), items: [{ product_id: product.id, quantity: 1 }], delivery: { address: { street: "Rua B", number: "2", city: "Salvador" } } } })).order;
    const firstAttempt = (await call(`${root}/orders/${retryOrder.id}/delivery`, { method: "POST", body: { courier_id: courier.id } })).delivery;
    await call(`/courier/deliveries/${firstAttempt.id}`, { method: "PATCH", status: 400, headers: { "X-Courier-Token": courierToken }, body: { status: "failed", failure_reason: "x".repeat(501) } });
    await call(`/courier/deliveries/${firstAttempt.id}`, { method: "PATCH", headers: { "X-Courier-Token": courierToken }, body: { status: "failed", failure_reason: "  Address not found  " } });
    const failedDelivery = (await call(`${root}/deliveries?view=queue`)).deliveries.find((delivery) => delivery.id === firstAttempt.id);
    assert.equal(failedDelivery.can_retry, 1);
    assert.equal(failedDelivery.failure_reason, "Address not found");
    const secondAttempt = (await call(`${root}/orders/${retryOrder.id}/delivery`, { method: "POST", status: 201, body: { courier_id: courier.id } })).delivery;
    assert.notEqual(secondAttempt.id, firstAttempt.id);
    assert.equal((await call(`${root}/deliveries?view=queue`)).deliveries.find((delivery) => delivery.id === firstAttempt.id).can_retry, 0);
    await call(`${root}/deliveries/${secondAttempt.id}`, { method: "PATCH", body: { status: "cancelled" } });
    const thirdAttempt = (await call(`${root}/orders/${retryOrder.id}/delivery`, { method: "POST", status: 201, body: { courier_id: courier.id } })).delivery;
    assert.notEqual(thirdAttempt.id, secondAttempt.id);
    await call(`${root}/deliveries/${thirdAttempt.id}`, { method: "PATCH", status: 400, body: { status: "picked_up", failure_reason: "unexpected" } });
    await call(`${root}/deliveries/${thirdAttempt.id}`, { method: "PATCH", body: { status: "failed", failure_reason: "  Vehicle unavailable  " } });
    const fourthAttempt = (await call(`${root}/orders/${retryOrder.id}/delivery`, { method: "POST", status: 201, body: { courier_id: courier.id } })).delivery;
    const queueDb = new DatabaseSync(path.join(directory, "data", "food-system.sqlite"), { timeout: 5000 });
    try {
      const insert = queueDb.prepare("INSERT INTO delivery_assignments (id, business_id, order_id, provider, status, payload, updated_at) VALUES (?, ?, ?, 'local', 'cancelled', '{}', ?)");
      queueDb.exec("BEGIN");
      for (let index = 0; index < 55; index += 1) insert.run(randomUUID(), business.id, retryOrder.id, `2020-01-01 00:00:${String(index).padStart(2, "0")}`);
      queueDb.exec("COMMIT");
    } finally { queueDb.close(); }
    const queue = await call(`${root}/deliveries?view=queue`);
    assert.equal(queue.deliveries.filter((delivery) => ["cancelled", "delivered"].includes(delivery.status)).length, 50);
    assert.ok(queue.deliveries.some((delivery) => delivery.id === firstAttempt.id && delivery.status === "failed"));
    assert.ok(queue.deliveries.some((delivery) => delivery.id === thirdAttempt.id && delivery.status === "failed" && delivery.failure_reason === "Vehicle unavailable" && delivery.can_retry === 0));
    assert.ok(queue.deliveries.some((delivery) => delivery.id === fourthAttempt.id && delivery.status === "assigned"));
    await call(`${root}/deliveries?view=unknown`, { status: 400 });
    const reportProductA = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Report A", price: 10, category_id: category.id } })).product;
    const reportProductB = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Report B", price: 20, category_id: category.id } })).product;
    await call(`${root}/discounts`, { method: "POST", status: 201, body: { name: "Report discount", code: "REPORT10", type: "percentage", value: 10 } });
    const discounted = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), discount_code: "REPORT10", items: [{ product_id: reportProductA.id, quantity: 1 }, { product_id: reportProductB.id, quantity: 1 }] } })).order;
    await call(`${root}/orders/${discounted.id}/update_status`, { method: "PATCH", body: { status: "completed" } });
    const report = await call(`${root}/reports/sales`);
    assert.equal(Number(report.products.find((item) => item.name === "Report A").revenue), 9);
    assert.equal(Number(report.products.find((item) => item.name === "Report B").revenue), 18);
    const centA = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Cent A", price: 0.05, category_id: category.id } })).product;
    const centB = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Cent B", price: 0.05, category_id: category.id } })).product;
    await call(`${root}/discounts`, { method: "POST", status: 201, body: { name: "One cent", code: "CENT01", type: "fixed", value: 0.01 } });
    const centOrder = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), discount_code: "CENT01", items: [{ product_id: centA.id, quantity: 1 }, { product_id: centB.id, quantity: 1 }] } })).order;
    await call(`${root}/orders/${centOrder.id}/update_status`, { method: "PATCH", body: { status: "completed" } });
    const centReport = await call(`${root}/reports/sales`);
    const cents = centReport.products.filter((item) => ["Cent A", "Cent B"].includes(item.name)).map((item) => Math.round(Number(item.revenue) * 100)).sort();
    assert.deepEqual(cents, [4, 5]);
    assert.equal(cents.reduce((total, value) => total + value, 0), Math.round(centOrder.total * 100));
    const largeA = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Large A", price: 49999999.99, category_id: category.id } })).product;
    const largeB = (await call(`${root}/products`, { method: "POST", status: 201, body: { name: "Large B", price: 49999999.99, category_id: category.id } })).product;
    await call(`${root}/discounts`, { method: "POST", status: 201, body: { name: "Large discount", code: "LARGE", type: "fixed", value: 99999999.97 } });
    const largeOrder = (await call(`${root}/orders`, { method: "POST", status: 201, body: { idempotency_key: randomUUID(), discount_code: "LARGE", items: [{ product_id: largeA.id, quantity: 1 }, { product_id: largeB.id, quantity: 1 }] } })).order;
    await call(`${root}/orders/${largeOrder.id}/update_status`, { method: "PATCH", body: { status: "completed" } });
    const largeReport = await call(`${root}/reports/sales`);
    const largeCents = largeReport.products.filter((item) => ["Large A", "Large B"].includes(item.name)).map((item) => Math.round(Number(item.revenue) * 100)).sort();
    assert.deepEqual(largeCents, [0, 1]);
    const auditDb = new DatabaseSync(path.join(directory, "data", "food-system.sqlite"), { timeout: 5000 });
    try {
      auditDb.exec("CREATE TRIGGER fail_backup_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'backup.created' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      const created = await call(`${root}/backups`, { method: "POST", status: 201 });
      assert.equal(created.created, true);
      assert.equal(created.audit_recorded, false);
      auditDb.exec("DROP TRIGGER fail_backup_audit");
    } finally { auditDb.close(); }
    const backups = (await call(`${root}/backups`)).backups;
    assert.equal(backups.length, 1);
    await call(`${root}`, { method: "PATCH", body: { name: "Changed after backup" } });
    const secondProbe = createServer();
    await new Promise((resolve, reject) => { secondProbe.once("error", reject); secondProbe.listen(0, "127.0.0.1", resolve); });
    const secondPort = secondProbe.address().port;
    await new Promise((resolve) => secondProbe.close(resolve));
    const secondApi = spawn(process.execPath, ["src/server.js"], { env: { ...env, PORT: String(secondPort) }, stdio: "ignore" });
    try {
      let secondReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { if ((await fetch(`http://127.0.0.1:${secondPort}/api/v1/health`)).ok) { secondReady = true; break; } } catch {}
        if (secondApi.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(secondReady, true);
      await call(`${root}/backups/restore`, { method: "POST", status: 409, body: { name: backups[0].name } });
      assert.equal((await call(root)).business.name, "Changed after backup");
    } finally {
      if (secondApi.exitCode === null && secondApi.signalCode === null) {
        const stopped = new Promise((resolve) => secondApi.once("exit", resolve));
        secondApi.kill("SIGTERM");
        await stopped;
      }
    }
    const worker = spawn(process.execPath, ["src/print-worker.js"], { env: { ...env, PRINT_WORKER_ONCE: "false" }, stdio: "ignore" });
    try {
      let registered = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        registered = (await readdir(path.join(directory, "data"))).some((name) => name.startsWith(`food-system.sqlite.print-worker-${worker.pid}-`));
        if (registered || worker.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(registered, true, "print worker must register before the restore test");
      await call(`${root}/backups/restore`, { method: "POST", status: 409, body: { name: backups[0].name } });
      assert.equal((await call(root)).business.name, "Changed after backup");
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        const stopped = new Promise((resolve) => worker.once("exit", resolve));
        worker.kill("SIGTERM");
        await stopped;
      }
    }
    const interruptedWorker = spawn(process.execPath, ["src/print-worker.js"], { env: { ...env, PRINT_WORKER_ONCE: "false" }, stdio: "ignore" });
    let staleWorkerMarker;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        staleWorkerMarker = (await readdir(path.join(directory, "data"))).find((name) => name.startsWith(`food-system.sqlite.print-worker-${interruptedWorker.pid}-`));
        if (staleWorkerMarker || interruptedWorker.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(staleWorkerMarker);
    } finally {
      if (interruptedWorker.exitCode === null && interruptedWorker.signalCode === null) {
        const stopped = new Promise((resolve) => interruptedWorker.once("exit", resolve));
        interruptedWorker.kill("SIGKILL");
        await stopped;
      }
    }
    assert.ok((await readdir(path.join(directory, "data"))).includes(staleWorkerMarker));
    await call(`${root}/backups/restore`, { method: "POST", body: { name: backups[0].name } });
    assert.equal((await readdir(path.join(directory, "data"))).includes(staleWorkerMarker), false);
    assert.equal((await call(root)).business.name, "Production test");
    const restoredQueue = (await call(`${root}/deliveries?view=queue`)).deliveries;
    assert.equal(restoredQueue.find((entry) => entry.id === firstAttempt.id)?.failure_reason, "Address not found");
    assert.equal(restoredQueue.find((entry) => entry.id === thirdAttempt.id)?.failure_reason, "Vehicle unavailable");
    assert.equal((await call(`${root}/cash_movements`, movementRequest)).movement.id, movement.movement.id);
    assert.equal((await call(`${root}/cash_movements`)).movements.filter((entry) => entry.id === movement.movement.id).length, 1);
  } finally {
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
