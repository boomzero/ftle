import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("Cache-Control headers", () => {
  it("public pages carry a long edge TTL with a short browser TTL", async () => {
    await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: [],
    });
    for (const path of ["/", "/hello", "/rss.xml", "/sitemap.xml", "/robots.txt"]) {
      const res = await app.request(path, {}, env);
      const cc = res.headers.get("Cache-Control") ?? "";
      expect(cc).toContain("public");
      expect(cc).toContain("s-maxage=31536000");
    }
  });

  it("admin responses are never cached", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
