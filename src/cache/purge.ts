import { cache } from "cloudflare:workers";

/** Cache-Tag values that should be purged for any post mutation (create, update, delete). */
export const ALL_PURGE_TAGS = ["home", "post", "tag", "rss", "seo"];

export function computePurgePaths(opts: {
  postPath: string;
  oldTags: string[];
  newTags: string[];
}): string[] {
  const tagPaths = Array.from(new Set([...opts.oldTags, ...opts.newTags])).map(
    (tag) => `/tag/${encodeURIComponent(tag)}`,
  );
  return ["/", "/rss.xml", "/sitemap.xml", opts.postPath, ...tagPaths];
}

export async function purgePaths(paths: string[]): Promise<void> {
  if (typeof cache?.purge !== "function") {
    console.warn("cache.purge unavailable in this environment; skipping purge for", paths);
    return;
  }
  // Purge by tags (primary — works against the CDN cache layer) AND by path
  // prefixes (fallback — purges the Workers cache layer). Using both covers
  // the two cache layers that Cloudflare maintains separately.
  const result = await cache.purge({ tags: ALL_PURGE_TAGS, pathPrefixes: paths });
  if (!result.success) {
    console.error("Cache purge failed", result.errors);
  }
}
