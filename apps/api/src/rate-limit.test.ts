/**
 * rate-limit.test.ts
 *
 * WHAT: Tests for the rate limiter, the login-email limit, and the browser safety headers.
 * RUN:  npm test (from apps/api)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { createSql, type Sql } from "./db";
import { createRateLimiter } from "./rate-limit";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/split_test";

describe("createRateLimiter", () => {
  it("allows up to the limit, then refuses", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 1000 }, () => 0);

    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a"), limiter.allow("a")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("counts each key separately", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, () => 0);

    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
  });

  it("starts counting again once the window has passed", () => {
    let t = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, () => t);

    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    t = 1000;
    expect(limiter.allow("a")).toBe(true);
  });
});

describe("the API's safety headers and login limit", () => {
  let app: FastifyInstance;
  let sql: Sql;
  const sent: string[] = [];

  beforeAll(async () => {
    sql = createSql(DATABASE_URL);
    app = buildApp({
      logger: false,
      sql,
      mailer: async (to) => {
        sent.push(to);
      },
      appUrl: "http://localhost:5173",
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it("every response carries the safety headers", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("a fourth login link for the same address in 15 minutes is refused", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/request",
        payload: { email: "flood@example.com" },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual([202, 202, 202, 429]);
    expect(sent).toHaveLength(3);
  });
});
