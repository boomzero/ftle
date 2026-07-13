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
    expect(html).toMatch(/<html lang="en" class="[^"]*">/);
    expect(html).toContain("<style>");
    expect(html).not.toContain('rel="stylesheet" href="http');
  });

  it("renders no extra nav links by default", () => {
    const html = renderLayout(baseOpts);
    const nav = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/)![0];
    expect(nav.match(/<a /g)).toHaveLength(2);
  });

  it("renders custom nav links when navLinks is provided", () => {
    const html = renderLayout({
      ...baseOpts,
      navLinks: [
        { label: "Twig", url: "https://twig.example.com" },
        { label: "Sinv", url: "https://sinv.example.com" },
      ],
    });
    expect(html).toMatch(/<nav[^>]*>[\s\S]*<a[^>]*href="https:\/\/twig\.example\.com"[^>]*>Twig<\/a>[\s\S]*<\/nav>/);
    expect(html).toMatch(/<nav[^>]*>[\s\S]*<a[^>]*href="https:\/\/sinv\.example\.com"[^>]*>Sinv<\/a>[\s\S]*<\/nav>/);
  });

  it("escapes nav link label and url", () => {
    const html = renderLayout({
      ...baseOpts,
      navLinks: [{ label: "<script>1</script>", url: 'https://example.com/"onmouseover=alert(1)' }],
    });
    expect(html).not.toContain("<script>1</script>");
    expect(html).not.toContain('href="https://example.com/"onmouseover=alert(1)"');
  });

  it("puts the background/text color on <html>, not just the centered <body> column, so it fills the full viewport instead of stopping at the content's max-width", () => {
    const html = renderLayout(baseOpts);
    const htmlTagMatch = html.match(/<html lang="en" class="([^"]*)">/);
    expect(htmlTagMatch).not.toBeNull();
    const htmlClasses = htmlTagMatch![1];
    expect(htmlClasses).toContain("bg-white");
    expect(htmlClasses).toContain("dark:bg-gray-950");
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

  it("escapes special characters in the title instead of breaking out of the <title> element", () => {
    const html = renderLayout({ ...baseOpts, pageTitle: "C++ & </title><script>1</script>" });
    expect(html).not.toContain("</title><script>");
    expect(html).toContain("C++ &amp; &lt;/title&gt;&lt;script&gt;1&lt;/script&gt;");
  });

  it("escapes a literal </script> inside jsonLd so it can't terminate the script tag early", () => {
    const html = renderLayout({
      ...baseOpts,
      jsonLd: '{"headline":"a</script><script>alert(1)</script>"}',
    });
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain('"headline":"a\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"');
  });

  // Assert on the <body> tag's class list, not the whole HTML: the compiled
  // Tailwind CSS is inlined into every page and mentions both class names.
  it("keeps the default max-w-4xl container when wide is not set", () => {
    const html = renderLayout(baseOpts);
    const bodyClasses = html.match(/<body class="([^"]*)"/)![1];
    expect(bodyClasses).toContain("max-w-4xl");
    expect(bodyClasses).not.toContain("max-w-7xl");
  });

  it("uses a max-w-7xl container when wide is true", () => {
    const html = renderLayout({ ...baseOpts, wide: true });
    const bodyClasses = html.match(/<body class="([^"]*)"/)![1];
    expect(bodyClasses).toContain("max-w-7xl");
    expect(bodyClasses).not.toContain("max-w-4xl");
  });
});
