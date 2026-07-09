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
});
