import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost, getPostBySlug } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("GET /admin", () => {
  it("renders a button that posts to /admin/rerender", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin", { headers }, env);
    const html = await res.text();
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/admin\/rerender"/);
    expect(html).toContain("Rerender all posts");
  });
});

describe("POST /admin/rerender", () => {
  it("re-renders every post from its stored source", async () => {
    await createPost(env.DB, {
      slug: "a",
      title: "A",
      source: "# A",
      rendered: "<h1>stale</h1>",
      hasMath: false,
      tags: [],
    });
    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(303);

    const post = await getPostBySlug(env.DB, "a");
    expect(post?.rendered).toContain("<h1>A</h1>");
  });

  it("leaves updated_at untouched (rerender is not a content change)", async () => {
    const created = await createPost(env.DB, {
      slug: "a",
      title: "A",
      source: "# A",
      rendered: "<h1>stale</h1>",
      hasMath: false,
      tags: [],
    });
    await env.DB
      .prepare("UPDATE posts SET updated_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", created.id)
      .run();

    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(303);

    const post = await getPostBySlug(env.DB, "a");
    expect(post?.rendered).toContain("<h1>A</h1>");
    expect(post?.updated_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("reports failure instead of a 500 when the DB write itself fails", async () => {
    await createPost(env.DB, {
      slug: "a",
      title: "A",
      source: "# A",
      rendered: "<h1>stale</h1>",
      hasMath: false,
      tags: [],
    });

    const batchSpy = vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("boom"));
    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    batchSpy.mockRestore();

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("boom");

    // The write never committed, so the stale content is still there.
    const post = await getPostBySlug(env.DB, "a");
    expect(post?.rendered).toBe("<h1>stale</h1>");
  });

  it("re-renders the other posts even when one post's source now fails to render", async () => {
    await createPost(env.DB, {
      slug: "good",
      title: "Good",
      source: "# Good",
      rendered: "<h1>stale</h1>",
      hasMath: false,
      tags: [],
    });
    await createPost(env.DB, {
      slug: "bad",
      title: "Bad",
      source: "Bad math: $\\frac{1}$",
      rendered: "<p>stale</p>",
      hasMath: false,
      tags: [],
    });
    const headers = await authedHeaders();
    const res = await app.request("/admin/rerender", { method: "POST", headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("bad");

    const good = await getPostBySlug(env.DB, "good");
    expect(good?.rendered).toContain("<h1>Good</h1>");
    const bad = await getPostBySlug(env.DB, "bad");
    expect(bad?.rendered).toBe("<p>stale</p>");
  });
});
