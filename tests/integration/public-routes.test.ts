import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM post_tags").run();
  await env.DB.prepare("DELETE FROM posts").run();
});

async function seedPost(overrides: Partial<Parameters<typeof createPost>[1]> = {}) {
  return createPost(env.DB, {
    slug: "hello-world",
    title: "Hello World",
    source: "# Hello\n\nWorld.",
    rendered: "<h1>Hello</h1><p>World.</p>",
    hasMath: false,
    tags: ["intro"],
    ...overrides,
  });
}

describe("public routes", () => {
  it("GET / lists posts newest-first with title and date", async () => {
    await seedPost({ slug: "first" });
    await new Promise((r) => setTimeout(r, 10));
    await seedPost({ slug: "second" });

    const res = await app.request("/", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.indexOf("second")).toBeLessThan(html.indexOf("first"));
  });

  it("GET /:slug renders the post with SEO tags", async () => {
    await seedPost();
    const res = await app.request("/hello-world", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain('<link rel="canonical" href="https://example.com/hello-world">');
  });

  it("GET /:slug returns 404 for an unknown slug", async () => {
    const res = await app.request("/does-not-exist", {}, env);
    expect(res.status).toBe(404);
  });

  it("GET /:slug labels a post's tags and renders each as a pill-styled link, not a bare gray link", async () => {
    await seedPost({ tags: ["intro", "demo"] });
    const res = await app.request("/hello-world", {}, env);
    const html = await res.text();
    expect(html).toContain("Tags:");
    expect(html).toMatch(/<a class="[^"]*rounded-full[^"]*" href="\/tag\/intro">intro<\/a>/);
    expect(html).toMatch(/<a class="[^"]*rounded-full[^"]*" href="\/tag\/demo">demo<\/a>/);
  });

  it("GET /:slug omits the Tags: label entirely when a post has no tags", async () => {
    await seedPost({ tags: [] });
    const res = await app.request("/hello-world", {}, env);
    const html = await res.text();
    expect(html).not.toContain("Tags:");
  });

  it("GET /tag/:tag lists only posts with that tag", async () => {
    await seedPost({ slug: "a", tags: ["x"] });
    await seedPost({ slug: "b", tags: ["y"] });
    const res = await app.request("/tag/x", {}, env);
    const html = await res.text();
    expect(html).toContain("a");
    expect(html).not.toContain(">b<");
  });

  it("GET /tag/:tag escapes an HTML-injecting tag instead of reflecting it raw", async () => {
    const res = await app.request(
      "/tag/" + encodeURIComponent('<img src=x onerror=alert(1)>'),
      {},
      env,
    );
    const html = await res.text();
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("post page includes the KaTeX stylesheet only when has_math is set", async () => {
    await seedPost({ slug: "math-post", hasMath: true, rendered: '<span class="katex">x</span>' });
    await seedPost({ slug: "no-math-post" });

    const mathRes = await app.request("/math-post", {}, env);
    expect(await mathRes.text()).toMatch(/rel="stylesheet" href="\/katex\./);

    const plainRes = await app.request("/no-math-post", {}, env);
    expect(await plainRes.text()).not.toContain("katex.");
  });
});
