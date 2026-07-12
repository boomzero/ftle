import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("robots.txt and sitemap.xml", () => {
  it("GET /robots.txt disallows /admin and points at the sitemap", async () => {
    const res = await app.request("/robots.txt", {}, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Disallow: /admin");
    expect(text).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("GET /sitemap.xml lists the homepage and every post", async () => {
    await createPost(env.DB, {
      slug: "hello-world",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["intro"],
      status: "listed",
    });
    const res = await app.request("/sitemap.xml", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/hello-world</loc>");
    expect(xml).toContain("<loc>https://example.com/tag/intro</loc>");
  });

  it("GET /sitemap.xml URL-encodes an & in a tag name so the sitemap stays well-formed XML and a valid link", async () => {
    await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["R&D"],
      status: "listed",
    });
    const res = await app.request("/sitemap.xml", {}, env);
    const xml = await res.text();
    expect(xml).toContain("<loc>https://example.com/tag/R%26D</loc>");
    expect(xml).not.toContain("<loc>https://example.com/tag/R&D</loc>");
  });
});
