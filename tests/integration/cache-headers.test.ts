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
      // CDN-Cache-Control gives explicit Cloudflare CDN caching directives.
      expect(res.headers.get("CDN-Cache-Control")).toContain("max-age=31536000");
    }
  });

  it("public pages carry a Cache-Tag matching their content type", async () => {
    await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["javascript"],
    });
    expect((await app.request("/", {}, env)).headers.get("Cache-Tag")).toBe("home");
    expect((await app.request("/hello", {}, env)).headers.get("Cache-Tag")).toBe("post");
    expect((await app.request("/tag/javascript", {}, env)).headers.get("Cache-Tag")).toBe("tag");
    expect((await app.request("/rss.xml", {}, env)).headers.get("Cache-Tag")).toBe("rss");
    expect((await app.request("/sitemap.xml", {}, env)).headers.get("Cache-Tag")).toBe("seo");
  });

  it("admin responses are never cached", async () => {
    const res = await app.request("/admin", {}, env);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
