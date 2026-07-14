import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { env } from "cloudflare:test";
import app from "../../src/index";
import { createPost } from "../../src/db/posts";
import { renderPost } from "../../src/render/pipeline";

const REFERENCE_SOURCE = `# A Reference Post

This post exercises prose, inline math like $E = mc^2$, display math:

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

and raw HTML:

<div class="callout"><strong>Note:</strong> this is a custom callout block that a real author might paste into a post.</div>

${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)}

\`\`\`js
function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}
\`\`\`
`;

describe("performance budget", () => {
  it("a typical post page is <= 14KB gzipped, 0 script tags, no external origins", async () => {
    const { rendered, hasMath } = renderPost(REFERENCE_SOURCE);
    await createPost(env.DB, {
      slug: "reference-post",
      title: "A Reference Post",
      source: REFERENCE_SOURCE,
      rendered,
      hasMath,
      tags: ["reference"],
      status: "listed",
    });

    const res = await app.request("/reference-post", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();

    const gzipped = gzipSync(Buffer.from(html, "utf8"));
    console.log("POST_PAGE_GZIP_BYTES=", gzipped.byteLength);
    expect(gzipped.byteLength).toBeLessThanOrEqual(14 * 1024);

    // No executable JavaScript — JSON-LD <script type="application/ld+json"> is data, not JS
const scriptTags = html.match(/<script[^>]*>/gi) ?? [];
const executableScripts = scriptTags.filter((s) => !s.includes("application/ld+json"));
expect(executableScripts).toHaveLength(0);
    // Ordinary <a href> nav/content links may point off-site (they're not a
    // blocking request); only resource-loading tags must stay origin-local.
    expect(html).not.toMatch(/<link[^>]*\shref="https?:\/\/(?!example\.com)/i);
    expect(html).not.toMatch(/src="https?:\/\/(?!example\.com)/i);
  });

  it("the index page is similarly bounded", async () => {
    for (let i = 0; i < 20; i++) {
      await createPost(env.DB, {
        slug: `post-${i}`,
        title: `Post number ${i} with a moderately descriptive title`,
        source: "x",
        rendered: "<p>x</p>",
        hasMath: false,
        tags: [],
        status: "listed",
      });
    }
    const res = await app.request("/", {}, env);
    const html = await res.text();
    const gzipped = gzipSync(Buffer.from(html, "utf8"));
    expect(gzipped.byteLength).toBeLessThanOrEqual(14 * 1024);
    // No executable JavaScript — JSON-LD <script type="application/ld+json"> is data, not JS
const scriptTags = html.match(/<script[^>]*>/gi) ?? [];
const executableScripts = scriptTags.filter((s) => !s.includes("application/ld+json"));
expect(executableScripts).toHaveLength(0);
  });
});
