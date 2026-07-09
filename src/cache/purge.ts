import { cache } from "cloudflare:workers";

export function computePurgePaths(opts: {
  postPath: string;
  oldTags: string[];
  newTags: string[];
}): string[] {
  const tagPaths = Array.from(new Set([...opts.oldTags, ...opts.newTags])).map(
    (tag) => `/tag/${tag}`,
  );
  return ["/", "/rss.xml", "/sitemap.xml", opts.postPath, ...tagPaths];
}

export async function purgePaths(paths: string[]): Promise<void> {
  if (typeof cache?.purge !== "function") {
    console.warn("cache.purge unavailable in this environment; skipping purge for", paths);
    return;
  }
  const result = await cache.purge({ pathPrefixes: paths });
  if (!result.success) {
    console.error("Cache purge failed", result.errors);
  }
}
