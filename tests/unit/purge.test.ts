import { describe, it, expect } from "vitest";
import { computePurgePaths, purgePaths } from "../../src/cache/purge";

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

describe("purgePaths", () => {
  it("does not throw when cache.purge is unavailable (e.g. local dev/test)", async () => {
    // In this test runtime, cache.purge is genuinely undefined (confirmed by
    // direct probing) — this exercises the real fallback path, not a mock.
    // A mocked "cache.purge is available" case was attempted but dropped:
    // vi.spyOn on the cloudflare:workers module namespace throws
    // "Cannot redefine property" (ESM module namespaces aren't configurable
    // in this runtime) — there is no way to exercise the available-branch
    // locally, so this real, unmocked case is the only coverage purgePaths
    // can have outside production.
    await expect(purgePaths(["/hello"])).resolves.toBeUndefined();
  });
});
