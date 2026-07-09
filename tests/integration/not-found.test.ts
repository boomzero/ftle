import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";

describe("404 handling", () => {
  it("returns a 404 page for an unknown slug", async () => {
    const res = await app.request("/nope", {}, env);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("404");
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("returns a 404 page for a totally unmatched path", async () => {
    const res = await app.request("/deeply/nested/nothing", {}, env);
    expect(res.status).toBe(404);
  });
});
