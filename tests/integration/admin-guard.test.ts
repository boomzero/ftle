import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";

describe("admin guard", () => {
  it("returns 403 without a Cf-Access-Jwt-Assertion header", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.status).toBe(403);
  });

  it("sets X-Robots-Tag noindex on admin responses", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
