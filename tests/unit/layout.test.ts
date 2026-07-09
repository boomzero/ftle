import { describe, it, expect } from "vitest";
import { renderLayout } from "../../src/layout";

const baseOpts = {
  siteTitle: "ftle",
  pageTitle: "My Post",
  description: "A post about things.",
  canonicalUrl: "https://example.com/my-post",
  bodyHtml: "<article>Hello</article>",
};

describe("renderLayout", () => {
  it("includes title, meta description, and canonical link", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain("<title>My Post — ftle</title>");
    expect(html).toContain('<meta name="description" content="A post about things.">');
    expect(html).toContain('<link rel="canonical" href="https://example.com/my-post">');
  });

  it("has html lang attribute and inlined CSS, no external stylesheet by default", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<style>");
    expect(html).not.toContain('rel="stylesheet" href="http');
  });

  it("omits the KaTeX link when hasMath is false", () => {
    const html = renderLayout(baseOpts);
    expect(html).not.toContain("katex");
  });

  it("includes the KaTeX link when hasMath is true", () => {
    const html = renderLayout({ ...baseOpts, hasMath: true, katexCssPath: "/katex.abc123.css" });
    expect(html).toContain('<link rel="stylesheet" href="/katex.abc123.css">');
  });

  it("includes JSON-LD when provided", () => {
    const html = renderLayout({ ...baseOpts, jsonLd: '{"@type":"BlogPosting"}' });
    expect(html).toContain('<script type="application/ld+json">{"@type":"BlogPosting"}</script>');
  });

  it("includes noindex meta when noindex is true", () => {
    const html = renderLayout({ ...baseOpts, noindex: true });
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("includes OpenGraph and Twitter card tags", () => {
    const html = renderLayout({ ...baseOpts, ogType: "article" });
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:title" content="My Post">');
    expect(html).toContain('<meta property="og:description" content="A post about things.">');
    expect(html).toContain('<meta property="og:url" content="https://example.com/my-post">');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it("includes an RSS autodiscovery link when rssUrl is provided", () => {
    const html = renderLayout({ ...baseOpts, rssUrl: "https://example.com/rss.xml" });
    expect(html).toContain(
      '<link rel="alternate" type="application/atom+xml" href="https://example.com/rss.xml">',
    );
  });

  it("embeds bodyHtml verbatim inside body", () => {
    const html = renderLayout(baseOpts);
    expect(html).toContain("<article>Hello</article>");
  });
});
