/**
 * log.test.ts
 * Checks that share-link tokens never reach the request log.
 */
import { describe, expect, it } from "vitest";
import { redactUrl, requestLogSerializer } from "./log";

describe("redactUrl", () => {
  it("hides the token in a share link", () => {
    expect(redactUrl("/join/abcdefghijklmnopqrstuvwxyz0123456789/expenses/e1")).toBe(
      "/join/[redacted]/expenses/e1",
    );
  });

  it("hides the token when the link has a query string", () => {
    expect(redactUrl("/join/SECRETTOKEN123456789012?x=1")).toBe("/join/[redacted]?x=1");
  });

  it("leaves other paths alone", () => {
    expect(redactUrl("/groups/123/expenses")).toBe("/groups/123/expenses");
  });
});

describe("requestLogSerializer", () => {
  it("keeps the method and the redacted URL only", () => {
    expect(requestLogSerializer({ method: "GET", url: "/join/SECRETTOKEN123456789012" })).toEqual({
      method: "GET",
      url: "/join/[redacted]",
    });
  });
});
