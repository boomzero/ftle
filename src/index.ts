import { Hono } from "hono";
import { rssRoutes } from "./routes/rss";
import { seoFileRoutes } from "./routes/seo-files";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { renderLayout } from "./layout";
import { absoluteUrl } from "./seo/meta";

/** Maps a request path to a Cache-Tag value for CDN cache invalidation. */
function cacheTagForPath(path: string): string | null {
  if (path === "/") return "home";
  if (path === "/rss.xml") return "rss";
  if (path === "/sitemap.xml" || path === "/robots.txt") return "seo";
  if (path.startsWith("/tag/")) return "tag";
  // Post pages: /{slug} — tag them with "post" so they can be bulk-purged.
  // 404 pages also land here, but that's harmless; they won't be cached by the CDN anyway.
  return "post";
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  if (!c.req.path.startsWith("/admin") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "public, max-age=60, s-maxage=31536000");
    c.res.headers.set("CDN-Cache-Control", "public, max-age=31536000");
    // Tag responses for cache-tag-based invalidation (more reliable than path-prefix purging).
    const tag = cacheTagForPath(c.req.path);
    if (tag) c.res.headers.append("Cache-Tag", tag);
  }
});

app.route("/", rssRoutes);
app.route("/", seoFileRoutes);
app.route("/admin", adminRoutes);
app.route("/", publicRoutes);

app.notFound((c) => {
  const html = renderLayout({
    siteTitle: c.env.SITE_TITLE,
    pageTitle: "Page Not Found",
    description: "This page does not exist.",
    canonicalUrl: absoluteUrl(c.env.SITE_URL, c.req.path),
    bodyHtml: "<h1>404</h1><p>That page does not exist.</p>",
    noindex: true,
  });
  return c.html(html, 404);
});

export default app;
