import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { pool } from "../src/db.js";
import catalogRoutes from "../src/routes/catalog.js";

test("category deactivation waits until product creation finishes its transaction", { timeout: 10000 }, async () => {
  const business = "00000000-0000-4000-8000-000000000001";
  await pool.query("INSERT INTO businesses(id,name,settings) VALUES(?,?,?)", [business, "Catalog", "{}"]);
  await pool.query("INSERT INTO categories(id,business_id,name) VALUES(?,?,?)", ["category", business, "Meals"]);
  const app = Fastify();
  const originalGetConnection = pool.getConnection;
  let releaseValidation;
  let reachedValidation;
  const paused = new Promise((resolve) => { reachedValidation = resolve; });
  const resume = new Promise((resolve) => { releaseValidation = resolve; });
  try {
    await app.register(sensible);
    await app.register(catalogRoutes);
    pool.getConnection = async () => {
      const connection = await originalGetConnection.call(pool);
      const query = connection.query;
      connection.query = async (sql, values) => {
        const result = await query(sql, values);
        if (String(sql).startsWith("SELECT id FROM categories")) { reachedValidation(); await resume; }
        return result;
      };
      return connection;
    };
    const headers = { "x-food-system-local": "true" };
    const create = app.inject({ method: "POST", url: `/api/v1/businesses/${business}/products`, headers, payload: { name: "Meal", price: 10, category_id: "category" } });
    await paused;
    const deactivate = app.inject({ method: "PATCH", url: `/api/v1/businesses/${business}/categories/category`, headers, payload: { active: false } });
    const early = await Promise.race([deactivate.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 50))]);
    assert.equal(early, false);
    releaseValidation();
    assert.equal((await create).statusCode, 201);
    assert.equal((await deactivate).statusCode, 200);
    const rejected = await app.inject({ method: "POST", url: `/api/v1/businesses/${business}/products`, headers, payload: { name: "Late", price: 10, category_id: "category" } });
    assert.equal(rejected.statusCode, 400);
  } finally {
    releaseValidation();
    pool.getConnection = originalGetConnection;
    await app.close();
  }
});
