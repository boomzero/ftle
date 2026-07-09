import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost, getPostBySlug } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
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
