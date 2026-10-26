/**
 * app.test.ts
 *
 * WHAT: Automated checks for app.ts. Run them with `npm test`.
 *       `inject` sends a fake request straight into the server, no network needed.
 * NOTE: The database tests use the separate "split_test" database.
 */
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";
import { createSql } from "./db";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

describe("GET /health", () => {
  it("says the server is ok, and can use @split/core", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", sample: "₱1,234.56" });
    await app.close();
  });

  it("answers 404 for a route that does not exist", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/nope" });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /health/db", () => {
  // It used to tell anyone whether the database was up. It's gone from the public API now.
  it("is no longer public", async () => {
    const sql = createSql(testDatabaseUrl);
    const app = buildApp({ sql });
    const res = await app.inject({ method: "GET", url: "/health/db" });

    expect(res.statusCode).toBe(404);
    await app.close();
    await sql.end();
  });
});