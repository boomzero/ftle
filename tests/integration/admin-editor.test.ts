import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("admin editor pages", () => {
  it("GET /admin/new returns an empty editor form", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/new", { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain('name="title"');
    expect(html).toContain('name="slug"');
    expect(html).toContain('name="tags"');
  });

  it("GET /admin/edit/:id returns the form pre-filled with source", async () => {
    const post = await createPost(env.DB, {
      slug: "hello",
      title: "Hello",
      source: "# Hello\n\nbody",
      rendered: "<h1>Hello</h1><p>body</p>",
      hasMath: false,
      tags: ["a", "b"],
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("# Hello");
    expect(html).toContain('value="hello"');
    expect(html).toContain('value="a, b"');
  });

  it("GET /admin/edit/:id returns 404 for a nonexistent id", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/edit/99999", { headers }, env);
    expect(res.status).toBe(404);
  });
});
