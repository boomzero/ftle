// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";

describe("smoke", () => {
  it("responds on /", async () => {
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
  });
});
