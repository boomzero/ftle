import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { authedHeaders } from "../helpers/access-token";

describe("POST /admin/preview", () => {
  it("returns rendered HTML for valid source", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/preview",
      { method: "POST", headers, body: "source=" + encodeURIComponent("# Hi") },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>Hi</h1>");
  });

  it("shows an error message without a 500 for invalid latex", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/preview",
      { method: "POST", headers, body: "source=" + encodeURIComponent("Bad: $\\frac{1}$") },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("error");
  });
});
