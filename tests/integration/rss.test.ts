import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("GET /rss.xml", () => {
  it("serves an Atom feed with full content", async () => {
    await createPost(env.DB, {
      slug: "hello-world",
      title: "Hello World",
      source: "# Hello",
      rendered: "<h1>Hello</h1><p>Body text.</p>",
      hasMath: false,
      tags: [],
    });

    const res = await app.request("/rss.xml", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/atom+xml");

    const xml = await res.text();
    expect(xml).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
    expect(xml).toContain("<title>Hello World</title>");
    expect(xml).toContain("Body text.");
    expect(xml).toContain("<id>https://example.com/hello-world</id>");
  });
});
