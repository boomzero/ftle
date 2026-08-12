import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { authedHeaders } from "../helpers/access-token";

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

describe("admin CSRF protection", () => {
  it("rejects a POST from a cross-site Origin even with a valid Access identity", async () => {
    const headers = await authedHeaders();
    const res = await app.request(
      "/admin/rerender",
      { method: "POST", headers: { ...headers, Origin: "https://attacker.example" } },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a POST with no Origin header at all", async () => {
    const headers = await authedHeaders();
    delete (headers as Record<string, string>).Origin;
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(403);
  });

  it("allows a POST whose Origin matches SITE_URL", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(303);
  });

  it("does not require an Origin header for GET requests", async () => {
    const headers = await authedHeaders();
    delete (headers as Record<string, string>).Origin;
    const res = await app.request("/admin", { headers }, env);
    expect(res.status).toBe(200);
  });
});
