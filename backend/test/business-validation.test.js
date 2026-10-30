import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { pool } from "../src/db.js";
import businessesRoutes from "../src/routes/businesses.js";
import kitchenRoutes from "../src/routes/kitchen.js";
import cashRoutes from "../src/routes/cash.js";
import operationsRoutes from "../src/routes/operations.js";
import orderRoutes from "../src/routes/orders.js";
import authRoutes from "../src/routes/auth.js";
import deliveryRoutes from "../src/routes/delivery.js";
import customerValueRoutes from "../src/routes/customer-value.js";
import inventoryRoutes from "../src/routes/inventory.js";
import integrationRoutes from "../src/routes/integrations.js";
import diningTabRoutes from "../src/routes/dining-tabs.js";
import tableRoutes from "../src/routes/tables.js";
import platformRoutes from "../src/routes/platform.js";
import catalogRoutes from "../src/routes/catalog.js";
import fiscalRoutes from "../src/routes/fiscal.js";
import reportRoutes from "../src/routes/reports.js";

test("report filters reject impossible, empty and repeated dates before queries", async () => {
  const originalQuery = pool.query;
  let reportQueries = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    reportQueries += 1;
    throw new Error("Invalid report date filters must be rejected before data queries");
  };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(reportRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    for (const url of [
      "/api/v1/businesses/test-business/reports/sales?from=2026-99-99",
      "/api/v1/businesses/test-business/reports/cash?from=2025-02-29",
      "/api/v1/businesses/test-business/reports/sales?from=",
      "/api/v1/businesses/test-business/reports/sales?from=2026-01-01&from=2026-01-02",
      "/api/v1/businesses/test-business/reports/sales?from=2026-02-01&to=2026-01-01",
    ]) {
      const response = await app.inject({ method: "GET", url, headers });
      assert.equal(response.statusCode, 400, `${url} should be rejected`);
    }
    assert.equal(reportQueries, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
  }
});

test("team, category and fiscal mutations reject non-text enum fields before writes", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let writes = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writes += 1;
    throw new Error("Invalid enum and name fields must be rejected before writes");
  };
  pool.getConnection = async () => { writes += 1; throw new Error("Invalid team role must be rejected before connecting"); };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(platformRoutes);
    await app.register(catalogRoutes);
    await app.register(fiscalRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/team", payload: { full_name: "Maria Silva", role: ["manager"] } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/team/member-1", payload: { role: ["manager"] } },
      { method: "POST", url: "/api/v1/businesses/test-business/categories", payload: { name: {} } },
      { method: "POST", url: "/api/v1/businesses/test-business/fiscal/documents", payload: { document_type: ["nfce"] } },
      { method: "POST", url: "/api/v1/businesses/test-business/fiscal/documents", payload: { order_id: {} } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed data`);
    }
    assert.equal(writes, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("table, dining-tab, cash and order routes reject coerced mutation fields before database writes", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let databaseWrites = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    databaseWrites += 1;
    throw new Error("Malformed mutation data must be rejected before writes");
  };
  pool.getConnection = async () => { databaseWrites += 1; throw new Error("Malformed mutation data must be rejected before connection"); };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(diningTabRoutes);
    await app.register(cashRoutes);
    await app.register(tableRoutes);
    await app.register(operationsRoutes);
    await app.register(orderRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/tables", payload: { name: {} } },
      { method: "POST", url: "/api/v1/businesses/test-business/tables/table-1/dining-tabs", payload: { notes: 7 } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash_movements", payload: { type: "entry", amount: 4, description: [] } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/session-1/close", payload: { closing_amount: 2, notes: [] } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/orders/order-1/update_status", payload: { status: ["completed"] } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed data`);
    }
    assert.equal(databaseWrites, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("integration and external-order routes reject coerced statuses and truncated names", async () => {
  const originalQuery = pool.query;
  let writeAttempts = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writeAttempts += 1;
    throw new Error("Malformed integration update must be rejected before writes");
  };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(integrationRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/integrations", payload: { provider: "payment", display_name: {} } },
      { method: "POST", url: "/api/v1/businesses/test-business/integrations", payload: { provider: "payment", display_name: "I".repeat(121) } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/integrations/integration-1", payload: { status: ["connected"] } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/external-orders/order-1", payload: { status: ["completed"] } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed input`);
    }
    assert.equal(writeAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
  }
});

test("inventory routes reject empty-string numeric defaults and oversized text before writes", async () => {
  const originalQuery = pool.query;
  let writeAttempts = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writeAttempts += 1;
    throw new Error("Invalid inventory data must be rejected before writes");
  };
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => { writeAttempts += 1; throw new Error("Invalid purchase data must be rejected before connecting"); };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(inventoryRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/inventory/items", payload: { name: "Flour", current_quantity: "" } },
      { method: "POST", url: "/api/v1/businesses/test-business/inventory/items", payload: { name: "Flour", cost_per_unit: null } },
      { method: "POST", url: "/api/v1/businesses/test-business/inventory/items/inventory-1/movements", payload: { type: "loss", quantity: 1, direction: "-1" } },
      { method: "POST", url: "/api/v1/businesses/test-business/purchases", payload: { items: [{ inventory_item_id: {}, quantity: 1, unit_cost: 2 }] } },
      { method: "POST", url: "/api/v1/businesses/test-business/purchases", payload: { items: [{ inventory_item_id: "inventory-1", quantity: 1, unit_cost: 2 }], notes: "N".repeat(256) } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed data`);
    }
    assert.equal(writeAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("discount and loyalty routes reject rounded or coerced numeric input before writes", async () => {
  const originalQuery = pool.query;
  let writeAttempts = 0;
  pool.query = async (sql) => {
    const statement = String(sql);
    if (statement.startsWith("SELECT u.id")) return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    if (statement.startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writeAttempts += 1;
    throw new Error("Invalid discount or loyalty data must be rejected before writes");
  };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(customerValueRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/discounts", payload: { name: "Sale", type: "fixed", value: "" } },
      { method: "POST", url: "/api/v1/businesses/test-business/discounts", payload: { name: "Sale", type: "fixed", value: 1.234 } },
      { method: "POST", url: "/api/v1/businesses/test-business/discounts", payload: { name: "Sale", type: "fixed", value: 1, code: "ß".repeat(21) } },
      { method: "POST", url: "/api/v1/businesses/test-business/customers/customer-1/loyalty/earn", payload: { points: "3" } },
      { method: "POST", url: "/api/v1/businesses/test-business/customers/customer-1/loyalty/redeem", payload: { points: null } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed input`);
    }
    assert.equal(writeAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
  }
});

test("courier endpoints reject coerced status and rounded coordinates", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let connectionAttempts = 0;
  pool.query = async (sql) => {
    if (String(sql).includes("FROM delivery_couriers WHERE token_hash")) return [[{ id: "courier-1", business_id: "business-1", name: "Courier" }], []];
    throw new Error(`Unexpected database query: ${sql}`);
  };
  pool.getConnection = async () => { connectionAttempts += 1; throw new Error("Invalid courier data must not open a connection"); };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(deliveryRoutes);
    await app.ready();
    const headers = { "x-courier-token": "test-token" };
    const invalidRequests = [
      { method: "PATCH", url: "/api/v1/courier/deliveries/delivery-1", payload: { status: ["delivered"] } },
      { method: "POST", url: "/api/v1/courier/location", payload: { latitude: "0", longitude: 0 } },
      { method: "POST", url: "/api/v1/courier/location", payload: { latitude: null, longitude: 0 } },
      { method: "POST", url: "/api/v1/courier/location", payload: { latitude: 0, longitude: 0, accuracy_m: 1.234 } },
      { method: "POST", url: "/api/v1/courier/location", payload: [] },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.url} should reject malformed data`);
    }
    assert.equal(connectionAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("authentication routes reject non-text identity fields before database access", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let databaseAttempts = 0;
  pool.query = async () => { databaseAttempts += 1; throw new Error("Malformed authentication data must not query the database"); };
  pool.getConnection = async () => { databaseAttempts += 1; throw new Error("Malformed registration data must not open a connection"); };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(authRoutes);
    await app.ready();
    for (const payload of [
      { email: {}, name: "Valid Name", password: "LongEnough1" },
      { email: "valid@example.test", name: [], password: "LongEnough1" },
      { email: "valid@example.test", name: "Valid Name", password: 12345678 },
      { user: [] },
    ]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload });
      assert.equal(response.statusCode, 400);
    }
    for (const payload of [{ email: [], password: "LongEnough1" }, { email: "valid@example.test", password: {} }, []]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload });
      assert.equal(response.statusCode, 401);
    }
    assert.equal(databaseAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("public order route rejects malformed customer, delivery and discount fields before connecting", async () => {
  const originalGetConnection = pool.getConnection;
  let connectionAttempts = 0;
  pool.getConnection = async () => {
    connectionAttempts += 1;
    throw new Error("Invalid public order data must be rejected before opening a connection");
  };
  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(orderRoutes);
    await app.ready();
    const base = { items: [{ product_id: "product-1", quantity: 1 }], idempotency_key: "3e17b6b0-8f91-4fd6-9cfb-00be9de88737" };
    const invalidOrders = [
      { ...base, delivery: "home" },
      { ...base, delivery: { address: [] } },
      { ...base, delivery: { address: { street: {}, number: "1", city: "Recife" } } },
      { ...base, delivery: { address: { street: "R".repeat(201), number: "1", city: "Recife" } } },
      { ...base, delivery: { address: { street: "Rua", number: "1", city: "Recife" }, scheduled_for: {} } },
      { ...base, order: { customer_name: "N".repeat(161) } },
      { ...base, order: { notes: 12 } },
      { ...base, discount_code: { code: "SAVE" } },
      { ...base, discount_code: "D".repeat(41) },
      { ...base, discount_code: "ß".repeat(21) },
    ];
    for (const payload of invalidOrders) {
      const response = await app.inject({ method: "POST", url: "/api/v1/businesses/test-business/orders", payload });
      assert.equal(response.statusCode, 400, `should reject ${JSON.stringify(payload).slice(0, 120)}; got ${response.body}`);
    }
    assert.equal(connectionAttempts, 0);
  } finally {
    await app.close();
    pool.getConnection = originalGetConnection;
  }
});

test("business creation rejects invalid profile fields before opening a database connection", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let connectionAttempts = 0;
  pool.query = async (sql) => {
    if (String(sql).startsWith("SELECT u.id")) {
      return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: null, role: "owner" }], []];
    }
    if (String(sql).startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected test query: ${sql}`);
  };
  pool.getConnection = async () => {
    connectionAttempts += 1;
    throw new Error("Invalid business data must be rejected before connecting to the database");
  };

  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(businessesRoutes);
    await app.ready();
    const invalidBusinesses = [
      { name: 12 },
      { name: "x" },
      { name: "B".repeat(161) },
      { name: "Valid Name", description: "😀".repeat(16_384) },
      { name: "Valid Name", primary_color: "url(javascript:alert(1))" },
    ];
    for (const business of invalidBusinesses) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/businesses",
        headers: { authorization: "Bearer test-session" },
        payload: business,
      });
      assert.equal(response.statusCode, 400, `${JSON.stringify(business).slice(0, 100)} should be rejected; got ${response.body}`);
    }
    assert.equal(connectionAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("kitchen station routes enforce schema types and printer URL length before writes", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let writeAttempts = 0;
  pool.query = async (sql) => {
    if (String(sql).startsWith("SELECT u.id")) {
      return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    }
    if (String(sql).startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writeAttempts += 1;
    throw new Error("Invalid station data must be rejected before writes");
  };
  pool.getConnection = async () => {
    writeAttempts += 1;
    throw new Error("Invalid station data must be rejected before opening a connection");
  };

  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(kitchenRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/kitchen-stations", payload: { name: 42 } },
      { method: "POST", url: "/api/v1/businesses/test-business/kitchen-stations", payload: { name: "Station", printer_url: `https://${"a".repeat(500)}` } },
      { method: "POST", url: "/api/v1/businesses/test-business/kitchen-stations", payload: { name: "Station", printer_url: "http://192.168.1.50/printer" } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/kitchen-stations/station-1", payload: { active: "false" } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/kitchen-stations/station-1", payload: { name: "S".repeat(121) } },
      { method: "PATCH", url: "/api/v1/businesses/test-business/kitchen-stations/station-1", payload: { printer_url: "x".repeat(501) } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.method} ${request.url} should reject invalid station data`);
    }
    assert.equal(writeAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});

test("cash and payment routes reject non-decimal numbers and wrong name types before writes", async () => {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  let writeAttempts = 0;
  pool.query = async (sql) => {
    if (String(sql).startsWith("SELECT u.id")) {
      return [[{ id: "test-user", email: "test@example.test", name: "Test", business_id: "test-business", role: "owner" }], []];
    }
    if (String(sql).startsWith("UPDATE sessions SET last_used_at")) return [{ affectedRows: 1 }, []];
    writeAttempts += 1;
    throw new Error("Invalid cash data must be rejected before writes");
  };
  pool.getConnection = async () => {
    writeAttempts += 1;
    throw new Error("Invalid cash data must be rejected before opening a connection");
  };

  const app = Fastify();
  try {
    await app.register(sensible);
    await app.register(cashRoutes);
    await app.register(operationsRoutes);
    await app.ready();
    const headers = { authorization: "Bearer test-session" };
    const invalidRequests = [
      { method: "POST", url: "/api/v1/businesses/test-business/payment-methods", payload: { name: 42 } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/open", payload: { opening_amount: true } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/open", payload: { opening_amount: "0x10" } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/open", payload: { opening_amount: "1e3" } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/open", payload: { opening_amount: null } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/open", payload: [] },
      { method: "POST", url: "/api/v1/businesses/test-business/cash-register/session-1/close", payload: { closing_amount: "0x10" } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash_movements", payload: { amount: true } },
      { method: "POST", url: "/api/v1/businesses/test-business/cash_movements", payload: { amount: "1e3" } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 400, `${request.method} ${request.url} should reject invalid values`);
    }
    assert.equal(writeAttempts, 0);
  } finally {
    await app.close();
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
});
