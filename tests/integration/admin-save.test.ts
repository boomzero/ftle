import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { authedHeaders } from "../helpers/access-token";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

function formBody(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

describe("POST /admin/save", () => {
  it("creates a new post and the public page reflects it", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New Post", slug: "new-post", tags: "a, b", source: "# New" }) },
      env,
    );
    expect(res.status).toBe(303);

    const publicRes = await app.request("/new-post", {}, env);
    expect(publicRes.status).toBe(200);
    expect(await publicRes.text()).toContain("<h1>New</h1>");
  });

  it("rejects a duplicate slug on create, preserving the submitted source", async () => {
    await createPost(env.DB, {
      slug: "taken",
      title: "Existing",
      source: "x",
      rendered: "<p>x</p>",
      hasMath: false,
      tags: [],
    });
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New", slug: "taken", tags: "", source: "my draft text" }) },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("slug");
    expect(html).toContain("my draft text");
  });

  it("rejects invalid latex, preserving the submitted source", async () => {
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      "/admin/save",
      { method: "POST", headers, body: formBody({ title: "New", slug: "bad-math", tags: "", source: "Bad: $\\frac{1}$" }) },
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("error");
    expect(html).toContain("Bad: $\\frac{1}$");
  });

  it("updates an existing post via ?id=", async () => {
    const post = await createPost(env.DB, {
      slug: "editable",
      title: "Before",
      source: "before",
      rendered: "<p>before</p>",
      hasMath: false,
      tags: ["old-tag"],
    });
    const headers = { ...(await authedHeaders()), "Content-Type": "application/x-www-form-urlencoded" };
    const res = await app.request(
      `/admin/save?id=${post.id}`,
      { method: "POST", headers, body: formBody({ title: "After", slug: "editable", tags: "new-tag", source: "# After" }) },
      env,
    );
    expect(res.status).toBe(303);
    const publicRes = await app.request("/editable", {}, env);
    expect(await publicRes.text()).toContain("<h1>After</h1>");
  });
});
