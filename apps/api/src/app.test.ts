/**
 * app.test.ts
 *
 * WHAT: Automated checks for app.ts. Run them with `npm test`.
 *       `inject` sends a fake request straight into the server, no network needed.
 */
import { describe, it, expect } from "vitest";
import { buildApp } from "./app";

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