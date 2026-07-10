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

describe("unlisted posts", () => {
  it("GET / excludes unlisted posts", async () => {
    await createPost(env.DB, {
      slug: "listed-post",
      title: "Listed",
      source: "listed",
      rendered: "<p>listed</p>",
      hasMath: false,
      tags: [],
    });
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: [],
      listed: false,
    });

    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("listed-post");
    expect(html).not.toContain("unlisted-post");
  });

  it("GET /tag/:tag excludes unlisted posts", async () => {
    await createPost(env.DB, {
      slug: "listed-post",
      title: "Listed",
      source: "listed",
      rendered: "<p>listed</p>",
      hasMath: false,
      tags: ["shared"],
    });
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: ["shared"],
      listed: false,
    });

    const res = await app.request("/tag/shared", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("listed-post");
    expect(html).not.toContain("unlisted-post");
  });

  it("GET /:slug still serves an unlisted post", async () => {
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: [],
      listed: false,
    });

    const res = await app.request("/unlisted-post", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Unlisted");
  });

  it("GET /rss.xml excludes unlisted posts", async () => {
    await createPost(env.DB, {
      slug: "listed-post",
      title: "Listed",
      source: "listed",
      rendered: "<p>listed</p>",
      hasMath: false,
      tags: [],
    });
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: [],
      listed: false,
    });

    const res = await app.request("/rss.xml", {}, env);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("listed-post");
    expect(xml).not.toContain("unlisted-post");
  });

  it("GET /sitemap.xml excludes unlisted posts", async () => {
    await createPost(env.DB, {
      slug: "listed-post",
      title: "Listed",
      source: "listed",
      rendered: "<p>listed</p>",
      hasMath: false,
      tags: [],
    });
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: [],
      listed: false,
    });

    const res = await app.request("/sitemap.xml", {}, env);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("listed-post");
    expect(xml).not.toContain("unlisted-post");
  });

  it("POST /admin/toggle-listed/:id toggles a post from listed to unlisted", async () => {
    const post = await createPost(env.DB, {
      slug: "toggle-me",
      title: "Toggle Me",
      source: "test",
      rendered: "<p>test</p>",
      hasMath: false,
      tags: ["tag-a"],
    });

    // Post initially appears on home
    let res = await app.request("/", {}, env);
    expect((await res.text())).toContain("toggle-me");

    // Toggle to unlisted
    const headers = await authedHeaders();
    res = await app.request(
      `/admin/toggle-listed/${post.id}`,
      { method: "POST", headers },
      env,
    );
    expect(res.status).toBe(303);

    // Post no longer appears on home
    res = await app.request("/", {}, env);
    expect((await res.text())).not.toContain("toggle-me");

    // Post still accessible via direct URL
    res = await app.request("/toggle-me", {}, env);
    expect(res.status).toBe(200);
  });

  it("POST /admin/toggle-listed/:id toggles a post back to listed", async () => {
    const post = await createPost(env.DB, {
      slug: "toggle-me",
      title: "Toggle Me",
      source: "test",
      rendered: "<p>test</p>",
      hasMath: false,
      tags: ["tag-a"],
      listed: false,
    });

    // Toggle back to listed
    const headers = await authedHeaders();
    const res = await app.request(
      `/admin/toggle-listed/${post.id}`,
      { method: "POST", headers },
      env,
    );
    expect(res.status).toBe(303);

    // Post now appears on home
    const home = await app.request("/", {}, env);
    expect((await home.text())).toContain("toggle-me");
  });

  it("POST /admin/toggle-listed/:id returns 404 for nonexistent post", async () => {
    const headers = await authedHeaders();
    const res = await app.request(
      "/admin/toggle-listed/99999",
      { method: "POST", headers },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("GET /admin shows unlisted posts", async () => {
    await createPost(env.DB, {
      slug: "unlisted-post",
      title: "Unlisted Post",
      source: "unlisted",
      rendered: "<p>unlisted</p>",
      hasMath: false,
      tags: [],
      listed: false,
    });

    const headers = await authedHeaders();
    const res = await app.request("/admin", { headers }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Unlisted Post");
    expect(html).toContain("unlisted");
  });
});
