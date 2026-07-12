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
  it("GET /admin/new returns an empty editor form headed 'New Post'", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/new", { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain('name="title"');
    expect(html).toContain('name="slug"');
    expect(html).toContain('name="tags"');
    expect(html).toMatch(/<h1[^>]*>New Post<\/h1>/);
  });

  it("GET /admin/new preselects the status selector to draft", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/new", { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // The draft option must be selected, not just present.
    expect(html).toContain('name="status"');
    expect(html).toContain('value="draft" selected');
  });

  it("GET /admin/edit/:id returns the form pre-filled with source, headed 'Edit Post'", async () => {
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
    expect(html).toMatch(/<h1[^>]*>Edit Post<\/h1>/);
  });

  it("GET /admin/edit/:id returns 404 for a nonexistent id", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/edit/99999", { headers }, env);
    expect(res.status).toBe(404);
  });

  it("GET /admin/edit/:id escapes a title/source that would otherwise break the form's HTML", async () => {
    const post = await createPost(env.DB, {
      slug: "hello",
      title: 'Say "hi" & bye',
      source: "before </textarea><script>alert(1)</script> after",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: [],
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    const html = await res.text();
    expect(html).toContain('value="Say &quot;hi&quot; &amp; bye"');
    expect(html).not.toContain("</textarea><script>alert(1)</script>");
    expect(html).toContain("before &lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt; after");
  });

  it("GET /admin/edit/:id preselects the status selector for a listed post", async () => {
    const post = await createPost(env.DB, {
      slug: "listed-post",
      title: "Listed Post",
      source: "test",
      rendered: "<p>test</p>",
      hasMath: false,
      tags: [],
      status: "listed",
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    const html = await res.text();
    expect(html).toContain('name="status"');
    expect(html).toContain('value="listed" selected');
  });

  it("GET /admin/edit/:id preselects the status selector for an unlisted post", async () => {
    const post = await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted Post",
      source: "test",
      rendered: "<p>test</p>",
      hasMath: false,
      tags: [],
      status: "unlisted",
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    const html = await res.text();
    expect(html).toContain('name="status"');
    expect(html).toContain('value="unlisted" selected');
  });

  it("GET /admin/edit/:id preselects the status selector for a draft post", async () => {
    const post = await createPost(env.DB, {
      slug: "draft-post",
      title: "Draft Post",
      source: "test",
      rendered: "<p>test</p>",
      hasMath: false,
      tags: [],
      status: "draft",
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/edit/${post.id}`, { headers }, env);
    const html = await res.text();
    expect(html).toContain('name="status"');
    expect(html).toContain('value="draft" selected');
  });
});
