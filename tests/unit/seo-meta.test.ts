import { describe, it, expect } from "vitest";
import { buildDescription, absoluteUrl, buildBlogPostingJsonLd } from "../../src/seo/meta";

describe("buildDescription", () => {
  it("strips HTML tags", () => {
    expect(buildDescription("<p>Hello <strong>world</strong>.</p>")).toBe("Hello world.");
  });

  it("collapses whitespace and newlines", () => {
    expect(buildDescription("<p>Hello\n\n  world</p>")).toBe("Hello world");
  });

  it("does not truncate content shorter than the limit", () => {
    expect(buildDescription("<p>Short post.</p>", 155)).toBe("Short post.");
  });

  it("truncates at a word boundary and appends an ellipsis", () => {
    const long = "<p>" + "word ".repeat(60).trim() + "</p>";
    const result = buildDescription(long, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith("…")).toBe(true);
    expect(result.endsWith(" …")).toBe(false);
  });
});

describe("absoluteUrl", () => {
  it("joins a site URL and path without double slashes", () => {
    expect(absoluteUrl("https://example.com", "/my-post")).toBe("https://example.com/my-post");
    expect(absoluteUrl("https://example.com/", "/my-post")).toBe("https://example.com/my-post");
  });
});

describe("buildBlogPostingJsonLd", () => {
  it("produces valid JSON with BlogPosting type", () => {
    const json = buildBlogPostingJsonLd({
      url: "https://example.com/my-post",
      title: "My Post",
      description: "A post.",
      datePublished: "2026-07-01T00:00:00.000Z",
      dateModified: "2026-07-02T00:00:00.000Z",
      author: "Jane Doe",
    });
    const parsed = JSON.parse(json);
    expect(parsed["@type"]).toBe("BlogPosting");
    expect(parsed.headline).toBe("My Post");
    expect(parsed.author).toEqual({ "@type": "Person", name: "Jane Doe" });
  });
});
