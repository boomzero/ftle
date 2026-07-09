import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost, getPostById } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

describe("POST /admin/delete/:id", () => {
  it("deletes the post; it disappears from the public site", async () => {
    const post = await createPost(env.DB, {
      slug: "to-delete",
      title: "Bye",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: ["temp"],
    });
    const headers = await authedHeaders();
    const res = await app.request(`/admin/delete/${post.id}`, { method: "POST", headers }, env);
    expect(res.status).toBe(303);

    expect(await getPostById(env.DB, post.id)).toBeNull();
    const publicRes = await app.request("/to-delete", {}, env);
    expect(publicRes.status).toBe(404);
  });

  it("returns 404 when deleting a nonexistent post", async () => {
    const headers = await authedHeaders();
    const res = await app.request("/admin/delete/99999", { method: "POST", headers }, env);
    expect(res.status).toBe(404);
  });
});
