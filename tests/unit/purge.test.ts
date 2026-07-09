import { describe, it, expect } from "vitest";
import { computePurgePaths } from "../../src/cache/purge";

describe("computePurgePaths", () => {
  it("always includes root, rss, and sitemap", () => {
    const paths = computePurgePaths({ postPath: "/hello", oldTags: [], newTags: [] });
    expect(paths).toEqual(expect.arrayContaining(["/", "/rss.xml", "/sitemap.xml", "/hello"]));
  });

  it("includes both old and new tag pages, deduplicated", () => {
    const paths = computePurgePaths({
      postPath: "/hello",
      oldTags: ["a", "b"],
      newTags: ["b", "c"],
    });
    const tagPaths = paths.filter((p) => p.startsWith("/tag/"));
    expect(tagPaths.sort()).toEqual(["/tag/a", "/tag/b", "/tag/c"]);
  });
});
